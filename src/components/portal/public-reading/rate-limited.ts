import { PortalRequestError } from "../api";

/**
 * The public routes answer 429 when the platform's firewall limit for /api/public/ is passed for one address
 * (a shared connection counts as one). That is not a broken recording or a lost connection, so it is told as
 * what it is. The line is Daniel's, approved verbatim (2.0 F1, "Keep all").
 */
export const RATE_LIMITED_MESSAGE = "Too many requests from this connection. Try again in a minute.";
export const isRateLimited = (error: unknown): boolean => error instanceof PortalRequestError && error.status === 429;
