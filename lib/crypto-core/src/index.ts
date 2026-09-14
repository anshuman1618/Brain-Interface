/**
 * `@workspace/crypto-core` — encoding, hashing and proof primitives.
 *
 * Nothing in here touches a database, a network or a clock. Every function is
 * pure, so every one of them can be re-implemented from the published
 * description and checked against this implementation by someone who does not
 * trust it. That property is the point of the package; keep it.
 *
 * Read `docs/THREAT-MODEL.md` before changing anything here.
 */

export * from "./encoding.js";
export * from "./structures.js";
