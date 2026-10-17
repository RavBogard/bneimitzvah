import type { Review } from "./api";

// Shown in the People sheet, which focuses the heading once the sheet is open.
export function AccessReview({ review, pending, confirm, cancel }: { review: Review; pending: boolean; confirm(): void; cancel(): void }) {
  return <section className="access-review" aria-labelledby="access-review-heading">
    <h2 id="access-review-heading" tabIndex={-1}>{review.title}</h2>
    <dl className="access-details"><div><dt>Person</dt><dd><bdi dir="auto">{review.person}</bdi></dd></div>
      {review.student && <div><dt>Student</dt><dd><bdi dir="auto">{review.student.firstName} {review.student.lastName}</bdi>{review.student.disabled ? " · Disabled" : ""}</dd></div>}
    </dl><p className="access-consequence">{review.consequence}</p>
    <p className="field-help">Access is checked again before anything is saved.</p>
    <details className="access-technical"><summary>Technical details</summary><dl className="access-details"><div><dt>Role identifier</dt><dd><bdi dir="ltr">{review.grantId}</bdi></dd></div>{review.student && <div><dt>Ceremony date</dt><dd><time>{review.student.ceremonyDate}</time></dd></div>}</dl></details>
    <div className="form-actions"><button className="button-primary admin-pill" disabled={pending} onClick={confirm}>{pending ? "Checking and saving…" : "Confirm access change"}</button><button className="button-secondary admin-pill" disabled={pending} onClick={cancel}>Cancel</button></div>
  </section>;
}
