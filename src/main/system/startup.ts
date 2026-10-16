import fs from 'fs';
import os from 'os';
import path from 'path';
import { runPowerShell, parseJsonSafe, isWindows } from './powershell';
import {
  readKeyValues,
  readValue,
  ReadValueResult,
  decodeStartupApproved,
  encodeStartupApproved,
  buildRegSnippet,
  mergeRegSnippets,
} from './registry';
import { warnOnce } from './log';
import { isElevated } from './elevation';
import { StartupItem, StartupImpact, StartupItemTarget } from '../../shared/types';
import {
  writeRegBackupFile,
  getModuleBackupDir,
  listModuleBackups,
  validateBackupForRestore,
} from './framework/backup';
import { createOperationPlan } from './framework/plan';
import { executeOperationPlan } from './framework/execute';
import {
  StartupBackup,
  StartupDelayState,
  OperationPlan,
  ExecuteResult,
} from './framework/types';

interface RawStartupFolderItem {
  Scope: 'common' | 'user';
  FileName: string;
  Target: string;
  Arguments: string;
  FullName: string;
}

interface RawScheduledTaskItem {
  TaskName: string;
  TaskPath: string;
  State: string;
  Execute: string;
  Arguments: string;
}

interface RawEvent101 {
  TimeCreated: string;
  FileName: string;
  TotalTime: number;
  DegradationTime: number;
}

/**
 * Converts text into a URL/ID-safe slug for stable identifiers.
 */
function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'item'
  );
}

/**
 * Escapes single quotes for PowerShell single-quoted string literals.
 */
