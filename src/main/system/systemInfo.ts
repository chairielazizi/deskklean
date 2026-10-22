import { getLogicalDisks, Win32_LogicalDisk } from './cim';
import { toNumber } from './parse';

/**
 * Normalized disk measurement for a logical volume, with cloud-drive corrections applied.
 */
export interface DiskMeasurement {
  deviceId: string;
  letter: string;
  volumeName: string;
  fileSystem: string | null;
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  freePercent: number;
  usagePercent: number;
  isGoogleDrive: boolean;
  hasValidMeasurements: boolean;
}

/**
 * Derives normalized measurements for a single Win32_LogicalDisk volume.
 *
 * Applies the Google Drive FAT32 virtual filesystem correction:
 * Google Drive Desktop maps a virtual FAT32 volume where FreeSpace actually
 * reports the occupied cloud data. The true available free space is totalBytes - occupiedBytes.
 *
 * @param ld - Raw Win32_LogicalDisk record
 * @returns DiskMeasurement with normalized byte counts and percentages
 */
export function measureLogicalDisk(ld: Win32_LogicalDisk): DiskMeasurement {
  const deviceId = (ld.DeviceID || '').trim();
  const letter = deviceId.replace(':', '').trim().toUpperCase();
  const volumeName = (ld.VolumeName || '').trim();
  const fileSystem = ld.FileSystem || null;
  const isGoogleDrive = volumeName.toLowerCase().includes('google drive');

  const rawTotal = toNumber(ld.Size);
  const rawFree = toNumber(ld.FreeSpace);

  const hasValidMeasurements =
    rawTotal !== null && rawTotal > 0 && rawFree !== null && rawFree >= 0;

  const totalBytes = rawTotal ?? 0;
  let freeBytes = rawFree ?? 0;
  let usedBytes = Math.max(0, totalBytes - freeBytes);

  // Google Drive Desktop FAT32 virtual filesystem reports occupied cloud data in FreeSpace.
  // The true available free space is totalBytes - occupiedBytes.
  if (isGoogleDrive && totalBytes > 0) {
    usedBytes = rawFree ?? 0;
    freeBytes = Math.max(0, totalBytes - usedBytes);
  } else if (isGoogleDrive) {
    const occupiedBytes = freeBytes;
    freeBytes = Math.max(0, totalBytes - occupiedBytes);
  }

  const freePercent =
    totalBytes > 0
      ? Math.round(((freeBytes / totalBytes) * 100) * 10) / 10
      : 0;

  const usagePercent =
    totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0;

  return {
    deviceId,
    letter,
    volumeName,
    fileSystem,
    totalBytes,
    freeBytes,
    usedBytes,
    freePercent,
    usagePercent,
    isGoogleDrive,
    hasValidMeasurements,
  };
}

/**
 * Maps an array of Win32_LogicalDisk records to DiskMeasurement items.
 *
 * @param disks - Array of Win32_LogicalDisk records
 * @returns Array of DiskMeasurement objects
 */
export function measureLogicalDisks(disks: Win32_LogicalDisk[]): DiskMeasurement[] {
  return disks.map(measureLogicalDisk);
}

/**
 * Queries logical disks via CIM and returns normalized measurements per volume.
 *
 * @param opts - Query options including timeoutMs
 * @returns Promise resolving to an array of DiskMeasurement items
 */
export async function getDiskMeasurements(
  opts?: { timeoutMs?: number }
): Promise<DiskMeasurement[]> {
  const logicalDisks = await getLogicalDisks({ timeoutMs: opts?.timeoutMs });
  return measureLogicalDisks(logicalDisks);
}

/**
 * Queries 64-bit GPU VRAM (in MB) from the Windows registry.
 *
 * Windows WMI Win32_VideoController.AdapterRAM is a 32-bit unsigned integer (uint32)
 * which saturates at 4,294,967,295 bytes (4095 MB) for any modern GPU with > 4 GB VRAM.
 * The true 64-bit capacity is recorded in HKLM\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}\000*
 * under HardwareInformation.qwMemorySize (QWORD).
 *
 * @param gpuModel - Optional GPU model name to match against DriverDesc
 * @returns 64-bit VRAM in MB, or null if unreadable
 */
export interface GpuVramQueryOptions {
  /**
   * Returns the raw output of the registry query used to read VRAM.
   * Defaults to shelling out to reg.exe. Injectable so tests can supply a
   * deterministic registry dump without depending on the host GPU.
   */
  regQuery?: () => Promise<string | null>;
}

async function defaultRegQuery(): Promise<string | null> {
  const { execFile } = await import('child_process');
  return new Promise<string | null>((resolve) => {
    execFile(
      'reg.exe',
      [
        'query',
        'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}',
        '/s',
      ],
      { maxBuffer: 10 * 1024 * 1024, timeout: 3000 },
      (err, stdout) => {
        if (err || !stdout) return resolve(null);
        resolve(stdout);
      }
    );
  });
}

export async function getGpuVram64BitMb(
  gpuModel?: string,
  options: GpuVramQueryOptions = {}
): Promise<number | null> {
  if (process.platform !== 'win32') return null;

  const stdout = await (options.regQuery ?? defaultRegQuery)();
  if (!stdout) return null;

  const sections = stdout.split(/\r?\n\r?\n/);
  let fallbackMb: number | null = null;
  for (const sec of sections) {
    const descMatch = sec.match(/DriverDesc\s+REG_SZ\s+(.+)/);
    const qwMatch = sec.match(
      /HardwareInformation\.qwMemorySize\s+REG_QWORD\s+0x([0-9a-fA-F]+)/
    );
    if (qwMatch) {
      const bytes = parseInt(qwMatch[1], 16);
      if (Number.isFinite(bytes) && bytes > 0) {
        const mb = Math.round(bytes / (1024 * 1024));
        if (
          descMatch &&
          gpuModel &&
          descMatch[1].trim().toLowerCase() === gpuModel.trim().toLowerCase()
        ) {
          return mb;
        }
        if (fallbackMb === null) {
          fallbackMb = mb;
        }
      }
    }
  }
  return fallbackMb;
}

