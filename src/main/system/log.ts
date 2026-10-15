const seenKeys = new Set<string>();

/**
 * Logs the first occurrence of `key` at warn level with its message and, if
 * given, the error's message and stack. Every later call with the same key is
 * SILENT.
 */
export function warnOnce(key: string, message: string, err?: unknown): void {
  if (seenKeys.has(key)) {
    return;
  }
  seenKeys.add(key);

  if (err instanceof Error) {
    const errorDetails = err.stack?.includes(err.message)
      ? err.stack
      : `${err.message}${err.stack ? `\n${err.stack}` : ''}`;
    console.warn(`[${key}] ${message}: ${errorDetails}`);
  } else if (err !== undefined && err !== null) {
    console.warn(`[${key}] ${message}: ${String(err)}`);
  } else {
    console.warn(`[${key}] ${message}`);
  }
}

/**
 * Clears the seen-keys set. Primarily for testing.
 */
export function resetWarnOnce(): void {
  seenKeys.clear();
}
