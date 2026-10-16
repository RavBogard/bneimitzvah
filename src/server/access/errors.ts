import "server-only";

export class AccessDenied extends Error {
  constructor(readonly status: 401 | 403 | 404) {
    super(status === 401 ? "Authentication required" : status === 403 ? "Action not permitted" : "Not found");
    this.name = "AccessDenied";
  }
}

export class AccessUnavailable extends Error {
  readonly status = 503;
  constructor() { super("Access service unavailable"); this.name = "AccessUnavailable"; }
}