function escapePsSingleQuote(str: string): string {
  return str.replace(/'/g, "''");
}

/**
 * Extracts the executable or script file path from a command string.
 * Handles quoted paths (e.g. '"C:\Program Files\App\app.exe" /arg')
 * and bare unquoted paths with spaces (e.g. 'C:\Program Files\App\app.exe -silent').
 *
 * @param command - The raw command string.
 * @returns Clean executable path, or original trimmed command if extraction fails.
 */
export function extractExePath(command: string): string {
  const trimmed = command.trim();
  if (trimmed.startsWith('"')) {
    const nextQuote = trimmed.indexOf('"', 1);
    if (nextQuote !== -1) {
      return trimmed.slice(1, nextQuote);
    }
  }

  // Matches path with drive letter or environment variable up to executable extension:
  const match = trimmed.match(
    /^((?:%[^%]+%|[a-zA-Z]:)[^/:*?"<>|]+?\.(?:exe|com|bat|cmd|vbs))/i
  );
  if (match) {
    return match[1];
  }

  const firstSpace = trimmed.indexOf(' ');
  if (firstSpace !== -1) {
    return trimmed.slice(0, firstSpace);
  }
  return trimmed;
}

/**
 * Boot impact thresholds derived from Diagnostics-Performance Event 101 DegradationTime:
 * - High:   >= 1000 ms (degrades boot by 1 second or more)
 * - Medium: >= 300 ms and < 1000 ms (noticeable delay between 300ms and 1s)
 * - Low:    > 0 ms and < 300 ms (minor delay under 300ms)
 * - None:   null (no Event 101 recorded) or <= 0 ms
 *
 * @param degradationTimeMs - Event 101 degradation time in milliseconds, or null if unmeasured.
 * @returns StartupImpact level.
 */
export function calculateImpact(degradationTimeMs: number | null): StartupImpact {
  if (degradationTimeMs === null || degradationTimeMs <= 0) {
    return 'none';
  }
  if (degradationTimeMs >= 1000) {
    return 'high';
  }
  if (degradationTimeMs >= 300) {
    return 'medium';
  }
  return 'low';
}

/**
 * Queries the user and common Startup folders for .lnk and executable items.
 */
async function queryStartupFolders(): Promise<RawStartupFolderItem[]> {
  const script = `
    $paths = @(
      [PSCustomObject]@{ Scope = 'common'; Dir = "$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\StartUp" },
      [PSCustomObject]@{ Scope = 'user'; Dir = "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs\\Startup" }
    );
    $wscript = $null;
    $results = @();
    foreach ($entry in $paths) {
      if (Test-Path -LiteralPath $entry.Dir) {
        $files = Get-ChildItem -LiteralPath $entry.Dir -File -ErrorAction SilentlyContinue;
        foreach ($f in $files) {
          $target = $f.FullName;
          $args = '';
          if ($f.Extension -eq '.lnk') {
            try {
              if ($null -eq $wscript) { $wscript = New-Object -ComObject WScript.Shell }
              $shortcut = $wscript.CreateShortcut($f.FullName);
              $target = $shortcut.TargetPath;
              $args = $shortcut.Arguments;
            } catch {}
          }
          $results += [PSCustomObject]@{
            Scope = $entry.Scope;
            FileName = $f.Name;
            Target = $target;
            Arguments = $args;
            FullName = $f.FullName;
          };
        }
      }
    }
    if ($null -ne $wscript) {
      try { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($wscript) | Out-Null } catch {}
    }
    $results | ConvertTo-Json -Depth 3 -Compress
  `.trim();

  const raw = await runPowerShell(script);
  const parsed = parseJsonSafe<unknown>(raw, [], 'startup:folders');
  if (Array.isArray(parsed)) {
    return parsed as RawStartupFolderItem[];
  }
  if (parsed && typeof parsed === 'object') {
    return [parsed as RawStartupFolderItem];
  }
  return [];
}

/**
 * Queries scheduled tasks triggered at logon or boot, skipping Windows OS-owned tasks.
 */
async function queryScheduledTasks(): Promise<RawScheduledTaskItem[]> {
  const script = `
    Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object {
      $_.TaskPath -notmatch '^\\\\Microsoft\\\\Windows\\\\' -and
      ($_.Triggers | Where-Object { $_.CimClass.CimClassName -match 'Logon|Boot' })
    } | ForEach-Object {
      $exec = '';
      $args = '';
      if ($_.Actions) {
        $action = $_.Actions | Where-Object { $_.Execute } | Select-Object -First 1;
        if ($action) {
          $exec = $action.Execute;
          $args = $action.Arguments;
        }
      }
      [PSCustomObject]@{
        TaskName = $_.TaskName;
        TaskPath = $_.TaskPath;
        State = $_.State.ToString();
        Execute = $exec;
        Arguments = $args;
      }
    } | ConvertTo-Json -Depth 3 -Compress
  `.trim();

  const raw = await runPowerShell(script);
  const parsed = parseJsonSafe<unknown>(raw, [], 'startup:scheduledTasks');
  if (Array.isArray(parsed)) {
    return parsed as RawScheduledTaskItem[];
  }
  if (parsed && typeof parsed === 'object') {
    return [parsed as RawScheduledTaskItem];
  }
  return [];
}

/**
 * Queries Event 101 from the Diagnostics-Performance event log to obtain degradation time.
 * Gracefully degrades on access denied or query failure.
 */
async function queryEvent101Impacts(): Promise<Map<string, number>> {
  const script = `
    $log = 'Microsoft-Windows-Diagnostics-Performance/Operational';
    $events = @();
    try {
      $events = @(Get-WinEvent -LogName $log -FilterXPath '*[System[EventID=101]]' -MaxEvents 200 -ErrorAction Stop);
    } catch {
      # "no events found" is not an error, and this log may need elevation
      try {
        $events = @(Get-WinEvent -LogName $log -MaxEvents 500 -ErrorAction Stop |
          Where-Object { $_.Id -eq 101 });
      } catch {
        $msg = $_.Exception.Message;
        if ($msg -and $msg -notmatch 'No events|access.*denied|permission|unauthorized') {
          [Console]::Error.WriteLine($msg);
        }
        $events = @();
      }
    }

    if ($events.Count -eq 0) {
      '[]'
    } else {
      $parsed = @($events | ForEach-Object {
        $xml = [xml]$_.ToXml();
        $dataNodes = $xml.Event.EventData.Data;
        $fileName = '';
        $totalTime = 0;
        $degradationTime = 0;
        foreach ($d in $dataNodes) {
          if ($d.Name -eq 'FileName' -or $d.Name -eq 'Name') { $fileName = $d.'#text' }
          elseif ($d.Name -eq 'TotalTime') { $totalTime = [int]($d.'#text') }
          elseif ($d.Name -eq 'DegradationTime') { $degradationTime = [int]($d.'#text') }
        }
        if (-not $fileName -and $dataNodes.Count -gt 1) {
          $fileName = $dataNodes[0].'#text';
        }
        [PSCustomObject]@{
          TimeCreated = $_.TimeCreated.ToString('o');
          FileName = $fileName;
          TotalTime = $totalTime;
          DegradationTime = $degradationTime;
        }
      });
      if ($parsed.Count -eq 0) {
        '[]'
      } else {
        $parsed | ConvertTo-Json -Depth 2 -Compress
      }
    }
  `.trim();

  let raw = '';
  try {
    raw = await runPowerShell(script);
  } catch (err) {
    warnOnce('event101:unavailable', 'Failed to query Diagnostics-Performance Event 101 log', err);
    return new Map<string, number>();
  }

  const parsed = parseJsonSafe<unknown>(raw, [], 'event101:unavailable');
  const events: RawEvent101[] = Array.isArray(parsed)
    ? (parsed as RawEvent101[])
    : parsed && typeof parsed === 'object'
    ? [parsed as RawEvent101]
    : [];

  const impactMap = new Map<string, number>();
  // Get-WinEvent returns events in reverse chronological order (newest first).
  // Record the first encountered (most recent) event per file name.
  for (const ev of events) {
    if (!ev.FileName) continue;
    const baseName = path.basename(ev.FileName).toLowerCase();
    if (!impactMap.has(baseName)) {
      impactMap.set(baseName, ev.DegradationTime);
    }
  }

  return impactMap;
}

/**
 * Resolves publishers for a batch of executable file paths by reading FileVersionInfo.CompanyName.
 */
async function queryPublishers(exePaths: string[]): Promise<Record<string, string>> {
  if (exePaths.length === 0) {
    return {};
  }

  const escapedPaths = exePaths.map((p) => `'${escapePsSingleQuote(p)}'`).join(',');
  const script = `
    $paths = @(${escapedPaths});
    $res = @{};
    foreach ($p in $paths) {
      if ($p) {
        try {
          $expanded = [System.Environment]::ExpandEnvironmentVariables($p);
          if (Test-Path -LiteralPath $expanded) {
            $item = Get-Item -LiteralPath $expanded -ErrorAction SilentlyContinue;
            $company = $item.VersionInfo.CompanyName;
            if ($company) { $res[$p] = $company.Trim() }
          }
        } catch {}
      }
    }
    $res | ConvertTo-Json -Compress
  `.trim();

  const raw = await runPowerShell(script);
  const parsed = parseJsonSafe<Record<string, string>>(raw, {}, 'publisher:lookup');
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as Record<string, string>;
  }
  return {};
}

interface RawDiscoveredItem {
  id: string;
  name: string;
  command: string;
  location: StartupItem['location'];
  source: 'registry' | 'folder' | 'task';
  enabled: boolean;
  target: StartupItemTarget;
}

/**
 * Enumerates all startup items across Registry Run/RunOnce keys, Startup folders, and Scheduled Tasks.
 * Matches enabled state via StartupApproved keys, looks up real publishers from file version info,
 * and attaches boot impact metrics from the Diagnostics-Performance event log.
 *
 * @returns Array of fully-populated StartupItem objects.
 */
export async function getStartupItems(): Promise<StartupItem[]> {
  if (!isWindows()) {
    throw new Error('Startup items are only available on Windows');
  }

  // 1. Concurrently query all registry Run keys, StartupApproved keys, folders, tasks, and event log.
  // Each source degrades independently: failures in one section never abort the whole scan.
  const [
    hkcuRun,
    hkcuRunOnce,
    hklmRun,
    hklmRunOnce,
    hklmRun32,
    hkcuApprovedRun,
    hkcuApprovedRun32,
    hkcuApprovedFolder,
    hklmApprovedRun,
    hklmApprovedRun32,
    hklmApprovedFolder,
    folderItems,
    taskItems,
    event101ImpactMap,
  ] = await Promise.all([
    readKeyValues('HKCU', 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run').catch((err) => {
      warnOnce('startup:hkcu-run', 'Failed to read HKCU Run key', err);
      return {} as Record<string, unknown>;
    }),
    readKeyValues('HKCU', 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\RunOnce').catch((err) => {
      warnOnce('startup:hkcu-runonce', 'Failed to read HKCU RunOnce key', err);
      return {} as Record<string, unknown>;
    }),
    readKeyValues('HKLM', 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run').catch((err) => {
      warnOnce('startup:hklm-run', 'Failed to read HKLM Run key', err);
      return {} as Record<string, unknown>;
    }),
    readKeyValues('HKLM', 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\RunOnce').catch((err) => {
      warnOnce('startup:hklm-runonce', 'Failed to read HKLM RunOnce key', err);
      return {} as Record<string, unknown>;
    }),
    readKeyValues('HKLM', 'SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run').catch((err) => {
      warnOnce('startup:hklm-run32', 'Failed to read HKLM WOW6432Node Run key', err);
      return {} as Record<string, unknown>;
    }),
    readKeyValues('HKCU', 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run').catch((err) => {
      warnOnce('startup:hkcu-approved-run', 'Failed to read HKCU StartupApproved\\Run', err);
      return {} as Record<string, unknown>;
    }),
    readKeyValues('HKCU', 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run32').catch((err) => {
      warnOnce('startup:hkcu-approved-run32', 'Failed to read HKCU StartupApproved\\Run32', err);
      return {} as Record<string, unknown>;
    }),
    readKeyValues('HKCU', 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder').catch((err) => {
      warnOnce('startup:hkcu-approved-folder', 'Failed to read HKCU StartupApproved\\StartupFolder', err);
      return {} as Record<string, unknown>;
    }),
    readKeyValues('HKLM', 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run').catch((err) => {
      warnOnce('startup:hklm-approved-run', 'Failed to read HKLM StartupApproved\\Run', err);
      return {} as Record<string, unknown>;
    }),
    readKeyValues('HKLM', 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run32').catch((err) => {
      warnOnce('startup:hklm-approved-run32', 'Failed to read HKLM StartupApproved\\Run32', err);
      return {} as Record<string, unknown>;
    }),
    readKeyValues('HKLM', 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder').catch((err) => {
      warnOnce('startup:hklm-approved-folder', 'Failed to read HKLM StartupApproved\\StartupFolder', err);
      return {} as Record<string, unknown>;
    }),
    queryStartupFolders().catch((err) => {
      warnOnce('startup:folders', 'Failed to query startup folders', err);
      return [];
    }),
    queryScheduledTasks().catch((err) => {
      warnOnce('startup:tasks', 'Failed to query scheduled tasks', err);
      return [];
    }),
    queryEvent101Impacts().catch((err) => {
      warnOnce('event101:unavailable', 'Failed to query Diagnostics-Performance Event 101 log', err);
      return new Map<string, number>();
    }),
  ]);

  const rawItems: RawDiscoveredItem[] = [];

  // HKCU Run
  for (const [name, val] of Object.entries(hkcuRun)) {
    if (typeof val !== 'string') continue;
    const rawFlag = hkcuApprovedRun[name];
    const enabled = rawFlag !== undefined ? decodeStartupApproved(rawFlag) : true;
    rawItems.push({
      id: `hkcu-run-${slugify(name)}`,
      name,
      command: val,
      location: 'HKCU_RUN',
      source: 'registry',
      enabled,
      target: {
        kind: 'registry',
        hive: 'HKCU',
        keyPath: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run',
        valueName: name,
        approvedKeyPath: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run',
        approvedValueName: name,
      },
    });
  }

  // HKCU RunOnce (no StartupApproved key — always enabled)
  for (const [name, val] of Object.entries(hkcuRunOnce)) {
    if (typeof val !== 'string') continue;
    rawItems.push({
      id: `hkcu-runonce-${slugify(name)}`,
      name,
      command: val,
      location: 'HKCU_RUNONCE',
      source: 'registry',
      enabled: true,
      target: {
        kind: 'registry',
        hive: 'HKCU',
        keyPath: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\RunOnce',
        valueName: name,
      },
    });
  }

  // HKLM Run
  for (const [name, val] of Object.entries(hklmRun)) {
    if (typeof val !== 'string') continue;
    const rawFlag = hklmApprovedRun[name];
    const enabled = rawFlag !== undefined ? decodeStartupApproved(rawFlag) : true;
    rawItems.push({
      id: `hklm-run-${slugify(name)}`,
      name,
      command: val,
      location: 'HKLM_RUN',
      source: 'registry',
      enabled,
      target: {
        kind: 'registry',
        hive: 'HKLM',
        keyPath: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run',
        valueName: name,
        approvedKeyPath: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run',
        approvedValueName: name,
      },
    });
  }

  // HKLM RunOnce (no StartupApproved key — always enabled)
  for (const [name, val] of Object.entries(hklmRunOnce)) {
    if (typeof val !== 'string') continue;
    rawItems.push({
      id: `hklm-runonce-${slugify(name)}`,
      name,
      command: val,
      location: 'HKLM_RUNONCE',
      source: 'registry',
      enabled: true,
      target: {
        kind: 'registry',
        hive: 'HKLM',
        keyPath: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\RunOnce',
        valueName: name,
      },
    });
  }

  // HKLM WOW6432Node Run (StartupApproved\Run32)
  for (const [name, val] of Object.entries(hklmRun32)) {
    if (typeof val !== 'string') continue;
    const rawFlag = hklmApprovedRun32[name];
    const enabled = rawFlag !== undefined ? decodeStartupApproved(rawFlag) : true;
    rawItems.push({
      id: `hklm-run32-${slugify(name)}`,
      name,
      command: val,
      location: 'HKLM_RUN',
      source: 'registry',
      enabled,
      target: {
        kind: 'registry',
        hive: 'HKLM',
        keyPath: 'SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run',
        valueName: name,
        approvedKeyPath: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run32',
        approvedValueName: name,
      },
    });
  }

  // Startup folders
  for (const folderItem of folderItems) {
    const isUser = folderItem.Scope === 'user';
    const approvedMap: Record<string, unknown> = isUser ? hkcuApprovedFolder : hklmApprovedFolder;
    const rawFlag = approvedMap[folderItem.FileName];
    const enabled = rawFlag !== undefined ? decodeStartupApproved(rawFlag) : true;
    const command =
      folderItem.Arguments && folderItem.Arguments.trim().length > 0
        ? `"${folderItem.Target}" ${folderItem.Arguments.trim()}`
        : folderItem.Target || folderItem.FullName;

    rawItems.push({
      id: `folder-${folderItem.Scope}-${slugify(folderItem.FileName)}`,
      name: folderItem.FileName.replace(/\.lnk$/i, ''),
      command,
      location: 'STARTUP_FOLDER',
      source: 'folder',
      enabled,
      target: {
        kind: 'folder',
        hive: isUser ? 'HKCU' : 'HKLM',
        approvedKeyPath: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder',
        approvedValueName: folderItem.FileName,
      },
    });
  }

  // Scheduled tasks
  for (const task of taskItems) {
    const command =
      task.Execute && task.Arguments && task.Arguments.trim().length > 0
        ? `"${task.Execute}" ${task.Arguments.trim()}`
        : task.Execute || 'Scheduled Task';
    const enabled = task.State ? task.State.toLowerCase() !== 'disabled' : true;

    rawItems.push({
      id: `task-${slugify(task.TaskPath)}-${slugify(task.TaskName)}`,
      name: task.TaskName,
      command,
      location: 'SCHEDULED_TASK',
      source: 'task',
      enabled,
      target: {
        kind: 'task',
        taskPath: task.TaskPath,
        taskName: task.TaskName,
      },
    });
  }

  // 2. Resolve publishers in batch from target executable file version info
  const distinctExePaths = Array.from(
    new Set(
      rawItems
        .map((item) => extractExePath(item.command))
        .filter((p) => p && p.length > 0)
    )
  );

  let publisherMap: Record<string, string> = {};
  try {
    publisherMap = await queryPublishers(distinctExePaths);
  } catch (err) {
    warnOnce('publisher:lookup', 'Failed to resolve publishers', err);
  }

  // 3. Assemble final StartupItem models with real publisher and boot impact
  const items: StartupItem[] = rawItems.map((raw) => {
    const exePath = extractExePath(raw.command);
    const exeBase = path.basename(exePath).toLowerCase();

    const pub = publisherMap[exePath];
    const publisher = pub && pub.trim().length > 0 ? pub.trim() : 'Unknown';

    const degradationMs = event101ImpactMap.get(exeBase) ?? null;
    const impact = calculateImpact(degradationMs);

    return {
      id: raw.id,
      name: raw.name,
      publisher,
      command: raw.command,
      location: raw.location,
      impact,
      enabled: raw.enabled,
      estimatedBootImpactMs: degradationMs,
      source: raw.source,
      target: raw.target,
    };
  });

  return items;
}

