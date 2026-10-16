export function disposableConfig(): {host:string;port:number;database:string;user:string;password:string;connectionTimeoutMillis:number;statement_timeout:number};
export function query<T extends Record<string, unknown> = Record<string, unknown>>(
  client: {query:(text:string,values?:unknown[])=>Promise<unknown>}, text:string, values?:unknown[],
): Promise<{rows:T[];rowCount:number|null}>;
