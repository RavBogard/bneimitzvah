export type ReloadRegistration = { reload(): Promise<void> };

/** Complete every still-registered scope, including replacements added in flight. */
export async function reloadWorkspaceScopes(
  active: ReadonlySet<ReloadRegistration>, verifyAfterRemoval: () => Promise<void>,
) {
  const completed = new Set<ReloadRegistration>();
  let needsVerification = false;
  // Repeated mount/unmount churn must close the barrier rather than reveal a
  // subtree whose newest registration has not completed.
  for (let pass = 0; pass < 8; pass++) {
    const pending = [...active].filter(registration => !completed.has(registration));
    if (pending.length) {
      await Promise.all(pending.map(async registration => {
        try { await registration.reload(); }
        catch (error) {
          if (active.has(registration)) throw error;
          needsVerification = true;
        }
        completed.add(registration);
      }));
      continue;
    }
    if (needsVerification) {
      needsVerification = false;
      await verifyAfterRemoval();
      // A replacement may have registered while the session was being checked.
      continue;
    }
    return;
  }
  throw new Error("Workspace reload registrations did not settle");
}
