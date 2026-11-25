const unavailable = () => Object.assign(new Error("Tenant authentication database unavailable"), {
  code: "SERVICE_UNAVAILABLE",
});
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function checked(result) {
  if (!object(result)) throw unavailable();
  for (const key of ["code", "errCode"]) {
    const code = result[key];
    if (code !== undefined && code !== 0 && code !== "0") {
      // Retain the SDK conflict code so its runTransaction can retry; never
      // expose arbitrary database messages through the administrator facade.
      throw Object.assign(new Error("Tenant authentication database operation failed"), { code });
    }
  }
  return result;
}

function document(raw, id) {
  return {
    async get() { return checked(await raw.get()); },
    async set(input) {
      if (!object(input) || Object.keys(input).length !== 1 || !Object.hasOwn(input, "data")
        || !object(input.data) || (Object.hasOwn(input.data, "_id") && input.data._id !== id)) throw unavailable();
      const { _id, ...data } = input.data;
      return checked(await raw.set(data));
    },
  };
}

function query(raw) {
  return {
    where(filter) { return query(raw.where(filter)); },
    orderBy(field, direction) { return query(raw.orderBy(field, direction)); },
    skip(offset) { return query(raw.skip(offset)); },
    limit(count) { return query(raw.limit(count)); },
    async get() { return checked(await raw.get()); },
  };
}

function context(raw, inTransaction) {
  if (!raw || typeof raw.collection !== "function") throw unavailable();
  return {
    collection(name) {
      const collection = raw.collection(name);
      return {
        ...(inTransaction ? {} : query(collection)),
        doc(id) { return document(collection.doc(id), id); },
      };
    },
  };
}

/** Admin-only bridge from the shared wx-style tenant service to the installed
 * @cloudbase/database 2.0.0 management SDK. SDK transactions retain ownership of
 * retries, commit and rollback. No SDK initialization or network work occurs here.
 */
export class TenantAuthCloudDatabase {
  #database;
  #base;

  constructor(database) {
    if (!database || typeof database.runTransaction !== "function") throw unavailable();
    this.#database = database;
    this.#base = context(database, false);
  }

  collection(name) { return this.#base.collection(name); }

  runTransaction(work) {
    if (typeof work !== "function") throw unavailable();
    return this.#database.runTransaction((transaction) => work(context(transaction, true)));
  }
}
