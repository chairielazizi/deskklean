import {
  HealthReport,
  HealthComponentResult,
  HealthMeasurement,
  HealthIssue,
  StartupItem,
} from '../../shared/types';
import { getLogicalDisks, Win32_LogicalDisk } from './cim';
import { toNumber } from './parse';
import { getStartupItems } from './startup';
import { warnOnce } from './log';

export const HEALTH_SCORE_FORMULA_VERSION = '1.0.0';

export interface HealthProviders {
  getLogicalDisks?: () => Promise<Win32_LogicalDisk[]>;
  getStartupItems?: () => Promise<StartupItem[]>;
}

export interface AggregateHealthInputs {
  systemInfoResult?: {
    status?: 'ok' | 'partial' | 'failed';
    disks?: Win32_LogicalDisk[] | null;
    error?: Error | string | null;
  };
  startupResult?: {
    status?: 'ok' | 'partial' | 'failed';
    items?: StartupItem[] | null;
    error?: Error | string | null;
  };
}

/**
 * Calculates points lost due to disk pressure.
 * The score loses up to 40 points proportional to disk pressure above 70%.
 *
 * @param diskPressure - Percent of disk space used (0 - 100)
 * @returns Points lost between 0 and 40
 */
export function calculateDiskPressurePointsLost(diskPressure: number): number {
  if (diskPressure <= 70) {
    return 0;
  }
  const ratio = (diskPressure - 70) / 30; // 70% -> 0, 100% -> 1
  return Math.min(40, Math.max(0, Math.round(ratio * 40 * 1000) / 1000));
}

/**
 * Calculates points lost due to reclaimable junk ratio.
 * The score loses up to 30 points proportional to reclaimableRatio above 5%.
 *
 * @param reclaimableRatio - Reclaimable bytes divided by total disk bytes (0 - 1)
 * @returns Points lost between 0 and 30
 */
export function calculateReclaimableJunkPointsLost(reclaimableRatio: number): number {
  if (reclaimableRatio <= 0.05) {
    return 0;
  }
  // Scales proportionally from 5% to 25% reclaimable junk
  const ratio = (reclaimableRatio - 0.05) / 0.20;
  return Math.min(30, Math.max(0, Math.round(ratio * 30 * 1000) / 1000));
}

/**
 * Calculates points lost due to startup boot degradation.
 * The score loses up to 20 points proportional to measured boot-degradation seconds above 5 s.
 *
 * @param bootDegradationSeconds - Seconds of measured boot degradation
 * @returns Points lost between 0 and 20
 */
export function calculateBootImpactPointsLost(bootDegradationSeconds: number): number {
  if (bootDegradationSeconds <= 5) {
    return 0;
  }
  // Scales proportionally above 5 seconds up to 25 seconds
  const ratio = (bootDegradationSeconds - 5) / 20;
  return Math.min(20, Math.max(0, Math.round(ratio * 20 * 1000) / 1000));
}

/**
 * Calculates points lost due to enabled startup items count.
 * The score loses up to 10 points proportional to enabled-item count above 20.
 *
 * @param enabledCount - Number of enabled startup items
 * @returns Points lost between 0 and 10
 */
export function calculateStartupCountPointsLost(enabledCount: number): number {
  if (enabledCount <= 20) {
    return 0;
  }
  // Scales proportionally above 20 items up to 50 items
  const ratio = (enabledCount - 20) / 30;
  return Math.min(10, Math.max(0, Math.round(ratio * 10 * 1000) / 1000));
}

/**
 * Derives the health score for Phase 4.
 * At launch, disk pressure is the only active constituent component.
 * Starts at 100 and loses up to 40 points proportional to disk pressure above 70%.
 *
 * @param diskPressure - Percent of disk space used (0 - 100), or null if not measured.
 * @returns Integer score between 0 and 100, or null if unmeasured.
 */
export function deriveScoreFromDiskPressure(diskPressure: number | null): number | null {
  if (diskPressure === null || Number.isNaN(diskPressure)) {
    return null;
  }
  const lost = calculateDiskPressurePointsLost(diskPressure);
  return Math.max(0, Math.min(100, Math.round(100 - lost)));
}

/**
 * Derives health issues from measurements against documented thresholds only.
 * Health Check does not invent its own thresholds.
 *
 * Documented thresholds:
 * - Free disk space (C:) < 10% free -> 'Disk nearly free' (SystemInfo)
 * - Total boot degradation > 5 s -> 'Boot impact high' (Startup Optimizer)
 * - Enabled startup items > 20 -> 'Startup items high' (Startup Optimizer)
 * - Reclaimable bytes (total) > 5% of disk -> 'Reclaimable junk high' (SmartClean)
 * - Crash dump count > 0 -> 'Crash dumps present' (SmartClean)
 *
 * @param measurements - Real measurements
 * @returns Array of derived issues
 */
