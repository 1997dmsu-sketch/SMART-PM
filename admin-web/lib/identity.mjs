import { randomUUID, createHmac } from "node:crypto";
import { failCode } from "./model.mjs";
// DB-03: stable user identity, verified-phone and WeChat mappings
// (docs/database/DATA-MODEL.md §2 auth_identities, §3.2 登录事务;
// API-CONTRACT.md §3).
//
// - users._id is permanent; legacy IDs are preserved and never auto-merged.
// - A verified phone number or WeChat subject maps to exactly ONE user via a
//   fixed-ID auth_identities document (the fixed ID IS the unique placeholder,
//   per DATA-MODEL §3.1 "读取固定 auth_identities ID").
// - Phone numbers are normalized (E.164-ish, country code required) and only
//   an HMAC digest with a server-side key + keyVersion is stored; the raw
//   phone / OPENID never reaches this layer's records or audit payloads.
// - WeChat subjects come exclusively from the server-side gateway adapter
//   (appId + OPENID); request-body openid/phone values are never trusted.
// - The gateway is also the ONLY phone-verification credential hook: no SMS
//   provider, no paid API and no real-name call is implemented here. An
//   unconfigured gateway fails closed with PROVIDER_DISABLED.
const ref = (collection, id) => ({ collection, id });
const base = () => ({ schemaVersion: 2, revision: 1, createdAt: Date.now() });
export function normalizePhone(value) {
  if (typeof value !== "string") failCode("PARAM_ERROR", "手机号格式无效");
  let v = value.replace(/[\s-]/g, "");
  if (v.startsWith("00")) v = `+${v.slice(2)}`;
  if (/^1\d{10}$/.test(v)) v = `+86${v}`; // mainland China default realm
  if (!/^\+[1-9]\d{6,14}$/.test(v))
    failCode("PARAM_ERROR", "手机号需为含国家码的有效号码");
  return v;
}
export const maskPhone = (phone) =>
  phone.replace(/^(\+\d{2})\d+(\d{4})$/, "$1****$2");
export const maskName = (name) =>
  `${name.trim()[0]}${"*".repeat(Math.max(1, Math.min(name.trim().length - 1, 3)))}`;
