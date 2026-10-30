export type HostClient = { query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> };
export function hostRow(origin: string): { host: string; origin: string };
export function summaryCredit(value: string): string;
export function addCongregationHost(client: HostClient, input: { origin: string; summaryCredit: string; confirm: boolean }): Promise<{ status: "configured" | "already-configured" }>;
export function setSummaryCredit(client: HostClient, input: { summaryCredit: string; confirm: boolean }): Promise<{ status: "configured" }>;
