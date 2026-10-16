import { useEffect, useRef } from "react";
import type { Review } from "./api";

export function AccessReview({ review, pending, confirm, cancel }: { review: Review; pending: boolean; confirm(): void; cancel(): void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [review]);
  return <section className="access-review" aria-labelledby="access-review-heading">
    <h2 id="access-review-heading" ref={heading} tabIndex={-1}>{review.title}</h2>
    <dl className="access-details"><div><dt>Person</dt><dd><bdi dir="auto">{review.person}</bdi></dd></div>
      {review.student && <div><dt>Student</dt><dd><bdi dir="auto">{review.student.firstName} {review.student.lastName}</bdi> · <time>{review.student.ceremonyDate}</time> · {review.student.disabled ? "Disabled" : "Active"}</dd></div>}
      <div><dt>Role identifier</dt><dd><bdi dir="ltr">{review.grantId}</bdi></dd></div>
    </dl><p>{review.consequence}</p><p className="field-help">Current identity and access state will be checked again before confirmation.</p>
    <div className="form-actions"><button className="button-primary" disabled={pending} onClick={confirm}>{pending ? "Checking and saving…" : "Confirm access change"}</button><button className="button-secondary" disabled={pending} onClick={cancel}>Cancel access change</button></div>
  </section>;
}
