/**
 * AuthContext por request (AsyncLocalStorage).
 * Usado pelo MCP para evitar race de identidade entre requests concorrentes.
 */

import { AsyncLocalStorage } from "node:async_hooks";

/** @type {AsyncLocalStorage<object|null>} */
const authStorage = new AsyncLocalStorage();

/** @returns {object|null|undefined} */
export function getRequestAuth() {
  return authStorage.getStore();
}

/**
 * Executa fn com AuthContext isolado nesta cadeia async.
 * @template T
 * @param {object|null|undefined} auth
 * @param {() => T|Promise<T>} fn
 * @returns {T|Promise<T>}
 */
export function runWithAuth(auth, fn) {
  return authStorage.run(auth ?? null, fn);
}
