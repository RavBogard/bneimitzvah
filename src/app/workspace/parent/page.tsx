import { redirect } from "next/navigation";

/** A parent's home is the shelf now, with a card for each child (Readings for everyone E2, E3). */
export default function ParentRedirect() { redirect("/mine"); }
