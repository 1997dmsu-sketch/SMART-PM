import { createHash } from "node:crypto";
import { ORG_COLLECTIONS } from "./backend.mjs";
import { OrgService, membershipId } from "../../lib/org.mjs";
import { OrgPropertyService } from "../../lib/property-v2.mjs";
import { PersonService } from "../../lib/persons.mjs";
import { IdentityService } from "../../lib/identity.mjs";
import { VerificationService } from "../../lib/verification.mjs";
import { BlacklistService } from "../../lib/blacklist.mjs";
import { OccupancyService } from "../../lib/occupancies.mjs";

const ORG_SET = new Set(ORG_COLLECTIONS);
const clone = (value) => value === null || value === undefined ? value : structuredClone(value);
const logicalKey = ({ collection, id }) => `${collection}/${id}`;

/**
 * Runs the production services without changing their algorithms. Logical IDs
 * (including random UUIDs and fixed HMAC IDs) are mapped to physical probe IDs
 * under the run prefix. Business fields remain the production service's values;
 * only the physical document key and _id translation are adapted.
 */
export class ServiceStore {
  constructor(backend, { beforeTransact = null, afterList = null } = {}) {
    this.backend = backend;
    this.beforeTransact = beforeTransact;
    this.afterList = afterList;
    this.transactionCalls = 0;
    this.transactionHistory = [];
    this.listCalls = [];
    this.ids = backend.serviceIds ||= new Map();
  }

  physical(ref) {
    const logical = logicalKey(ref);
    const digest = createHash("sha256").update(logical).digest("hex").slice(0, 40);
    const id = this.backend.id(`svc-${digest}`);
    const physical = `${ref.collection}/${id}`;
    this.ids.set(physical, logical);
    this.ids.set(logical, physical);
    return { collection: ref.collection, id };
  }

  logicalRecord(collection, row) {
    if (!row) return null;
    const physical = `${collection}/${row._id}`;
    const logical = this.ids.get(physical);
    if (!logical) throw Error(`缺少逻辑 ID 映射：${physical}`);
    const [expectedCollection, ...idParts] = logical.split("/");
    if (expectedCollection !== collection) throw Error("逻辑 ID 集合不一致");
    return { ...clone(row), _id: idParts.join("/") };
  }

  async list(collection, orgId = null) {
    this.listCalls.push({ collection, orgId });
    const read = async (scopedOrg) => {
      const spec = {
        orgId: scopedOrg,
        where: { probeRunId: this.backend.runId },
        orderBy: ["_id"],
      };
      const rows = await this.backend.listAll(collection, spec);
      return rows.map((row) => this.logicalRecord(collection, row));
    };
    let rows;
    if (ORG_SET.has(collection) && !orgId) {
      rows = [...await read(this.backend.config.orgA), ...await read(this.backend.config.orgB)];
    } else rows = await read(orgId);
    const replaced = await this.afterList?.(collection, orgId, clone(rows));
    return Array.isArray(replaced) ? replaced : rows;
  }

  async transact(refs, build, audit) {
    this.transactionCalls += 1;
    const call = this.transactionCalls;
    this.transactionHistory.push({ call, refs: clone(refs) });
    await this.beforeTransact?.(refs, call);
    const mapped = refs.map((ref) => ({ logical: ref, physical: this.physical(ref) }));
    return this.backend.transact(mapped.map((item) => item.physical), async (physicalState) => {
      const state = {};
      for (const { logical, physical } of mapped) {
        state[logicalKey(logical)] = this.logicalRecord(
          logical.collection, physicalState[logicalKey(physical)],
        );
      }
      const built = await build(state);
      const mapWrite = (write) => {
        const physicalWrite = this.physical(write);
        const data = { ...(write.data || {}) };
        delete data._id;
        // OrgService intentionally treats organizations._id as the scope. The
        // physical copy also carries orgId so cleanup remains org-pushed-down.
        if (write.collection === "organizations" && data.orgId === undefined)
          data.orgId = write.id;
        return { ...write, id: physicalWrite.id, data };
      };
      if (Array.isArray(built)) return built.map(mapWrite);
      return { ...built, writes: built.writes.map(mapWrite) };
    }, audit);
  }
}