export class IdentityService {
  constructor(store, { hmacKey, keyVersion = 1, loginRealm = "resident", gateway = null } = {}) {
    if (typeof hmacKey !== "string" || hmacKey.length < 16)
      failCode("ADAPTER_UNAVAILABLE", "身份摘要密钥未配置", 503);
    this.store = store;
    this.hmacKey = hmacKey;
    this.keyVersion = keyVersion;
    this.loginRealm = loginRealm;
    this.gateway = gateway;
  }
  digest(kind, scope, subject) {
    return createHmac("sha256", this.hmacKey)
      .update(`${this.keyVersion}|${kind}|${scope}|${subject}`)
      .digest("hex");
  }
  // F03: the login realm's digest configuration is persisted as a fixed-ID
  // domain document. keyVersion and the key both feed the fixed identity
  // IDs, so silently changing either would re-register every existing
  // identity as a second user. Any mismatch is refused loudly instead.
  // The fingerprint is an HMAC of configuration metadata and never exposes
  // the key itself.
  get domainId() {
    return `identity-domain-${this.loginRealm}`;
  }
  fingerprintFor(realm) {
    return createHmac("sha256", this.hmacKey)
      .update(`identity-domain-fingerprint|${realm}|${this.keyVersion}`)
      .digest("hex");
  }
  get keyFingerprint() {
    return this.fingerprintFor(this.loginRealm);
  }
  // Generic digest-domain guard, shared by login (DB-03) and real-name
  // document digests (DB-04 review F02). Persists keyVersion + fingerprint
  // under a fixed per-realm document; a changed key or version is refused.
  // When no domain document exists yet, initialization is only allowed with
  // allowInit (i.e. no previously digested records) — existing data must
  // never silently adopt an arbitrary new configuration.
  guardDomain(state, realm, { allowInit = true } = {}) {
    const id = `identity-domain-${realm}`;
    const domain = state[`identity_domains/${id}`];
    if (domain) {
      if (
        domain.keyVersion !== this.keyVersion ||
        domain.keyFingerprint !== this.fingerprintFor(realm)
      )
        failCode(
          "IDENTITY_CONFIG_CHANGED",
          "身份摘要密钥或版本已变更，须先执行受控轮换，不能继续注册或登录",
          503,
        );
      return [];
    }
    if (!allowInit)
      failCode(
        "IDENTITY_CONFIG_CHANGED",
        "身份摘要配置文档缺失，须受控初始化，不能直接采用新配置",
        503,
      );
    return [
      {
        collection: "identity_domains",
        id,
        data: {
          loginRealm: realm,
          keyVersion: this.keyVersion,
          keyFingerprint: this.fingerprintFor(realm),
          ...base(),
        },
      },
    ];
  }
  domainWrite(state) {
    return this.guardDomain(state, this.loginRealm);
  }
  phoneIdentity(phone) {
    const subjectDigest = this.digest("phone", this.loginRealm, phone);
    return { id: `ident-${subjectDigest.slice(0, 32)}`, subjectDigest };
  }
  wechatIdentity({ appId, openid }) {
    const subjectDigest = this.digest("wechat", appId, openid);
    return { id: `ident-${subjectDigest.slice(0, 32)}`, subjectDigest, appId };
  }
  async verifiedPhone(credential) {
    if (!this.gateway?.verifyPhone)
      failCode("PROVIDER_DISABLED", "手机号验证适配器未配置", 503);
    return normalizePhone(await this.gateway.verifyPhone(credential));
  }
  async verifiedWechat(code) {
    if (!this.gateway?.fetchWechatSubject)
      failCode("PROVIDER_DISABLED", "微信身份适配器未配置", 503);
    const subject = await this.gateway.fetchWechatSubject(code);
    if (
      !subject ||
      typeof subject.appId !== "string" ||
      !subject.appId ||
      typeof subject.openid !== "string" ||
      !subject.openid
    )
      failCode("PROVIDER_DISABLED", "微信身份适配器返回无效", 503);
    return subject;
  }
  // Shared login transaction. All decisions are recomputed from the
  // in-transaction state, so concurrent registrations with the same phone or
  // OPENID collapse onto one user instead of duplicating accounts.
  async login({ phone = null, wechat = null }, audit) {
    if (!phone && !wechat) failCode("PARAM_ERROR", "缺少登录身份");
    // A mapping committed after our pre-read can point at a user whose doc
    // was not in our declared refs; the transaction then asks for a retry
    // (IDENTITY_RETRY) so the resolution reruns with fresh refs.
    for (let attempt = 0; attempt < 3; attempt++)
      try {
        return await this.loginOnce({ phone, wechat }, audit);
      } catch (e) {
        if (e.code !== "IDENTITY_RETRY" || attempt === 2) throw e;
      }
    throw new Error("unreachable");
  }
  async loginOnce({ phone = null, wechat = null }, audit) {
    const pIdent = phone ? this.phoneIdentity(phone) : null;
    const wIdent = wechat ? this.wechatIdentity(wechat) : null;
    const newUserId = randomUUID();
    // Legacy users without v2 mappings must go through migration/conflict
    // handling — never silently ignored by creating a second account.
    // Candidates are re-validated inside the transaction (their docs are
    // declared refs, so a concurrent change is detected by the store).
    const users = await this.store.list("users");
    const legacyMatches = users.filter((u) => {
      if (u.schemaVersion === 2) return false;
      if (phone && typeof u.phone === "string" && u.phone) {
        try {
          if (normalizePhone(u.phone) === phone) return true;
        } catch {
          /* unparsable legacy phones are reported by DB-08 inventory */
        }
      }
      return wechat && u._openid && u._openid === wechat.openid;
    });
    const refs = [
      ref("identity_domains", this.domainId),
      ...(pIdent ? [ref("auth_identities", pIdent.id)] : []),
      ...(wIdent ? [ref("auth_identities", wIdent.id)] : []),
      ref("users", newUserId),
      ...legacyMatches.map((u) => ref("users", u._id)),
    ];
    const preIdents = await this.store.list("auth_identities");
    for (const i of preIdents) {
      if (
        (pIdent && i._id === pIdent.id) ||
        (wIdent && i._id === wIdent.id)
      )
        refs.push(ref("users", i.userId));
    }
    const uniqueRefs = [
      ...new Map(refs.map((r) => [`${r.collection}/${r.id}`, r])).values(),
    ];
    const result = { status: 200, body: null };
    await this.store.transact(
      uniqueRefs,
      (state) => {
        // F03: refuse a changed digest configuration before any resolution —
        // continuing would register every existing identity as a new user.
        const domainWrites = this.domainWrite(state);
        const p = pIdent ? state[`auth_identities/${pIdent.id}`] : null;
        const w = wIdent ? state[`auth_identities/${wIdent.id}`] : null;
        const bound = (i) => i && i.status === "bound";
        if (bound(p) && bound(w) && p.userId !== w.userId)
          failCode(
            "IDENTITY_CONFLICT",
            "手机号与微信身份已分别绑定不同账号，请走人工冲突处理",
            409,
          );
        const userId = bound(p) ? p.userId : bound(w) ? w.userId : newUserId;
        const existing = state[`users/${userId}`] || null;
        if ((bound(p) || bound(w)) && !existing)
          failCode("IDENTITY_RETRY", "身份映射刚刚变更，正在重新解析", 409);
        for (const legacy of legacyMatches) {
          const current = state[`users/${legacy._id}`];
          if (current && current._id !== userId)
            failCode(
              "IDENTITY_CONFLICT",
              "该手机号或微信已存在旧账号，须先完成身份迁移，不能直接新建账号",
              409,
            );
        }
        if (existing && existing.status && existing.status !== "active")
          failCode("USER_DISABLED", "账号已停用，请联系管理员", 403);
        const writes = [...domainWrites];
        const userPatch = {};
        if (pIdent && !bound(p)) {
          if (existing?.phoneIdentityId && existing.phoneIdentityId !== pIdent.id)
            failCode(
              "IDENTITY_CONFLICT",
              "账号已绑定其他手机号，换号流程尚未开放",
              409,
            );
          writes.push({
            collection: "auth_identities",
            id: pIdent.id,
            data: {
              kind: "phone",
              loginRealm: this.loginRealm,
              subjectDigest: pIdent.subjectDigest,
              keyVersion: this.keyVersion,
              userId,
              status: "bound",
              verifiedAt: Date.now(),
              ...base(),
            },
          });
          userPatch.phoneIdentityId = pIdent.id;
          userPatch.phoneMasked = maskPhone(phone);
        }
        if (wIdent && !bound(w)) {
          if (existing?.wechatIdentityId && existing.wechatIdentityId !== wIdent.id)
            failCode(
              "IDENTITY_CONFLICT",
              "账号已绑定其他微信身份，请走人工冲突处理",
              409,
            );
          writes.push({
            collection: "auth_identities",
            id: wIdent.id,
            data: {
              kind: "wechat",
              appId: wechat.appId,
              subjectDigest: wIdent.subjectDigest,
              keyVersion: this.keyVersion,
              userId,
              status: "bound",
              verifiedAt: Date.now(),
              ...base(),
            },
          });
          userPatch.wechatIdentityId = wIdent.id;
        }
        if (!existing) {
          writes.push({
            collection: "users",
            id: userId,
            data: {
              name: "住户",
              role: "user", // low-privilege resident account; never admin
              status: "active",
              phoneMasked: userPatch.phoneMasked ?? null,
              phoneIdentityId: userPatch.phoneIdentityId ?? null,
              wechatIdentityId: userPatch.wechatIdentityId ?? null,
              lastLoginAt: Date.now(),
              ...base(),
            },
          });
        } else {
          writes.push({
            collection: "users",
            id: userId,
            data: {
              ...userPatch,
              lastLoginAt: Date.now(),
              revision: (existing.revision ?? 0) + 1,
            },
          });
        }
        result.body = {
          userId,
          isNewUser: !existing,
          phoneMasked: userPatch.phoneMasked ?? existing?.phoneMasked ?? null,
        };
        return writes;
      },
      { ...audit, action: audit.action || "身份登录", entityId: "auth_identities" },
    );
    return result.body;
  }
  async loginWithPhone({ phoneCredential, wechatCode = null }, audit) {
    const phone = await this.verifiedPhone(phoneCredential);
    const wechat = wechatCode ? await this.verifiedWechat(wechatCode) : null;
    return this.login({ phone, wechat }, audit);
  }
  async loginWithWechat({ wechatCode }, audit) {
    const wechat = await this.verifiedWechat(wechatCode);
    return this.login({ wechat }, audit);
  }
  // Masked self-profile only: no raw phone, no OPENID, no full users record,
  // no device bindings (API-CONTRACT §3 getMyProfile).
  async getMyProfile(userId) {
    const user = (await this.store.list("users")).find((u) => u._id === userId);
    if (!user) failCode("NOT_FOUND", "账号不存在", 404);
    const identities = (await this.store.list("auth_identities"))
      .filter((i) => i.userId === userId && i.status === "bound")
      .map((i) => ({
        kind: i.kind,
        verifiedAt: i.verifiedAt,
        keyVersion: i.keyVersion,
      }));
    const persons = (await this.store.list("persons"))
      .filter((p) => p.userId === userId)
      .map((p) => ({
        orgId: p.orgId,
        personId: p._id,
        nameMasked: p.nameMasked,
        status: p.status,
      }));
    return {
      userId: user._id,
      name: user.name ?? "住户",
      status: user.status ?? "active",
      phoneMasked: user.phoneMasked ?? null,
      identities,
      persons,
    };
  }
  // Q04 (phone recycling / re-binding policy) is undecided: the action exists
  // only as a closed stub. Releasing a phone claim must never happen here.
  async requestPhoneChange() {
    failCode("POLICY_UNDECIDED", "手机号换绑流程尚未开放", 503);
  }
}