export function deriveIssues(measurements: HealthMeasurement[]): HealthIssue[] {
  const issues: HealthIssue[] = [];

  for (const m of measurements) {
    if (m.label === 'Free disk space (C:)') {
      if (m.value < 10) {
        issues.push({
          module: 'SystemInfo',
          severity: m.value < 5 ? 'critical' : 'warning',
          description: `Drive C: has less than 10% free disk space remaining (${m.value.toFixed(1)}% free)`,
          measurementRef: 'Free disk space (C:)',
          deepLink: 'SystemInfo',
        });
      }
    } else if (m.label === 'Total boot degradation') {
      if (m.value > 5) {
        issues.push({
          module: 'Startup Optimizer',
          severity: 'warning',
          description: `Startup applications cause over 5 seconds of measured boot degradation (${m.value.toFixed(1)}s)`,
          measurementRef: 'Total boot degradation',
          deepLink: 'Startup Optimizer',
        });
      }
    } else if (m.label === 'Enabled startup items') {
      if (m.value > 20) {
        issues.push({
          module: 'Startup Optimizer',
          severity: 'warning',
          description: `More than 20 startup applications are currently enabled (${m.value} items)`,
          measurementRef: 'Enabled startup items',
          deepLink: 'Startup Optimizer',
        });
      }
    } else if (m.label === 'Crash dump count') {
      if (m.value > 0) {
        issues.push({
          module: 'SmartClean',
          severity: 'info',
          description: `System crash dump files detected on disk (${m.value} dump files)`,
          measurementRef: 'Crash dump count',
          deepLink: 'SmartClean',
        });
      }
    }
  }

  return issues;
}

/**
 * Pure aggregator: combines constituent module data into a HealthReport.
 * Owns NO filesystem, NO registry, and NO WMI calls.
 *
 * @param inputs - Results from constituent modules
 * @returns Complete HealthReport
 */