export function createIdentityService(backend, options = {}) {
  const store = new ServiceStore(backend, options);
  const service = new IdentityService(store, {
    hmacKey: "db08-isolated-test-hmac-key-0123456789",
    keyVersion: 1,
    loginRealm: "resident",
  });
  return { store, service };
}

export async function createServiceContext(backend, label, options = {}) {
  const store = options.store || new ServiceStore(backend, options);
  const { orgA, orgB } = backend.config;
  const adminId = backend.id(`${label}-admin`);
  const reviewerId = backend.id(`${label}-reviewer`);
  const otherAdminId = backend.id(`${label}-other-admin`);
  const audit = { actorId: adminId, actorType: "adminAccount", action: `DB-08 ${label}`, orgId: orgA };
  const reviewerAudit = { actorId: reviewerId, actorType: "adminAccount", action: `DB-08 ${label} review`, orgId: orgA };
  const orgs = new OrgService(store);
  await orgs.bootstrap({ id: orgA, name: `DB08 ${label} A`, adminAccountIds: [adminId] }, audit);
  await orgs.bootstrap({ id: orgB, name: `DB08 ${label} B`, adminAccountIds: [otherAdminId] },
    { ...audit, orgId: orgB });
  await orgs.grantMembership({
    orgId: orgA, principalType: "adminAccount", principalId: reviewerId, role: "admin",
    permissions: ["identity.review", "identity.readPrivate", "blacklist.manage", "blacklist.read", "blacklist.review"],
  }, audit);
  const adminMembershipId = membershipId(orgA, "adminAccount", adminId);
  const reviewerMembershipId = membershipId(orgA, "adminAccount", reviewerId);
  const property = new OrgPropertyService(store, orgA, { membershipId: adminMembershipId });
  const { buildingId } = await property.createProperty({
    mode: "new", communityName: `DB08 ${label} 小区`, buildingName: "1栋",
  }, audit);
  const floor = await property.createCatalog({
    kind: "floor", name: "1层", level: 1, parentId: buildingId,
  }, audit);
  const persons = new PersonService(store, orgA, { membershipId: adminMembershipId });
  const identity = new IdentityService(store, {
    hmacKey: "db08-isolated-test-hmac-key-0123456789", keyVersion: 1, loginRealm: "resident",
  });
  const verificationOptions = {
    identity, encryptionKey: Buffer.alloc(32, 8),
    fileValidator: async () => true,
  };
  const verificationAdmin = new VerificationService(store, orgA, { membershipId: adminMembershipId }, verificationOptions);
  const verificationReviewer = new VerificationService(store, orgA, { membershipId: reviewerMembershipId }, verificationOptions);
  const now = () => 1_000_000;
  const internalBlacklist = new BlacklistService(store, orgA, null, { now });
  const reviewerBlacklist = new BlacklistService(store, orgA, { membershipId: reviewerMembershipId }, { now });
  const service = new OccupancyService(store, orgA, { membershipId: adminMembershipId }, {
    blacklist: internalBlacklist, now,
  });
  const otherPersons = new PersonService(store, orgB, null);

  let documentSequence = 0;
  async function approve(personId) {
    const created = await verificationAdmin.createApplication({ personId, documentType: "id-card" }, audit);
    documentSequence += 1;
    await verificationAdmin.submit(created.applicationId, {
      expectedRevision: 1,
      document: { name: "合成住户", documentNumber: `DB08${String(documentSequence).padStart(8, "0")}TEST` },
      fileIds: [backend.id(`${label}-synthetic-private-file`)],
    }, audit);
    const submitted = await verificationReviewer.getApplication(created.applicationId);
    await verificationReviewer.review(created.applicationId, {
      decision: "approve", reason: "合成资料测试", expectedRevision: submitted.revision, documentVersion: 1,
    }, reviewerAudit);
    return created.applicationId;
  }
  async function makeRoom(number = "101") {
    const created = await property.createRooms({ floorId: floor._id, numbers: [number] }, audit);
    return created.ids[0];
  }

  return {
    store, orgs, property, persons, otherPersons, identity,
    verificationAdmin, verificationReviewer, reviewerBlacklist, internalBlacklist, service,
    orgA, orgB, adminId, reviewerId, otherAdminId, adminMembershipId, reviewerMembershipId,
    audit, reviewerAudit, roomFloorId: floor._id, buildingId, now,
    approve, makeRoom,
  };
}
