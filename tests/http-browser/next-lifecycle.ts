/** Pinned Next 16.4.2 otherwise uses project.onExit(), not project.shutdown(). */
export async function closeNextDevelopment(close: () => Promise<void>) {
  const previous = process.env.__NEXT_DEV_WAIT_FOR_TURBOPACK_SHUTDOWN;
  process.env.__NEXT_DEV_WAIT_FOR_TURBOPACK_SHUTDOWN = "1";
  try { await close(); }
  finally {
    if (previous === undefined) delete process.env.__NEXT_DEV_WAIT_FOR_TURBOPACK_SHUTDOWN;
    else process.env.__NEXT_DEV_WAIT_FOR_TURBOPACK_SHUTDOWN = previous;
  }
}
