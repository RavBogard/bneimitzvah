export function isolatedEnv(extra?: Record<string, string>): Promise<{
  env: NodeJS.ProcessEnv;
  home: string;
  cleanup: () => Promise<void>;
}>;
