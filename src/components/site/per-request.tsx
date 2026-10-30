import { connection } from "next/server";

/** Opts the page into per-request rendering. A fork's identity comes from runtime settings; without this its static pages (the signed-in shell, page titles) would bake in whatever the build saw. */
export async function PerRequest() { await connection(); return null; }
