const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** The course's review line, on its home and on the student workspace: "Review: 3 phrases, about 1 minute". */
export const reviewLine = (review: { phrases: number; minutes: number }): string => `Review: ${plural(review.phrases, "phrase", "phrases")}, about ${plural(review.minutes, "minute", "minutes")}`;
