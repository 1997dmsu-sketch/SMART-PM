import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { TenantAccountService } = require("../../cloudfunctions/accountLogin/lib/service.js");

/**
 * Administrator facade for tenant password accounts. The shared pure service
 * owns verified-phone identity binding, password hashing, transactions and public DTOs.
 * This does not read or write the separate administrator accounts.json file.
 * The actor must be supplied from the server's authenticated admin session.
 */
export class AdminTenantPasswordAccounts {
  #service;

  constructor({ database, now } = {}) {
    this.#service = new TenantAccountService({ db: database, now });
  }

  listAccounts(actor) {
    return this.#service.listAccounts(actor);
  }

  listVerifiedUsers(actor) {
    return this.#service.listVerifiedUsers(actor);
  }

  createAccount(actor, input) {
    return this.#service.createAccount(actor, input);
  }

  resetPassword(actor, input) {
    return this.#service.resetPassword(actor, input);
  }

  setStatus(actor, input) {
    return this.#service.setStatus(actor, input);
  }
}

export default AdminTenantPasswordAccounts;
