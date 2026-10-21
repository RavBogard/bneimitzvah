import "server-only";

type Barrier = Readonly<{ sessionExpiresAt: number; batchExpiresAt?: number }>;
// Internal object identity only: no expiry capability/header/payload is exposed.
const barriers = new WeakMap<object, Barrier>();
export function bindReviewResult<T extends object>(result: T, sessionExpiresAt: number, batchExpiresAt?: number): T {
  const prior = barriers.get(result);
  barriers.set(result, Object.freeze({ sessionExpiresAt: Math.min(sessionExpiresAt, prior?.sessionExpiresAt ?? Infinity),
    ...(batchExpiresAt !== undefined || prior?.batchExpiresAt !== undefined ? { batchExpiresAt: Math.min(batchExpiresAt ?? Infinity, prior?.batchExpiresAt ?? Infinity) } : {}) }));
  return result;
}
export function reviewResultBarrier(result: object): Barrier | undefined { return barriers.get(result); }
