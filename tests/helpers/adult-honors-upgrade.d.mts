type UpgradeClient = { query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> };
export function adultUpgradePrefix(home: string): Promise<string>;
export function seedLegacyAdultUpgrade(client: UpgradeClient): Promise<{ studentId: string }>;
export function legacyAdultUpgradeSnapshot(client: UpgradeClient): Promise<Record<string, Record<string, unknown>[]>>;