/**
 * Toggles a startup item enabled or disabled by updating its StartupApproved registry flag.
 *
 * Safety requirements enforced:
 * - 6a. Re-enumerates startup items to resolve id; does NOT parse id string.
 * - 6b. Refuses non-registry items without approvedKeyPath, scheduled tasks, and RunOnce.
 * - 6c. Gates HKLM writes behind UAC elevation check; fails closed without attempting write.
 * - 6d. Generates minimal single-value .reg backup written as UTF-16LE with BOM to %APPDATA%\DeskKlean\backups\startup\
 *       and aborts if backup fails.
 * - 6e. Writes StartupApproved flag without deleting Run values.
 * - 6f. Confirms read-back state matches intended state before reporting success.
 *
 * @param id - The stable startup item identifier.
 * @param enabled - The intended enabled state.
 * @returns Object with success boolean, optional error message, and optional backupPath.
 */
export async function toggleStartupItem(
  id: string,
  enabled: boolean
): Promise<{ success: boolean; message?: string; backupPath?: string }> {
  if (!isWindows()) {
    return { success: false, message: 'Startup items are only available on Windows.' };
  }

  // 6a. RE-ENUMERATE to resolve the id. Call getStartupItems() and find the item whose id matches.
  const items = await getStartupItems();
  const item = items.find((i) => i.id === id);
  if (!item) {
    return { success: false, message: 'Startup item not found. Rescan and try again.' };
  }

  const { target } = item;

  // 6b. REFUSE non-registry / unsupported items
  if (target.kind === 'task') {
    return { success: false, message: 'Scheduled task toggling is not implemented yet.' };
  }

  if (!target.approvedKeyPath || !target.approvedValueName) {
    return {
      success: false,
      message: 'RunOnce entries have no disable flag in Windows and cannot be disabled non-destructively.',
    };
  }

  if (target.kind !== 'registry' && target.kind !== 'folder') {
    return { success: false, message: 'Unsupported startup item kind.' };
  }

  // 6c. ELEVATION GATE
  const hive = target.hive;
  if (!hive || (hive !== 'HKCU' && hive !== 'HKLM')) {
    return { success: false, message: 'Unknown or missing registry hive.' };
  }

  if (hive === 'HKLM' && !(await isElevated())) {
    return {
      success: false,
      message: 'Administrator rights are required to change HKLM startup items.',
    };
  }

  // 6d. BACK UP BEFORE WRITING
  // 1. the Run value (hive, keyPath, valueName, data)
  // 2. the StartupApproved flag value, if it exists
  let backupFilePath = '';
  try {
    const backupDir = getModuleBackupDir('startup');
    const isoTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const rawValName = target.valueName || target.approvedValueName || item.name;
    const sanitizedValName = rawValName.replace(/[^a-zA-Z0-9._-]+/g, '_');
    const backupFileName = `${isoTimestamp}-${hive}-${sanitizedValName}.reg`;
    backupFilePath = path.join(backupDir, backupFileName);

    const snippets: string[] = [];

    // 1. Run value (if registry kind)
    if (target.kind === 'registry') {
      if (!target.keyPath || !target.valueName) {
        return { success: false, message: 'Backup failed; no changes were made.' };
      }
      const runVal = await readValue(hive, target.keyPath, target.valueName);
      if (!runVal.exists || runVal.data === undefined || runVal.data === null) {
        return { success: false, message: 'Backup failed; no changes were made.' };
      }
      const runData =
        typeof runVal.data === 'string' ||
        typeof runVal.data === 'number' ||
        Array.isArray(runVal.data) ||
        Buffer.isBuffer(runVal.data) ||
        runVal.data instanceof Uint8Array
          ? (runVal.data as string | number | number[] | Buffer | Uint8Array)
          : String(runVal.data);
      const runSnippet = buildRegSnippet(
        hive,
        target.keyPath,
        target.valueName,
        runData,
        runVal.type || 'REG_SZ'
      );
      snippets.push(runSnippet);
    }

    // 2. StartupApproved flag value (uniformly for both 'registry' and 'folder')
    const approvedVal = await readValue(hive, target.approvedKeyPath, target.approvedValueName);
    if (approvedVal.exists && approvedVal.data !== undefined && approvedVal.data !== null) {
      let rawBytes: number[] = [];
      if (Array.isArray(approvedVal.data)) {
        rawBytes = approvedVal.data.map((x) => Number(x));
      } else if (Buffer.isBuffer(approvedVal.data) || approvedVal.data instanceof Uint8Array) {
        rawBytes = Array.from(approvedVal.data);
      } else if (typeof approvedVal.data === 'string') {
        const trimmed = approvedVal.data.trim();
        const isHex = /^[0-9a-fA-F\s]+$/.test(trimmed) && !trimmed.includes('=');
        const buf = Buffer.from(trimmed.replace(/\s+/g, ''), isHex ? 'hex' : 'base64');
        rawBytes = Array.from(buf);
      } else if (typeof approvedVal.data === 'object') {
        const obj = approvedVal.data as Record<string, unknown>;
        if (Array.isArray(obj.data)) {
          rawBytes = obj.data.map((x) => Number(x));
        } else {
          rawBytes = Object.values(obj).map((x) => Number(x));
        }
      }

      if (rawBytes.length > 0) {
        const approvedSnippet = buildRegSnippet(
          hive,
          target.approvedKeyPath,
          target.approvedValueName,
          rawBytes,
          'REG_BINARY'
        );
        snippets.push(approvedSnippet);
      } else {
        const deleteSnippet = buildRegSnippet(
          hive,
          target.approvedKeyPath,
          target.approvedValueName,
          undefined,
          'DELETE'
        );
        snippets.push(deleteSnippet);
      }
    } else {
      // For any item where StartupApproved flag didn't exist before,
      // on rollback removing the flag restores original enabled state.
      const deleteSnippet = buildRegSnippet(
        hive,
        target.approvedKeyPath,
        target.approvedValueName,
        undefined,
        'DELETE'
      );
      snippets.push(deleteSnippet);
    }

    writeRegBackupFile(backupFilePath, snippets, {
      module: 'startup-optimizer',
      itemName: item.name,
      hive,
      location: item.location,
      valueName: rawValName,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    warnOnce('startup:backup-failed', 'Failed to create backup before registry write', err);
    return { success: false, message: 'Backup failed; no changes were made.' };
  }

  // 6e. WRITE THE FLAG
  const bytes = encodeStartupApproved(enabled);
  const bytesCsv = bytes.join(',');
  const psPath = `${hive}:\\${target.approvedKeyPath.replace(/^[\\\/]+/, '')}`;
  const escapedPath = escapePsSingleQuote(psPath);
  const escapedName = escapePsSingleQuote(target.approvedValueName);

  const writeScript = `
    $p = '${escapedPath}';
    if (-not (Test-Path -LiteralPath $p)) { New-Item -Path $p -Force | Out-Null }
    New-ItemProperty -LiteralPath $p -Name '${escapedName}' -Value ([byte[]](${bytesCsv})) -PropertyType Binary -Force | Out-Null
  `.trim();

  try {
    await runPowerShell(writeScript);
  } catch (err) {
    warnOnce('startup:write-failed', 'Failed to write StartupApproved registry flag', err);
    return { success: false, message: 'Write could not be verified.' };
  }

  // 6f. VERIFY THE WRITE
  const verification = await readValue(hive, target.approvedKeyPath, target.approvedValueName);
  if (!verification.exists || decodeStartupApproved(verification.data) !== enabled) {
    return { success: false, message: 'Write could not be verified.' };
  }

  // 6g. Return confirmed success (caller logs with logActivity)
  return { success: true, backupPath: backupFilePath };
}

// ---------------------------------------------------------------------------
// STEP 7 — Global startup delay control
// Location: HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Serialize
// ---------------------------------------------------------------------------

export const SERIALIZE_KEY_PATH = 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Serialize';
export const STARTUP_DELAY_VALUE = 'StartupDelayInMSec';
export const WAIT_FOR_IDLE_VALUE = 'WaitForIdleState';

/**
 * Reads the global Windows startup delay and CPU idle wait settings.
 *
 * Location: HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Serialize
 * - StartupDelayInMSec (REG_DWORD): ms to wait before launching startup apps. Absent = Windows default (~10s).
 * - WaitForIdleState (REG_DWORD): 0 = do not also wait for CPU idle. Absent = Windows default (waits for CPU idle).
 *
 * Rails:
 * - null and 0 are different states and must not be conflated. Absent means default (null); 0 means explicitly no delay.
 * - HKCU only — no elevation needed.
 * - Non-Windows returns { delayMs: null, waitForIdle: null, supported: false }.
 */
export async function getStartupDelay(): Promise<StartupDelayState> {
  if (!isWindows()) {
    return { delayMs: null, waitForIdle: null, supported: false };
  }

  const [delayVal, idleVal] = await Promise.all([
    readValue('HKCU', SERIALIZE_KEY_PATH, STARTUP_DELAY_VALUE).catch(
      (): ReadValueResult => ({ exists: false })
    ),
    readValue('HKCU', SERIALIZE_KEY_PATH, WAIT_FOR_IDLE_VALUE).catch(
      (): ReadValueResult => ({ exists: false })
    ),
  ]);

  let delayMs: number | null = null;
  if (delayVal.exists && delayVal.data !== undefined && delayVal.data !== null) {
    const parsed = Number(delayVal.data);
    delayMs = Number.isNaN(parsed) ? null : parsed;
  }

  let waitForIdle: boolean | null = null;
  if (idleVal.exists && idleVal.data !== undefined && idleVal.data !== null) {
    const parsed = Number(idleVal.data);
    waitForIdle = !Number.isNaN(parsed) ? parsed !== 0 : null;
  }

  return {
    delayMs,
    waitForIdle,
    supported: true,
  };
}

/**
 * Sets the global Windows startup delay and CPU idle wait settings.
 *
 * Rails:
 * - HKCU only — no elevation.
 * - Create the Serialize key if missing.
 * - ms === null: deletes StartupDelayInMSec and WaitForIdleState, restoring Windows default (~10s).
 * - ms !== null: writes StartupDelayInMSec as REG_DWORD.
 * - waitForIdle: written as 1 (wait) or 0 (don't wait) when setting delay, or deleted on reset.
 * - Verified by read-back: confirmed matching intended state before reporting success.
 * - Undo is deleting the values.
 */
export async function setStartupDelay(
  ms: number | null,
  waitForIdle: boolean
): Promise<{ success: boolean; message?: string }> {
  if (!isWindows()) {
    return { success: false, message: 'Global startup delay is only supported on Windows.' };
  }

  const psKeyPath = `HKCU:\\${SERIALIZE_KEY_PATH}`;
  const escapedKeyPath = escapePsSingleQuote(psKeyPath);

  if (ms === null) {
    // Reset to Windows default: delete the values
    const resetScript = `
      $p = '${escapedKeyPath}';
      if (Test-Path -LiteralPath $p) {
        Remove-ItemProperty -LiteralPath $p -Name '${STARTUP_DELAY_VALUE}' -ErrorAction SilentlyContinue | Out-Null;
        Remove-ItemProperty -LiteralPath $p -Name '${WAIT_FOR_IDLE_VALUE}' -ErrorAction SilentlyContinue | Out-Null;
      }
    `.trim();

    try {
      await runPowerShell(resetScript);
    } catch (err) {
      warnOnce('startup:delay-reset-failed', 'Failed to reset global startup delay in registry', err);
      return { success: false, message: 'Failed to reset startup delay in registry.' };
    }

    // Verify read-back: values must no longer exist
    const [delayCheck, idleCheck] = await Promise.all([
      readValue('HKCU', SERIALIZE_KEY_PATH, STARTUP_DELAY_VALUE),
      readValue('HKCU', SERIALIZE_KEY_PATH, WAIT_FOR_IDLE_VALUE),
    ]);

    if (delayCheck.exists || idleCheck.exists) {
      return { success: false, message: 'Write could not be verified: values were not removed.' };
    }

    return { success: true };
  }

  // Set explicitly configured delay
  const sanitizedMs = Math.max(0, Math.floor(ms));
  const idleDword = waitForIdle ? 1 : 0;

  const setScript = `
    $p = '${escapedKeyPath}';
    if (-not (Test-Path -LiteralPath $p)) {
      New-Item -Path $p -Force | Out-Null;
    }
    New-ItemProperty -LiteralPath $p -Name '${STARTUP_DELAY_VALUE}' -Value ([int]${sanitizedMs}) -PropertyType DWord -Force | Out-Null;
    New-ItemProperty -LiteralPath $p -Name '${WAIT_FOR_IDLE_VALUE}' -Value ([int]${idleDword}) -PropertyType DWord -Force | Out-Null;
  `.trim();

  try {
    await runPowerShell(setScript);
  } catch (err) {
    warnOnce('startup:delay-write-failed', 'Failed to write global startup delay to registry', err);
    return { success: false, message: 'Failed to write startup delay to registry.' };
  }

  // Verify read-back: values must match what was written
  const [delayCheck, idleCheck] = await Promise.all([
    readValue('HKCU', SERIALIZE_KEY_PATH, STARTUP_DELAY_VALUE),
    readValue('HKCU', SERIALIZE_KEY_PATH, WAIT_FOR_IDLE_VALUE),
  ]);

  if (
    !delayCheck.exists ||
    Number(delayCheck.data) !== sanitizedMs ||
    !idleCheck.exists ||
    Number(idleCheck.data) !== idleDword
  ) {
    return { success: false, message: 'Write could not be verified: read-back did not match intended values.' };
  }

  return { success: true };
}

// ---------------------------------------------------------------------------
// STEP 8 — Backup listing and restore UI (Phase 3 Framework)
// ---------------------------------------------------------------------------

/**
 * Lists all backups for the startup optimizer, parsing the metadata headers from the real .reg files.
 */
export async function getStartupBackups(): Promise<StartupBackup[]> {
  return listModuleBackups('startup');
}

/**
 * Plans a restore operation for a startup backup (Phase 3 Framework — Step 1: Plan).
 * Dry-run: checks path traversal, asserts .reg header, reads target metadata, changes nothing.
 */
export async function planStartupRestore(backupId: string): Promise<OperationPlan> {
  const validation = validateBackupForRestore('startup', backupId);
  if (!validation.valid || !validation.filePath) {
    throw new Error(validation.reason || 'Invalid backup file');
  }

  const meta = validation.metadata || {};
  const hive = meta.hive || 'HKCU';
  const itemName = meta.itemName || backupId;
  const location = meta.location || `${hive}_RUN`;
  const valueName = meta.valueName || itemName;

  // Determine keyPath and approvedKeyPath from metadata or content
  let keyPath = '';
  let approvedKeyPath = '';
  if (validation.content) {
    const keyMatches = Array.from(
      validation.content.matchAll(/\[(?:HKEY_CURRENT_USER|HKEY_LOCAL_MACHINE)\\([^\]]+)\]/gi)
    );
    for (const match of keyMatches) {
      const fullPath = match[1];
      if (/StartupApproved/i.test(fullPath)) {
        approvedKeyPath = fullPath;
      } else if (/CurrentVersion\\(?:Run|RunOnce)/i.test(fullPath)) {
        keyPath = fullPath;
      }
    }
  }

  const targetDescription = `[${hive}\\${keyPath || location}] ${valueName}`;
  const requiresElevation = hive === 'HKLM';

  return createOperationPlan({
    module: 'startup-optimizer',
    actions: [
      {
        id: `restore-${backupId}`,
        kind: 'registry-value',
        target: targetDescription,
        description: `Restore startup configuration for "${itemName}" from backup ${path.basename(validation.filePath)}`,
        reclaimableBytes: null,
        metadata: {
          backupFilePath: validation.filePath,
          backupId,
          hive,
          itemName,
          location,
          keyPath,
          valueName,
          approvedKeyPath,
          approvedValueName: meta.valueName || itemName,
          isRestore: true,
        },
      },
    ],
    reversibility: 'reversible',
    requiresElevation,
  });
}

/**
 * Restores a startup backup through the Phase 3 Destructive Framework.
 * Plan -> Confirm (if called directly) -> Execute -> Verify -> Record.
 */
export async function restoreStartupBackup(
  backupId: string,
  logActivity?: (item: any) => void
): Promise<{ success: boolean; message?: string }> {
  try {
    const plan = await planStartupRestore(backupId);
    const result = await executeOperationPlan(plan.id, logActivity);
    return {
      success: result.success,
      message: result.message || (result.success ? 'Backup restored successfully.' : 'Restore failed.'),
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
