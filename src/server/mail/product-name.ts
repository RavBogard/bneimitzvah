import "server-only";

/**
 * The product's name as mail shows it. It is a per-congregation setting (Daniel, E1, 2026-10-23); until the
 * tenant setting reaches the sign-in path, this one helper returns CRC's value. Change it here, not at call sites.
 */
export function productName(): string { return "CRC Torah"; }
