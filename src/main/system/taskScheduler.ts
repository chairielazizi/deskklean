import { runPowerShell, isWindows } from './powershell';

let electronApp: any;
try {
  electronApp = require('electron').app;
} catch {
  // Standalone node environment (e.g. pure logic unit tests)
}

export const TASK_NAME = 'DeskKlean\\ScheduledClean';

export interface TaskSchedulerState {
  registered: boolean;
  nextRun: string | null;      // real NextRunTime, null when not registered
  lastRun: string | null;
  lastResult: number | null;   // real LastTaskResult
  reason?: string;
}

export interface RegisterTaskResult {
  ok: boolean;
  reason?: string;
  nextRun?: string | null;
}

export interface UnregisterTaskResult {
  ok: boolean;
  reason?: string;
}

export interface TaskSchedulerOptions {
  exePath?: string;
  isPackaged?: boolean;
  isPortable?: boolean;
  runPowerShellFn?: (script: string, opts?: any) => Promise<string>;
  isWindowsFn?: () => boolean;
}

/**
 * Returns the PowerShell trigger snippet for the requested frequency.
 * - Daily: -Daily
 * - Weekly: -Weekly -DaysOfWeek Sunday
 * - Monthly: -Monthly -DaysOfMonth 1
 */
export function getTriggerScript(frequency: 'daily' | 'weekly' | 'monthly'): string {
  switch (frequency) {
    case 'daily':
      return 'New-ScheduledTaskTrigger -Daily -At "03:00"';
    case 'weekly':
      return 'New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At "03:00"';
    case 'monthly':
      return 'New-ScheduledTaskTrigger -Monthly -DaysOfMonth 1 -At "03:00"';
    default:
      throw new Error(`Unsupported frequency: ${frequency}`);
  }
}

/**
 * Queries the current state of the DeskKlean scheduled task in Windows Task Scheduler.
 *
 * Rails:
 * - Query failure returns null, NEVER registered: false (Test 13 invariant).
 * - Real dates or null; never invented values.
 */
export async function getScheduledTaskState(
  opts?: TaskSchedulerOptions
): Promise<TaskSchedulerState | null> {
  const isWin = opts?.isWindowsFn ? opts.isWindowsFn() : isWindows();
  if (!isWin) {
    return null;
  }

  const psRunner = opts?.runPowerShellFn || runPowerShell;
  const script = `
    $task = Get-ScheduledTask -TaskName '${TASK_NAME}' -ErrorAction SilentlyContinue;
    if (-not $task) {
      [PSCustomObject]@{ registered = $false; nextRun = $null; lastRun = $null; lastResult = $null } | ConvertTo-Json -Compress
    } else {
      $info = Get-ScheduledTaskInfo -TaskName '${TASK_NAME}' -ErrorAction Stop;
      $next = if ($info.NextRunTime -and $info.NextRunTime.Year -gt 1900) { $info.NextRunTime.ToString('o') } else { $null };
      $last = if ($info.LastRunTime -and $info.LastRunTime.Year -gt 1900) { $info.LastRunTime.ToString('o') } else { $null };
      [PSCustomObject]@{
        registered = $true;
        nextRun = $next;
        lastRun = $last;
        lastResult = $info.LastTaskResult
      } | ConvertTo-Json -Compress
    }
  `;

  try {
    const raw = await psRunner(script);
    const parsed = JSON.parse(raw.trim());
    return {
      registered: Boolean(parsed.registered),
      nextRun: parsed.nextRun || null,
      lastRun: parsed.lastRun || null,
      lastResult: typeof parsed.lastResult === 'number' ? parsed.lastResult : null,
    };
  } catch {
    // Rail: query failure returns null, never registered: false
    return null;
  }
}

/**
 * Registers the DeskKlean scheduled cleaning task in Windows Task Scheduler.
 *
 * Rails:
 * - Portable builds refuse (Test 10).
 * - Unpackaged builds refuse (Test 11).
 * - Action is process.execPath with '--scheduled-clean'.
 * - Fall back from Highest to Limited run level if user lacks privilege, reporting the limitation.
 * - Verify by re-query: requires confirming the task exists before returning success (Test 12).
 */
