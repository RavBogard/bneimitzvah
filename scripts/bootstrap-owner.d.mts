export type BootstrapClient = { query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> };
export function bootstrapOwner(client: BootstrapClient, input: { email: string; confirm: boolean }): Promise<{ status: "configured" | "already-configured" }>;
