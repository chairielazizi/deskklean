import path from 'path';
import { runPowerShell, isWindows } from './powershell';

/**
 * Checks whether the current process is running with administrative (elevated) privileges.
 * Executes a PowerShell role check for Administrator.
 * On any failure or non-Windows platform, returns false (fail closed).
 */
export async function isElevated(): Promise<boolean> {
  if (!isWindows()) {
    return false;
  }

  const script =
    '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)';

  try {
    const output = await runPowerShell(script);
    return output.trim().toLowerCase() === 'true';
  } catch {
    return false;
  }
}

/**
 * Relaunches the application executable with elevated administrator privileges via UAC.
 * The UAC prompt is displayed by Windows; this function returns once the command has been issued.
 * The caller is responsible for quitting the application.
 *
 * @param exePath - Non-empty absolute path to the executable to relaunch.
 * @param args - Optional array of command-line arguments to pass to the executable.
 */
export async function relaunchElevated(exePath: string, args?: string[]): Promise<void> {
  if (!isWindows()) {
    throw new Error('Elevation is only supported on Windows');
  }

  if (typeof exePath !== 'string' || exePath.trim().length === 0) {
    throw new Error('exePath must be a non-empty string');
  }

  const trimmed = exePath.trim();
  if (!path.win32.isAbsolute(trimmed) && !path.isAbsolute(trimmed)) {
    throw new Error(`exePath must be an absolute path: ${trimmed}`);
  }

  if (args !== undefined) {
    if (!Array.isArray(args)) {
      throw new Error('args must be an array of strings');
    }
    for (const arg of args) {
      if (typeof arg !== 'string') {
        throw new Error('Each arg must be a string');
      }
      if (arg.includes('"')) {
        throw new Error(`arg cannot contain a double quote: ${arg}`);
      }
    }
  }

  const escapedExe = trimmed.replace(/'/g, "''");

  let script: string;
  if (!args || args.length === 0) {
    script = `Start-Process -FilePath '${escapedExe}' -Verb RunAs`;
  } else {
    const formattedArgs = args.map((arg) => {
      const withTrailingBackslash = arg.endsWith('\\') ? `${arg}\\` : arg;
      const escapedArg = withTrailingBackslash.replace(/'/g, "''");
      return `'"${escapedArg}"'`;
    });
    script = `Start-Process -FilePath '${escapedExe}' -ArgumentList ${formattedArgs.join(',')} -Verb RunAs`;
  }

  await runPowerShell(script);
}