export async function registerScheduledTask(
  frequency: 'daily' | 'weekly' | 'monthly',
  opts?: TaskSchedulerOptions
): Promise<RegisterTaskResult> {
  const isPortable =
    opts?.isPortable !== undefined
      ? opts.isPortable
      : Boolean(process.env.PORTABLE_EXECUTABLE_FILE);

  if (isPortable) {
    return {
      ok: false,
      reason:
        'portable builds cannot be scheduled — the executable runs from a temp directory',
    };
  }

  const isPackaged =
    opts?.isPackaged !== undefined
      ? opts.isPackaged
      : (electronApp ? electronApp.isPackaged : process.env.NODE_ENV === 'production');

  if (!isPackaged) {
    return {
      ok: false,
      reason:
        'development builds cannot be scheduled — task scheduler requires an installed application',
    };
  }

  const isWin = opts?.isWindowsFn ? opts.isWindowsFn() : isWindows();
  if (!isWin) {
    return {
      ok: false,
      reason: 'Task Scheduler is only available on Windows',
    };
  }

  const exePath =
    opts?.exePath || (typeof process !== 'undefined' ? process.execPath : '');
  if (!exePath) {
    return {
      ok: false,
      reason: 'Could not determine executable path',
    };
  }

  const psRunner = opts?.runPowerShellFn || runPowerShell;
  const triggerScript = getTriggerScript(frequency);
  const escapedExe = exePath.replace(/'/g, "''");

  const buildRegisterScript = (runLevel: 'Highest' | 'Limited') => `
    $action = New-ScheduledTaskAction -Execute '${escapedExe}' -Argument '--scheduled-clean';
    $trigger = ${triggerScript};
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries;
    $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel ${runLevel};
    Register-ScheduledTask -TaskName '${TASK_NAME}' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null;
  `;

  let limitationReason: string | undefined;

  try {
    await psRunner(buildRegisterScript('Highest'));
  } catch {
    // If Highest privilege fails, fall back to Limited privilege
    try {
      await psRunner(buildRegisterScript('Limited'));
      limitationReason =
        'Task registered with standard user privileges; admin-required categories will be skipped.';
    } catch (limitedErr) {
      const msg = limitedErr instanceof Error ? limitedErr.message : String(limitedErr);
      return {
        ok: false,
        reason: `Failed to register scheduled task: ${msg}`,
      };
    }
  }

  // Verify by re-query (Rail: registration must stick)
  const state = await getScheduledTaskState(opts);
  if (!state || !state.registered) {
    return {
      ok: false,
      reason: 'Registration verification failed: task not found in Task Scheduler after creation',
    };
  }

  return {
    ok: true,
    nextRun: state.nextRun,
    reason: limitationReason,
  };
}

/**
 * Unregisters the DeskKlean scheduled task from Windows Task Scheduler.
 * Re-queries to confirm it is gone.
 */
export async function unregisterScheduledTask(
  opts?: TaskSchedulerOptions
): Promise<UnregisterTaskResult> {
  const isWin = opts?.isWindowsFn ? opts.isWindowsFn() : isWindows();
  if (!isWin) {
    return {
      ok: false,
      reason: 'Task Scheduler is only available on Windows',
    };
  }

  const psRunner = opts?.runPowerShellFn || runPowerShell;
  const script = `Unregister-ScheduledTask -TaskName '${TASK_NAME}' -Confirm:$false -ErrorAction Stop;`;

  try {
    await psRunner(script);
  } catch (err) {
    // If the task did not exist in the first place, that's fine
    const state = await getScheduledTaskState(opts);
    if (state && !state.registered) {
      return { ok: true };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `Failed to unregister scheduled task: ${msg}` };
  }

  // Confirm task is gone
  const state = await getScheduledTaskState(opts);
  if (state === null) {
    return {
      ok: false,
      reason: 'Failed to verify task unregistration: state query failed',
    };
  }
  if (state.registered) {
    return {
      ok: false,
      reason: 'Failed to unregister scheduled task: task still exists',
    };
  }

  return { ok: true };
}
