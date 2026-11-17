import "server-only";
import { pruneRemoved } from "./progress";
import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction, Actor } from "../access/types";
import type { StudentInput } from "../students/validation";
import * as s from "../db/index";

export async function roster<Q extends PgQueryResultHKT>(tx:AccessTransaction<Q>,tenantId:string){
  return tx.select().from(s.student).where(eq(s.student.tenantId,tenantId)).orderBy(asc(s.student.id)).limit(5001);
}
export async function editableStudent<Q extends PgQueryResultHKT>(tx:AccessTransaction<Q>,tenantId:string,id:string){
  const [row]=await tx.select().from(s.student).where(and(eq(s.student.tenantId,tenantId),eq(s.student.id,id))).for("update");return row;
}
// Caller already holds the access service's student SHARE lock. Read only the
// staff planning field; do not upgrade that lock or project contact data.
export async function studentReadingContext<Q extends PgQueryResultHKT>(tx:AccessTransaction<Q>,tenantId:string,id:string){
  const [row]=await tx.select({serviceSlot:s.student.serviceSlot}).from(s.student).where(and(eq(s.student.tenantId,tenantId),eq(s.student.id,id)));return row;
}
export async function readingAssignmentVersion<Q extends PgQueryResultHKT>(tx:AccessTransaction<Q>,tenantId:string,studentId:string,kind:"torah"|"haftarah"){
  const [row]=await tx.select({id:s.assignment.id,revision:s.assignment.revision}).from(s.assignment).where(and(eq(s.assignment.tenantId,tenantId),eq(s.assignment.studentId,studentId),eq(s.assignment.kind,kind))).for("share");return row;
}
export async function insertStudent<Q extends PgQueryResultHKT>(tx:AccessTransaction<Q>,tenantId:string,input:StudentInput){
  const [row]=await tx.insert(s.student).values({...input,tenantId}).returning();return row;
}
export async function updateStudent<Q extends PgQueryResultHKT>(tx:AccessTransaction<Q>,tenantId:string,id:string,expected:number,patch:Partial<StudentInput>&{disabledAt?:Date}){
  const [row]=await tx.update(s.student).set({...patch,revision:expected+1}).where(and(eq(s.student.tenantId,tenantId),eq(s.student.id,id),eq(s.student.revision,expected))).returning();return row;
}
export async function markReadingsForReview<Q extends PgQueryResultHKT>(tx:AccessTransaction<Q>,tenantId:string,studentId:string){
  await tx.update(s.assignment).set({revision:sql`${s.assignment.revision}+1`,proposalSnapshot:sql`jsonb_set(coalesce(${s.assignment.proposalSnapshot}, '{}'::jsonb), '{needsReview}', 'true'::jsonb)`})
    .where(and(eq(s.assignment.tenantId,tenantId),eq(s.assignment.studentId,studentId),eq(s.assignment.status,"confirmed")));
}
export async function customs<Q extends PgQueryResultHKT>(tx:AccessTransaction<Q>,tenantId:string){
  const [row]=await tx.select({customs:s.tenant.customs}).from(s.tenant).where(eq(s.tenant.id,tenantId));return row?.customs;
}
export async function currentAssignment<Q extends PgQueryResultHKT>(tx:AccessTransaction<Q>,tenantId:string,studentId:string,kind:"torah"|"haftarah",lock:false|true|"share"=false){
  const query=tx.select().from(s.assignment).where(and(eq(s.assignment.tenantId,tenantId),eq(s.assignment.studentId,studentId),eq(s.assignment.kind,kind)));
  const [row]=await (lock?query.for(lock==="share"?"share":"update"):query);return row;
}
export async function assignmentVerses<Q extends PgQueryResultHKT>(tx:AccessTransaction<Q>,tenantId:string,studentId:string,assignmentId:string){
  return (await tx.select({ref:s.assignmentVerse.verseRef}).from(s.assignmentVerse).where(and(eq(s.assignmentVerse.tenantId,tenantId),eq(s.assignmentVerse.studentId,studentId),eq(s.assignmentVerse.assignmentId,assignmentId))).orderBy(asc(s.assignmentVerse.ordinal)).limit(1001)).map(row=>row.ref);
}
export async function persistCuts<Q extends PgQueryResultHKT>(tx:AccessTransaction<Q>,actor:Actor,studentId:string,assignmentId:string,expected:number,aliyahStarts:string[]|null){
  const [row]=await tx.update(s.assignment).set({aliyahStarts,revision:expected+1}).where(and(eq(s.assignment.tenantId,actor.tenantId),eq(s.assignment.studentId,studentId),eq(s.assignment.id,assignmentId),eq(s.assignment.kind,"torah"),eq(s.assignment.status,"confirmed"),eq(s.assignment.revision,expected))).returning({id:s.assignment.id,revision:s.assignment.revision});return row??null;
}
export async function persistAssignment<Q extends PgQueryResultHKT>(tx:AccessTransaction<Q>,actor:Actor,studentId:string,kind:"torah"|"haftarah",expected:number,input:{ref:string;basis:"triennial"|"selection"|"full"|"custom";snapshot:Record<string,unknown>;verses:string[];aliyahStarts:string[]|null}){
  const values={ref:input.ref,basis:input.basis,status:"confirmed",setByMembershipId:actor.membershipId,proposalSnapshot:input.snapshot,aliyahStarts:input.aliyahStarts};
  const [row]=expected===0
    ? await tx.insert(s.assignment).values({...values,tenantId:actor.tenantId,studentId,kind}).onConflictDoNothing({target:[s.assignment.tenantId,s.assignment.studentId,s.assignment.kind]}).returning()
    : await tx.update(s.assignment).set({...values,revision:expected+1}).where(and(eq(s.assignment.tenantId,actor.tenantId),eq(s.assignment.studentId,studentId),eq(s.assignment.kind,kind),eq(s.assignment.revision,expected))).returning();
  if(!row)return null;
  await pruneRemoved(tx,actor.tenantId,studentId,row.id,input.verses);
  await tx.delete(s.assignmentVerse).where(and(eq(s.assignmentVerse.tenantId,actor.tenantId),eq(s.assignmentVerse.assignmentId,row.id)));
  await tx.insert(s.assignmentVerse).values(input.verses.map((verseRef,index)=>({tenantId:actor.tenantId,studentId,assignmentId:row.id,ordinal:index+1,verseRef})));
  return {id:row.id,revision:row.revision};
}
export async function audit<Q extends PgQueryResultHKT>(tx:AccessTransaction<Q>,actor:Actor,action:"student.create"|"student.update"|"student.import"|"reading.set",studentId:string,targetId=studentId){
  await tx.insert(s.auditEvent).values({tenantId:actor.tenantId,actorUserId:actor.userId,actorMembershipId:actor.membershipId,roleGrantId:actor.roleGrantId,
    mode:actor.mode,actingStudentId:studentId,action,targetType:action==="reading.set"?"assignment":"student",targetId,requestId:randomUUID()});
}
