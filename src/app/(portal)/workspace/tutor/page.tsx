import { redirect } from "next/navigation";

/** The tutor's list of students is Your students on the shelf now (Readings for everyone D7, E2). A student's own page, /workspace/tutor/<id>, stays. */
export default function TutorRedirect() { redirect("/mine"); }
