import type { Review } from "./api";
import { teachesLine } from "../staff/model";

/** G11 (1.9 N15): when a tutor who teaches students is removed, the review lists them and offers a tutor to move them to. */
export type HandOverChoice = { names: string[]; options: { id: string; label: string }[]; value: string; onChange(value: string): void };

// Shown in the People sheet, which focuses the heading once the sheet is open.
export function AccessReview({ review, pending, confirm, cancel, handOver }: { review: Review; pending: boolean; confirm(): void; cancel(): void; handOver?: HandOverChoice }) {
  return <section className="access-review" aria-labelledby="access-review-heading">
    <h2 id="access-review-heading" tabIndex={-1}>{review.title}</h2>
    <dl className="access-details"><div><dt>Person</dt><dd><bdi dir="auto">{review.person}</bdi></dd></div>
      {review.student && <div><dt>Student</dt><dd><bdi dir="auto">{review.student.firstName} {review.student.lastName}</bdi>{review.student.disabled ? " · Disabled" : ""}</dd></div>}
    </dl>{review.scope !== "setting" && <p className="access-scope">{review.scope === "student" ? (review.student ? <>Changes access to <bdi dir="auto">{review.student.firstName} {review.student.lastName}</bdi> only.</> : "Changes access to this student only.") : "Changes access across the whole congregation."}</p>}
    <p className="access-consequence">{review.consequence}</p>
    {handOver && handOver.names.length > 0 && <div className="access-hand-over" data-testid="hand-over">
      <p><bdi dir="auto">{teachesLine(handOver.names)}</bdi></p>
      {handOver.options.length > 0 && <div className="roster-field"><label htmlFor="access-hand-over">Move these students to:</label>
        <select id="access-hand-over" disabled={pending} value={handOver.value} onChange={event => handOver.onChange(event.target.value)}><option value="">Choose a tutor</option>{handOver.options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></div>}
    </div>}
    <p className="field-help">Access is checked again before anything is saved.</p>
    <details className="access-technical"><summary>Technical details</summary><dl className="access-details"><div><dt>Role identifier</dt><dd><bdi dir="ltr">{review.grantId}</bdi></dd></div>{review.student && <div><dt>Ceremony date</dt><dd><time>{review.student.ceremonyDate}</time></dd></div>}</dl></details>
    <div className="form-actions"><button className="button-primary admin-pill" disabled={pending} onClick={confirm}>{pending ? "Checking and saving…" : "Confirm access change"}</button><button className="button-secondary admin-pill" disabled={pending} onClick={cancel}>Cancel</button></div>
  </section>;
}
