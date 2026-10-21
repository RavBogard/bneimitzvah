import "server-only";
import { and, eq, isNull,sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction } from "../access/types";
import * as s from "../db/index";
export const ceremonyLocalDate=(now:number)=>new Intl.DateTimeFormat("en-CA",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(now));

/** Transactional outbox: no source calls, mail, backfill or student identity on the music side. */
export async function scheduleCeremony<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string,
  student: { id: string; ceremonyDate: string; serviceSlot: "morning" | "havdalah" | "unknown" }, now = Date.now()) {
  const where = and(eq(s.studentCeremony.tenantId, tenantId), eq(s.studentCeremony.studentId, student.id));
  const [existing] = await tx.select().from(s.studentCeremony).where(where);
  if (existing) {
    const [ceremony] = await tx.select().from(s.serviceCeremony).where(and(eq(s.serviceCeremony.tenantId, tenantId), eq(s.serviceCeremony.id, existing.ceremonyId))).for("update");
    await tx.update(s.studentCeremony).set({ needsReconciliation: !ceremony || ceremony.localDate !== student.ceremonyDate || ceremony.ceremonyType !== student.serviceSlot }).where(where);
    if(ceremony){
      // A shared setlist cannot be silently moved away from another joint student's ceremony.
      const attached=await tx.select({date:s.student.ceremonyDate,type:s.student.serviceSlot}).from(s.studentCeremony).innerJoin(s.student,and(eq(s.student.tenantId,s.studentCeremony.tenantId),eq(s.student.id,s.studentCeremony.studentId)))
        .where(and(eq(s.studentCeremony.tenantId,tenantId),eq(s.studentCeremony.ceremonyId,ceremony.id),isNull(s.student.disabledAt)));
      const conflict=student.serviceSlot==="unknown" || attached.some(other=>other.date!==student.ceremonyDate || other.type!==student.serviceSlot);
      const changed=ceremony.requestedDate!==student.ceremonyDate || ceremony.requestedType!==student.serviceSlot;
      await tx.update(s.serviceCeremony).set({scheduleConflict:conflict,...(changed?{scheduleKey:`retained-${ceremony.id}`} : {}),...(!conflict && (changed || ceremony.scheduleConflict)?{requestedDate:student.ceremonyDate,requestedType:student.serviceSlot as "morning"|"havdalah",scheduleRevision:sql`${s.serviceCeremony.scheduleRevision}+1`,state:"pending" as const,nextAttemptAt:new Date(now)}:{}),revision:sql`${s.serviceCeremony.revision}+1`})
        .where(and(eq(s.serviceCeremony.tenantId,tenantId),eq(s.serviceCeremony.id,ceremony.id)));
    }
    return existing.ceremonyId;
  }
  if (student.serviceSlot === "unknown" || student.ceremonyDate <= ceremonyLocalDate(now)) return null;
  // One local ceremony identity per schedule allows joint students to share the same source setlist.
  const scheduleKey=`${student.ceremonyDate}-${student.serviceSlot}`;
  const key = and(eq(s.serviceCeremony.tenantId, tenantId),eq(s.serviceCeremony.scheduleKey,scheduleKey));
  await tx.insert(s.serviceCeremony).values({ tenantId,scheduleKey,localDate: student.ceremonyDate, ceremonyType: student.serviceSlot,requestedDate:student.ceremonyDate,requestedType:student.serviceSlot }).onConflictDoNothing();
  const [ceremony] = await tx.select().from(s.serviceCeremony).where(key);
  await tx.insert(s.studentCeremony).values({ tenantId, studentId: student.id, ceremonyId: ceremony.id }).onConflictDoNothing();
  return ceremony.id;
}
