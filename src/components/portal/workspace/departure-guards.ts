export type DeparturePurpose = "sources";
type Guard = () => Promise<boolean>;
/** Navigation checks every participant; a same-reading refresh can retain other drafts. */
export function createDepartureGuards() {
  const guards = new Map<Guard, DeparturePurpose | undefined>();
  return Object.freeze({
    register(guard: Guard, purpose?: DeparturePurpose) {
      guards.set(guard, purpose);
      return () => { guards.delete(guard); };
    },
    async check(purpose?: DeparturePurpose) {
      for (const [guard, registeredPurpose] of guards) {
        if (purpose !== undefined && purpose !== registeredPurpose) continue;
        if (!await guard()) return false;
      }
      return true;
    }
  });
}
