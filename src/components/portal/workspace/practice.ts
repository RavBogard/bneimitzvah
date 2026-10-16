import { PortalRequestError } from "../api";
import { workspaceApi, type Selection } from "./api";

type Transport = Pick<typeof workspaceApi, "enter" | "switch" | "exit">;
// One instance per mounted workspace/tab. This class never writes storage,
// cookies or URLs. The server remains the authority for every operation.
export class PracticeCoordinator {
  private active: Selection | null = null;
  private cleanup: Selection | null = null;
  private busy = false;
  private epoch = 0;
  constructor(private transport: Transport = workspaceApi) {}
  get generation() { return this.epoch; }
  get pending() { return this.busy; }
  get selection() { return this.active; }
  pause() { this.epoch++; }
  invalidate() { this.epoch++; if (this.active) this.cleanup = this.active; this.active = null; }
  private async close(selection: Selection) {
    try { const result = await this.transport.exit(selection.handle); if (result.contextId !== selection.context.id) throw new PortalRequestError(503); }
    catch (error) { if (!(error instanceof PortalRequestError) || ![401, 404].includes(error.status)) throw error; }
  }
  async select(studentId: string) {
    if (this.busy) throw new PortalRequestError(409);
    this.busy = true;
    const previous = this.active, token = ++this.epoch; this.active = null;
    if (previous) this.cleanup = previous;
    try {
      if (!previous && this.cleanup) { await this.close(this.cleanup); this.cleanup = null; }
      const next = previous ? await this.transport.switch(studentId, previous.handle) : await this.transport.enter(studentId);
      if (next.context.studentId !== studentId) throw new PortalRequestError(503);
      if (token !== this.epoch) { this.cleanup = next; await this.close(next); this.cleanup = null; return null; }
      this.cleanup = null; this.active = next; return next.context;
    } catch (error) {
      // A lost response may have committed. Do not restore or retry the old
      // selection; a new unknown handle can expire without affecting siblings.
      this.active = null; throw error;
    } finally { this.busy = false; }
  }
  async exit() {
    if (this.busy) throw new PortalRequestError(409);
    this.busy = true; this.invalidate(); const previous = this.cleanup;
    try { if (previous) { await this.close(previous); this.cleanup = null; } }
    finally { this.busy = false; }
  }
}
