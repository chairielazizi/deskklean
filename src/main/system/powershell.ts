import { spawn, ChildProcess } from 'child_process';
import { warnOnce } from './log';

export interface PowerShellOptions {
  timeoutMs?: number;
}

/**
 * Returns true if the current operating system is Windows.
 */
export const isWindows = (): boolean => process.platform === 'win32';

/**
 * Executes a PowerShell script by spawning powershell.exe.
 * Rejects immediately on non-Windows platforms.
 *
 * @param script - The PowerShell command string to execute.
 * @param opts - Execution options including timeoutMs (default: 15000 ms).
 * @returns Trimmed stdout string from PowerShell.
 */
export const runPowerShell = (
  script: string,
  opts?: PowerShellOptions
): Promise<string> => {
  if (!isWindows()) {
    return Promise.reject(new Error('Windows-only operation'));
  }

  const timeoutMs = opts?.timeoutMs ?? 15000;

  return new Promise<string>((resolve, reject) => {
    const fullScript = `$ErrorActionPreference = 'Stop'; $WarningPreference = 'SilentlyContinue'; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${script}`;

    let child: ChildProcess;
    try {
      child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', fullScript],
        { windowsHide: true }
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reject(new Error(`Failed to spawn powershell.exe: ${message}`));
    }

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch {
        // Ignore kill errors
      }
      reject(new Error(`PowerShell execution timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    if (child.stdout) {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });
    }

    if (child.stderr) {
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });
    }

    child.on('error', (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Failed to start PowerShell process: ${err.message}`));
    });

    child.on('close', (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (code !== 0) {
        const errorDetail = stderr.trim() || `exit code ${code}`;
        reject(new Error(`PowerShell execution failed (code ${code}): ${errorDetail}`));
        return;
      }

      resolve(stdout.trim());
    });
  });
};

/**
 * Executes a PowerShell pipeline and parses the resulting JSON output.
 *
 * Normalization Choice:
 * In Windows PowerShell 5.1, ConvertTo-Json behaves as follows:
 * - When 0 objects are output: produces empty/whitespace stdout.
 * - When exactly 1 object is output: produces a bare JSON object `{ ... }`
 *   (even when piped from a collection).
 * - When 2 or more objects are output: produces a JSON array `[ ... ]`.
 *
 * To provide a predictable shape for callers (especially CIM queries), this function
 * normalizes single bare objects into a single-element array `[parsed]`, empty or
 * whitespace output into an empty array `[]`, and preserves arrays as-is.
 * Empty or whitespace output returns a sane empty value without throwing a JSON parse error.
 *
 * @param body - Optional preparatory PowerShell code statements executed before the pipeline.
 * @param pipeline - The PowerShell command expression whose output will be piped to ConvertTo-Json.
 * @param opts - Execution options including timeoutMs.
 * @returns Normalized parsed JSON response.
 */
export const runPowerShellJson = async <T>(
  body: string,
  pipeline: string,
  opts?: PowerShellOptions
): Promise<T> => {
  const trimmedBody = body.trim();
  const trimmedPipeline = pipeline.trim();
  const script = trimmedBody
    ? `${trimmedBody.endsWith(';') ? trimmedBody : `${trimmedBody};`}\n${trimmedPipeline} | ConvertTo-Json -Depth 6 -Compress`
    : `${trimmedPipeline} | ConvertTo-Json -Depth 6 -Compress`;

  const raw = await runPowerShell(script, opts);

  const parsed = parseJsonSafe<unknown>(raw, null, 'powershell:json');

  if (parsed === null || parsed === undefined) {
    return [] as unknown as T;
  }

  if (Array.isArray(parsed)) {
    return parsed as unknown as T;
  }

  return [parsed] as unknown as T;
};

/**
 * Safely parses a JSON string.
 * - Returns `fallback` when raw is empty or whitespace.
 * - On a JSON.parse failure, calls warnOnce with the context and the first 200 chars of raw,
 *   then returns `fallback`.
 * - Never throws.
 *
 * @param raw - The raw JSON string to parse.
 * @param fallback - The value to return when empty/whitespace or upon parse error.
 * @param context - Context string used as the key for warnOnce logging.
 * @returns Parsed JSON object/array or the fallback value.
 */
export function parseJsonSafe<T>(raw: string, fallback: T, context: string): T {
  if (!raw || raw.trim().length === 0) {
    return fallback;
  }

  try {
    return JSON.parse(raw) as T;
  } catch (err: unknown) {
    warnOnce(context, raw.slice(0, 200), err);
    return fallback;
  }
}

