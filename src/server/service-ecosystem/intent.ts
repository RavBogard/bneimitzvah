import "server-only";
import { digest } from "../students/bindings";
import type { EnsureInput } from "./contract";
export function ensureIntent(ceremony:{id:string;requestedDate:string;requestedType:"morning"|"havdalah";scheduleRevision:number;setlistId:string|null},explicitSetlistId?:string):EnsureInput{
  const linked=explicitSetlistId??ceremony.setlistId;
  return {ceremonyId:ceremony.id,localDate:ceremony.requestedDate,ceremonyType:ceremony.requestedType,scheduleRevision:ceremony.scheduleRevision,
    idempotencyKey:`ceremony-${ceremony.id}-${ceremony.scheduleRevision}-${digest([ceremony.requestedDate,ceremony.requestedType,linked]).slice(0,16)}`,
    ...(linked?{explicitSetlistId:linked}:{})};
}
