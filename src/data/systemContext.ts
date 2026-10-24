import type { DomainContext } from "../domain";

/** Real clock + random ids for the running app (the domain itself stays deterministic). */
export function createSystemContext(): DomainContext {
  return {
    now: () => new Date().toISOString(),
    newId: (prefix) => `${prefix}_${globalThis.crypto.randomUUID().slice(0, 12)}`,
  };
}
