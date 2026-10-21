import "server-only";
import { digest } from "../students/bindings";
import type { EnsureInput } from "./contract";
export function ensureIntent(ceremony:{id:string;requestedDate:string;requestedType:"morning"|"havdalah";scheduleRevision:number;setlistId:string|null;selectedSetlistId?:string|null;excludedSetlistId?:string|null},explicitSetlistId?:string):EnsureInput{
  const linked=explicitSetlistId??ceremony.selectedSetlistId??ceremony.setlistId;
  return {ceremonyId:ceremony.id,localDate:ceremony.requestedDate,ceremonyType:ceremony.requestedType,scheduleRevision:ceremony.scheduleRevision,
    idempotencyKey:`ceremony-${ceremony.id}-${ceremony.scheduleRevision}-${digest([ceremony.requestedDate,ceremony.requestedType,linked,ceremony.excludedSetlistId]).slice(0,16)}`,
    ...(ceremony.excludedSetlistId?{excludedSetlistId:ceremony.excludedSetlistId}:{}),
    ...(linked?{explicitSetlistId:linked}:{})};
}