export function aggregateHealthReport(inputs: AggregateHealthInputs): HealthReport {
  const generatedAt = new Date().toISOString();
  const components: HealthComponentResult[] = [];
  const unmeasured: string[] = ['SmartClean', 'DiskAnalyzer'];

  let measuredDiskPressure: number | null = null;
  let hasAnyRealMeasurement = false;

  // 1. SystemInfo constituent
  if (inputs.systemInfoResult) {
    const { status: inputStatus, disks, error } = inputs.systemInfoResult;
    if (error || inputStatus === 'failed') {
      components.push({
        module: 'SystemInfo',
        status: 'failed',
        measurements: [],
        issues: [],
      });
    } else if (disks && Array.isArray(disks) && disks.length > 0) {
      const measurements: HealthMeasurement[] = [];
      let foundFullDrive = false;
      let hasMissingFields = false;

      // Primary system drive C: prioritized, followed by any other fixed drives
      for (const ld of disks) {
        const letter = (ld.DeviceID || '').toUpperCase().trim();
        if (!letter) continue;

        const volumeName = (ld.VolumeName || '').trim();
        const isGoogleDrive = volumeName.toLowerCase().includes('google drive');

        const totalBytes = toNumber(ld.Size);
        let freeBytes = toNumber(ld.FreeSpace);

        if (totalBytes !== null && totalBytes > 0 && freeBytes !== null && freeBytes >= 0) {
          foundFullDrive = true;

          // For Google Drive Desktop virtual drive:
          // Google Drive's FAT32 virtual filesystem reports the occupied cloud data in FreeSpace.
          // The true available free space is totalBytes - occupiedBytes.
          if (isGoogleDrive) {
            const occupiedBytes = freeBytes;
            freeBytes = Math.max(0, totalBytes - occupiedBytes);
          }

          const freePercent = Math.round(((freeBytes / totalBytes) * 100) * 10) / 10;
          const driveTag = isGoogleDrive ? `${letter} · Google Drive` : letter;

          measurements.push({
            label: `Total disk space (${driveTag})`,
            value: totalBytes,
            unit: 'bytes',
            source: 'SystemInfo',
          });
          measurements.push({
            label: `Free disk space bytes (${driveTag})`,
            value: freeBytes,
            unit: 'bytes',
            source: 'SystemInfo',
          });
          measurements.push({
            label: `Free disk space (${driveTag})`,
            value: freePercent,
            unit: 'percent',
            source: 'SystemInfo',
          });

          // Use C: for disk pressure, or the first non-cloud drive if C: is absent
          if (letter.startsWith('C') || (measuredDiskPressure === null && !isGoogleDrive)) {
            measuredDiskPressure = Math.round(((totalBytes - freeBytes) / totalBytes) * 100 * 10) / 10;
          }
        } else {
          hasMissingFields = true;
        }
      }

      if (measurements.length > 0) {
        hasAnyRealMeasurement = true;
      }

      const status: 'ok' | 'partial' = inputStatus === 'partial' || hasMissingFields || !foundFullDrive
        ? 'partial'
        : 'ok';

      components.push({
        module: 'SystemInfo',
        status,
        measurements,
        issues: deriveIssues(measurements),
      });
    } else {
      components.push({
        module: 'SystemInfo',
        status: 'partial',
        measurements: [],
        issues: [],
      });
    }
  } else {
    // SystemInfo not provided
    components.push({
      module: 'SystemInfo',
      status: 'failed',
      measurements: [],
      issues: [],
    });
  }

  // 2. Startup Optimizer constituent
  if (inputs.startupResult) {
    const { status: inputStatus, items, error } = inputs.startupResult;
    if (error || inputStatus === 'failed') {
      components.push({
        module: 'Startup Optimizer',
        status: 'failed',
        measurements: [],
        issues: [],
      });
    } else if (items && Array.isArray(items)) {
      const measurements: HealthMeasurement[] = [];
      const enabledItems = items.filter((i) => i.enabled);
      const enabledCount = enabledItems.length;
      const totalCount = items.length;

      measurements.push({
        label: 'Enabled startup items',
        value: enabledCount,
        unit: 'count',
        source: 'Startup Optimizer',
      });
      measurements.push({
        label: 'Total startup items',
        value: totalCount,
        unit: 'count',
        source: 'Startup Optimizer',
      });

      // Boot impact from Event 101 measurements
      const itemsWithImpact = enabledItems.filter(
        (i) => i.estimatedBootImpactMs !== null && i.estimatedBootImpactMs !== undefined
      );

      let hasBootDegradationMeasurement = false;
      if (itemsWithImpact.length > 0) {
        const totalMs = itemsWithImpact.reduce(
          (sum, i) => sum + (i.estimatedBootImpactMs ?? 0),
          0
        );
        const totalSec = Math.round((totalMs / 1000) * 10) / 10;
        measurements.push({
          label: 'Total boot degradation',
          value: totalSec,
          unit: 'count',
          source: 'Startup Optimizer',
        });
        hasBootDegradationMeasurement = true;
      }

      if (measurements.length > 0) {
        hasAnyRealMeasurement = true;
      }

      // If boot impact couldn't be measured from event log, report as partial
      const status: 'ok' | 'partial' =
        inputStatus === 'partial' || !hasBootDegradationMeasurement ? 'partial' : 'ok';

      components.push({
        module: 'Startup Optimizer',
        status,
        measurements,
        issues: deriveIssues(measurements),
      });
    } else {
      components.push({
        module: 'Startup Optimizer',
        status: 'partial',
        measurements: [],
        issues: [],
      });
    }
  } else {
    // Startup Optimizer not provided
    components.push({
      module: 'Startup Optimizer',
      status: 'failed',
      measurements: [],
      issues: [],
    });
  }

  // 3. SmartClean (Phase 5, not yet built)
  components.push({
    module: 'SmartClean',
    status: 'not_built',
    measurements: [],
    issues: [],
  });

  // 4. DiskAnalyzer (Phase 9, not yet built)
  components.push({
    module: 'DiskAnalyzer',
    status: 'not_built',
    measurements: [],
    issues: [],
  });

  // Score is null when zero components have real measurements
  const score = hasAnyRealMeasurement && measuredDiskPressure !== null
    ? deriveScoreFromDiskPressure(measuredDiskPressure)
    : null;

  return {
    generatedAt,
    score,
    components,
    unmeasured,
  };
}

/**
 * Main aggregator entry point called by IPC handler.
 * Concurrently calls constituent scan APIs and aggregates their results.
 *
 * @param providers - Optional provider overrides (used in unit tests)
 * @returns HealthReport
 */
export async function generateHealthReport(providers?: HealthProviders): Promise<HealthReport> {
  const diskQuery = providers?.getLogicalDisks ?? (() => getLogicalDisks({ timeoutMs: 10000 }));
  const startupQuery = providers?.getStartupItems ?? (() => getStartupItems());

  const [disksResult, startupResult] = await Promise.all([
    diskQuery()
      .then((disks) => ({ status: 'ok' as const, disks, error: null }))
      .catch((err) => {
        warnOnce('health:system-info-disks', 'Health Check failed to query logical disks', err);
        return { status: 'failed' as const, disks: null, error: err };
      }),
    startupQuery()
      .then((items) => ({ status: 'ok' as const, items, error: null }))
      .catch((err) => {
        warnOnce('health:startup-items', 'Health Check failed to query startup items', err);
        return { status: 'failed' as const, items: null, error: err };
      }),
  ]);

  return aggregateHealthReport({
    systemInfoResult: disksResult,
    startupResult: startupResult,
  });
}
