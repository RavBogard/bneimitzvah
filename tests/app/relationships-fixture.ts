import { createRelationshipService } from "../../src/server/relationships/service";
import { practiceFixture } from "./practice-fixture";

export async function relationshipsFixture() {
  const f = await practiceFixture();
  return { ...f, relationships: createRelationshipService({ access: f.service }) };
}
