import { buildSnapshot } from "./migrated-pglite";

export default async function setup() { await buildSnapshot(); }
