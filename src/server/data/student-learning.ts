import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction } from "../access/types";
import { studentLearning, type StudentLearningKind } from "../db/student-learning-schema";

type Owner = Readonly<{ tenantId: string; student: Readonly<{ id: string }> }>;
type Tx<Q extends PgQueryResultHKT> = AccessTransaction<Q>;
const scope = (owner: Owner, kind: StudentLearningKind) => and(eq(studentLearning.tenantId, owner.tenantId),
  eq(studentLearning.studentId, owner.student.id), eq(studentLearning.kind, kind));
const view = { document: studentLearning.document, version: studentLearning.version };

export async function readStudentLearning<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: Owner, kind: StudentLearningKind) {
  const [row] = await tx.select(view).from(studentLearning).where(scope(owner, kind)).limit(1);
  return row ?? null;
}
export async function insertStudentLearning<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: Owner, kind: StudentLearningKind, document: unknown) {
  const [row] = await tx.insert(studentLearning).values({ tenantId: owner.tenantId, studentId: owner.student.id, kind, document })
    .onConflictDoNothing().returning(view);
  return row ?? null;
}
export async function updateStudentLearning<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: Owner, kind: StudentLearningKind, version: number, document: unknown) {
  const [row] = await tx.update(studentLearning).set({ document, version: version + 1, updatedAt: sql`now()` })
    .where(and(scope(owner, kind), eq(studentLearning.version, version))).returning(view);
  return row ?? null;
}
