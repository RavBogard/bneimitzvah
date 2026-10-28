/** The study booklet's address (Track B): one print page per student, opened with the viewer's own session. Kept apart so an entrance links it without loading the booklet. */
export const bookletHref = (studentId: string) => `/print/booklet/${encodeURIComponent(studentId)}`;
