import path from 'path';
import { runPowerShell, isWindows } from './powershell';
import { readKeyValues, decodeStartupApproved } from './registry';
import { StartupItem, StartupImpact } from '../../shared/types';

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
  if (!raw || raw.trim().length === 0) {
    return [];
  }

  const parsed = JSON.parse(raw);
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
  if (!raw || raw.trim().length === 0) {
    return [];
  }

  const parsed = JSON.parse(raw);
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
    try {
      Get-WinEvent -FilterHashtable @{ LogName = 'Microsoft-Windows-Diagnostics-Performance/Operational'; Id = 101 } -MaxEvents 200 -ErrorAction Stop | ForEach-Object {
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
      } | ConvertTo-Json -Depth 2 -Compress
    } catch {
      Write-Warning $_.Exception.Message;
      '[]'
    }
  `.trim();

  const raw = await runPowerShell(script);
  if (!raw || raw.trim().length === 0) {
    return new Map<string, number>();
  }

  const parsed = JSON.parse(raw);
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
  if (!raw || raw.trim().length === 0) {
    return {};
  }

  const parsed = JSON.parse(raw);
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
      console.warn('Failed to read HKCU Run key:', err);
      return {} as Record<string, unknown>;
    }),
    readKeyValues('HKCU', 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\RunOnce').catch((err) => {
      console.warn('Failed to read HKCU RunOnce key:', err);
      return {} as Record<string, unknown>;
    }),
    readKeyValues('HKLM', 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run').catch((err) => {
      console.warn('Failed to read HKLM Run key:', err);
      return {} as Record<string, unknown>;
    }),
    readKeyValues('HKLM', 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\RunOnce').catch((err) => {
      console.warn('Failed to read HKLM RunOnce key:', err);
      return {} as Record<string, unknown>;
    }),
    readKeyValues('HKLM', 'SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run').catch((err) => {
      console.warn('Failed to read HKLM WOW6432Node Run key:', err);
      return {} as Record<string, unknown>;
    }),
    readKeyValues('HKCU', 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run').catch((err) => {
      console.warn('Failed to read HKCU StartupApproved\\Run:', err);
      return {} as Record<string, unknown>;
    }),
    readKeyValues('HKCU', 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run32').catch((err) => {
      console.warn('Failed to read HKCU StartupApproved\\Run32:', err);
      return {} as Record<string, unknown>;
    }),
    readKeyValues('HKCU', 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder').catch((err) => {
      console.warn('Failed to read HKCU StartupApproved\\StartupFolder:', err);
      return {} as Record<string, unknown>;
    }),
    readKeyValues('HKLM', 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run').catch((err) => {
      console.warn('Failed to read HKLM StartupApproved\\Run:', err);
      return {} as Record<string, unknown>;
    }),
    readKeyValues('HKLM', 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run32').catch((err) => {
      console.warn('Failed to read HKLM StartupApproved\\Run32:', err);
      return {} as Record<string, unknown>;
    }),
    readKeyValues('HKLM', 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder').catch((err) => {
      console.warn('Failed to read HKLM StartupApproved\\StartupFolder:', err);
      return {} as Record<string, unknown>;
    }),
    queryStartupFolders().catch((err) => {
      console.warn('Failed to query startup folders:', err);
      return [];
    }),
    queryScheduledTasks().catch((err) => {
      console.warn('Failed to query scheduled tasks:', err);
      return [];
    }),
    queryEvent101Impacts().catch((err) => {
      console.warn('Failed to query Diagnostics-Performance Event 101 log:', err);
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
    });
  }

  // HKCU RunOnce (no StartupApproved key — always enabled)
  for (const [name, val] of Object.entries(hkcuRunOnce)) {
    if (typeof val !== 'string') continue;
    rawItems.push({
      id: `hkcu-runonce-${slugify(name)}`,
      name,
      command: val,
      location: 'HKCU_RUN',
      source: 'registry',
      enabled: true,
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
    });
  }

  // HKLM RunOnce (no StartupApproved key — always enabled)
  for (const [name, val] of Object.entries(hklmRunOnce)) {
    if (typeof val !== 'string') continue;
    rawItems.push({
      id: `hklm-runonce-${slugify(name)}`,
      name,
      command: val,
      location: 'HKLM_RUN',
      source: 'registry',
      enabled: true,
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
    });
  }

  // Startup folders
  for (const folderItem of folderItems) {
    const approvedMap: Record<string, unknown> =
      folderItem.Scope === 'user' ? hkcuApprovedFolder : hklmApprovedFolder;
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
    console.warn('Failed to resolve publishers:', err);
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
    };
  });

  return items;
}
