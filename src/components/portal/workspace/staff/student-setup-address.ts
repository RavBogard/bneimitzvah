import { STUDENTS_HREF } from "../../shell/tabs";

export const STUDENT_SETUP_ID = "student-setup";
export const setupWorkspaceHref = (studentId: string) => `/workspace/admin/students/${encodeURIComponent(studentId)}/reading#${STUDENT_SETUP_ID}`;
export const setupDetailsHref = (studentId: string) => `${STUDENTS_HREF}&edit=${encodeURIComponent(studentId)}&from=setup`;
export const setupInviteHref = (studentId: string, role: "parent" | "student") =>
  `/workspace/admin/invitations?${new URLSearchParams({ student: studentId, role, from: "setup" })}`;
