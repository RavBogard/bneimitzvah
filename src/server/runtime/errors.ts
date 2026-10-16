import "server-only";

export class RuntimeUnavailable extends Error {
  readonly status = 503;
  constructor() { super("Service temporarily unavailable"); this.name = "RuntimeUnavailable"; }
}
