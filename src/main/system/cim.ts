import { runPowerShellJson } from './powershell';
import { warnOnce } from './log';

export interface QueryCimOptions {
  namespace?: string;
  filter?: string;
  properties?: string[];
  timeoutMs?: number;
}

/**
 * Win32_Processor CIM instance representing a CPU processor.
 */
export interface Win32_Processor {
  Name?: string | null;
  Manufacturer?: string | null;
  NumberOfCores?: number | null;
  NumberOfLogicalProcessors?: number | null;
  MaxClockSpeed?: number | null;
  CurrentClockSpeed?: number | null;
}

/**
 * Win32_PhysicalMemory CIM instance representing a physical memory module (RAM).
 */
export interface Win32_PhysicalMemory {
  Capacity?: number | string | null;
  Speed?: number | null;
  SMBIOSMemoryType?: number | null;
  Manufacturer?: string | null;
  DeviceLocator?: string | null;
}

/**
 * Win32_VideoController CIM instance representing a display graphics controller (GPU).
 */
export interface Win32_VideoController {
  Name?: string | null;
  AdapterRAM?: number | string | null;
  DriverVersion?: string | null;
  VideoProcessor?: string | null;
}

/**
 * Win32_BaseBoard CIM instance representing the system motherboard.
 */
export interface Win32_BaseBoard {
  Manufacturer?: string | null;
  Product?: string | null;
  Version?: string | null;
}

/**
 * Win32_BIOS CIM instance representing the system BIOS/firmware.
 */
export interface Win32_BIOS {
  Manufacturer?: string | null;
  SMBIOSBIOSVersion?: string | null;
  ReleaseDate?: string | null;
}

/**
 * Win32_OperatingSystem CIM instance representing the Windows OS environment.
 */
export interface Win32_OperatingSystem {
  Caption?: string | null;
  Version?: string | null;
  BuildNumber?: string | null;
  OSArchitecture?: string | null;
  LastBootUpTime?: string | null;
  TotalVisibleMemorySize?: number | string | null;
  FreePhysicalMemory?: number | string | null;
}

/**
 * Win32_LogicalDisk CIM instance representing a local or mapped disk drive volume.
 */
export interface Win32_LogicalDisk {
  DeviceID?: string | null;
  VolumeName?: string | null;
  Size?: number | string | null;
  FreeSpace?: number | string | null;
  FileSystem?: string | null;
  DriveType?: number | null;
}

/**
 * MSFT_PhysicalDisk CIM instance from root/Microsoft/Windows/Storage representing a physical disk unit.
 */
export interface MSFT_PhysicalDisk {
  DeviceId?: string | null;
  FriendlyName?: string | null;
  MediaType?: number | null;
  BusType?: number | null;
  Size?: number | string | null;
  HealthStatus?: number | null;
}

/**
 * Win32_NetworkAdapterConfiguration CIM instance representing a network adapter's IP settings.
 */
export interface Win32_NetworkAdapterConfiguration {
  Index?: number | null;
  Description?: string | null;
  MACAddress?: string | null;
  IPAddress?: string[] | string | null;
  DefaultIPGateway?: string[] | string | null;
}

/**
 * SoftwareLicensingProduct CIM instance from root/cimv2.
 */
export interface SoftwareLicensingProduct {
  LicenseStatus?: number | null;
  Description?: string | null;
  Name?: string | null;
}

/**
 * Win32_PerfFormattedData_PerfOS_Processor CIM instance from root/cimv2.
 */
export interface Win32_PerfFormattedData_PerfOS_Processor {
  PercentProcessorTime?: number | string | null;
}

/**
 * MSAcpi_ThermalZoneTemperature CIM instance from root/wmi.
 */
export interface MSAcpi_ThermalZoneTemperature {
  CurrentTemperature?: number | string | null;
}

/**
 * MSFT_Partition CIM instance from root/Microsoft/Windows/Storage.
 */
export interface MSFT_Partition {
  DriveLetter?: string | null;
  DiskNumber?: number | null;
  PartitionNumber?: number | null;
}

/**
 * MSFT_Disk CIM instance from root/Microsoft/Windows/Storage.
 */
export interface MSFT_Disk {
  Number?: number | null;
  BusType?: number | null;
  HealthStatus?: number | null;
  FriendlyName?: string | null;
}

/**
 * Win32_NetworkAdapter CIM instance from root/cimv2.
 */
export interface Win32_NetworkAdapter {
  Index?: number | null;
  DeviceID?: string | number | null;
  Speed?: number | string | null;
  Name?: string | null;
  NetConnectionID?: string | null;
}

/**
 * Win32_PerfFormattedData_Tcpip_NetworkInterface CIM instance from root/cimv2.
 */
export interface Win32_PerfFormattedData_Tcpip_NetworkInterface {
  Name?: string | null;
  BytesReceivedPersec?: number | string | null;
  BytesSentPersec?: number | string | null;
}

/**
 * Win32_PerfFormattedData_PerfDisk_LogicalDisk CIM instance from root/cimv2.
 */
export interface Win32_PerfFormattedData_PerfDisk_LogicalDisk {
  Name?: string | null;
  DiskReadBytesPerSec?: number | string | null;
  DiskWriteBytesPerSec?: number | string | null;
}

const CLASS_NAME_REGEX = /^[A-Za-z0-9_]+$/;
const PROPERTY_REGEX = /^[A-Za-z0-9_]+$/;
// Conservative allowlist for CIM filters: letters, digits, space, =, ', ", _, -, ., *, (, ), ,
// NOTE: The backtick (`) MUST NEVER be allowed here because it is PowerShell's escape character.
// Allowing backticks creates an injection hole: buildCimCommand escapes double quotes with `",
// so a filter containing `` `" `` becomes `` `` `" `` where PowerShell interprets `` as a literal
// backtick and treats the quote as closing the string, breaking out of the quoted argument.
// In addition, pipe (|) and percent (%) are excluded to prevent pipeline chaining and
// ForEach-Object alias execution in WQL filter contexts.
const FILTER_REGEX = /^[A-Za-z0-9 ='"_\-.*(),]+$/;

const isValidNamespace = (ns: string): boolean => {
  if (!ns || ns.trim().length === 0) return false;
  const segments = ns.split(/[/\\]/);
  return segments.length > 0 && segments.every((seg) => CLASS_NAME_REGEX.test(seg));
};

const isMissingCimTarget = (message: string): boolean => {
  const lower = message.toLowerCase();
  return (
    lower.includes('invalid class') ||
    lower.includes('invalid namespace') ||
    lower.includes('0x80041010') || // WBEM_E_INVALID_CLASS
    lower.includes('0x8004100e') || // WBEM_E_INVALID_NAMESPACE
    lower.includes('0x80041002') || // WBEM_E_NOT_FOUND
    lower.includes('notfound') ||
    lower.includes('not found') ||
    lower.includes('class not found') ||
    lower.includes('typenotfound')
  );
};

/**
 * Builds the static PowerShell Get-CimInstance command string from validated inputs.
 *
 * @param className - The WMI/CIM class name (alphanumeric and underscore only).
 * @param opts - Optional namespace, filter, and property list.
 * @returns The formatted PowerShell command string.
 */
export const buildCimCommand = (
  className: string,
  opts?: QueryCimOptions
): string => {
  if (!CLASS_NAME_REGEX.test(className)) {
    throw new Error(`Invalid CIM className: "${className}"`);
  }

  const parts: string[] = ['Get-CimInstance', '-ClassName', className];

  if (opts?.namespace) {
    if (!isValidNamespace(opts.namespace)) {
      throw new Error(`Invalid CIM namespace: "${opts.namespace}"`);
    }
    parts.push('-Namespace', opts.namespace);
  }

  if (opts?.filter) {
    if (!FILTER_REGEX.test(opts.filter)) {
      throw new Error(`Invalid characters in CIM filter: "${opts.filter}"`);
    }
    parts.push('-Filter', `"${opts.filter.replace(/"/g, '`"')}"`);
  }

  if (opts?.properties && opts.properties.length > 0) {
    for (const prop of opts.properties) {
      if (!PROPERTY_REGEX.test(prop)) {
        throw new Error(`Invalid CIM property name: "${prop}"`);
      }
    }
    parts.push('-Property', opts.properties.join(','));
  }

  return parts.join(' ');
};

/**
 * Strips PowerShell and CIM metadata properties from an object row.
 * Removes CimInstanceProperties, CimSystemProperties, PSComputerName, PSShowComputerName,
 * and any key starting with 'Cim' or 'PS'.
 *
 * @param row - Raw CIM object record.
 * @returns Object with metadata keys removed.
 */
export const stripCimMetadata = <T>(row: Record<string, unknown>): T => {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    return row as T;
  }

  const stripped: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(row)) {
    if (
      key === 'CimInstanceProperties' ||
      key === 'CimSystemProperties' ||
      key === 'PSComputerName' ||
      key === 'PSShowComputerName' ||
      key.startsWith('Cim') ||
      key.startsWith('PS')
    ) {
      continue;
    }
    stripped[key] = val;
  }
  return stripped as T;
};

/**
 * Queries a CIM/WMI class on Windows.
 * Returns an empty array if the class or namespace does not exist on the machine.
 *
 * @param className - Target CIM class name.
 * @param opts - Options including namespace, filter, and properties.
 * @returns Array of typed and cleaned rows.
 */
export const queryCim = async <T>(
  className: string,
  opts?: QueryCimOptions
): Promise<T[]> => {
  const command = buildCimCommand(className, opts);

  try {
    const rows = await runPowerShellJson<T[]>('', command, {
      timeoutMs: opts?.timeoutMs,
    });
    return (rows || []).map((row) =>
      stripCimMetadata<T>(row as Record<string, unknown>)
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (isMissingCimTarget(message)) {
      return [];
    }
    throw err;
  }
};

/**
 * Queries processor information from Win32_Processor.
 */
export const getProcessors = async (
  opts?: { timeoutMs?: number }
): Promise<Win32_Processor[]> => {
  return queryCim<Win32_Processor>('Win32_Processor', {
    properties: [
      'Name',
      'Manufacturer',
      'NumberOfCores',
      'NumberOfLogicalProcessors',
      'MaxClockSpeed',
      'CurrentClockSpeed',
    ],
    timeoutMs: opts?.timeoutMs,
  });
};

/**
 * Queries installed physical memory modules from Win32_PhysicalMemory.
 */
export const getPhysicalMemory = async (
  opts?: { timeoutMs?: number }
): Promise<Win32_PhysicalMemory[]> => {
  return queryCim<Win32_PhysicalMemory>('Win32_PhysicalMemory', {
    properties: [
      'Capacity',
      'Speed',
      'SMBIOSMemoryType',
      'Manufacturer',
      'DeviceLocator',
    ],
    timeoutMs: opts?.timeoutMs,
  });
};

/**
 * Queries display adapter (GPU) information from Win32_VideoController.
 */
export const getVideoControllers = async (
  opts?: { timeoutMs?: number }
): Promise<Win32_VideoController[]> => {
  return queryCim<Win32_VideoController>('Win32_VideoController', {
    properties: [
      'Name',
      'AdapterRAM',
      'DriverVersion',
      'VideoProcessor',
    ],
    timeoutMs: opts?.timeoutMs,
  });
};

/**
 * Queries motherboard information from Win32_BaseBoard.
 */
export const getBaseBoard = async (
  opts?: { timeoutMs?: number }
): Promise<Win32_BaseBoard[]> => {
  return queryCim<Win32_BaseBoard>('Win32_BaseBoard', {
    properties: ['Manufacturer', 'Product', 'Version'],
    timeoutMs: opts?.timeoutMs,
  });
};

/**
 * Queries BIOS and firmware information from Win32_BIOS.
 */
export const getBios = async (
  opts?: { timeoutMs?: number }
): Promise<Win32_BIOS[]> => {
  return queryCim<Win32_BIOS>('Win32_BIOS', {
    properties: ['Manufacturer', 'SMBIOSBIOSVersion', 'ReleaseDate'],
    timeoutMs: opts?.timeoutMs,
  });
};

/**
 * Queries Windows operating system configuration from Win32_OperatingSystem.
 */
export const getOperatingSystem = async (
  opts?: { timeoutMs?: number }
): Promise<Win32_OperatingSystem[]> => {
  return queryCim<Win32_OperatingSystem>('Win32_OperatingSystem', {
    properties: [
      'Caption',
      'Version',
      'BuildNumber',
      'OSArchitecture',
      'LastBootUpTime',
      'TotalVisibleMemorySize',
      'FreePhysicalMemory',
    ],
    timeoutMs: opts?.timeoutMs,
  });
};

/**
 * Queries local fixed logical disk drives (DriveType = 3) from Win32_LogicalDisk.
 */
export const getLogicalDisks = async (
  opts?: { timeoutMs?: number }
): Promise<Win32_LogicalDisk[]> => {
  return queryCim<Win32_LogicalDisk>('Win32_LogicalDisk', {
    filter: 'DriveType = 3',
    properties: [
      'DeviceID',
      'VolumeName',
      'Size',
      'FreeSpace',
      'FileSystem',
      'DriveType',
    ],
    timeoutMs: opts?.timeoutMs,
  });
};

/**
 * Queries physical disk drives from MSFT_PhysicalDisk in root/Microsoft/Windows/Storage.
 */
export const getPhysicalDisks = async (
  opts?: { timeoutMs?: number }
): Promise<MSFT_PhysicalDisk[]> => {
  return queryCim<MSFT_PhysicalDisk>('MSFT_PhysicalDisk', {
    namespace: 'root/Microsoft/Windows/Storage',
    properties: [
      'DeviceId',
      'FriendlyName',
      'MediaType',
      'BusType',
      'Size',
      'HealthStatus',
    ],
    timeoutMs: opts?.timeoutMs,
  });
};

/**
 * Queries active network adapter configurations (IPEnabled = true) from Win32_NetworkAdapterConfiguration.
 */
export const getNetworkAdapters = async (
  opts?: { timeoutMs?: number }
): Promise<Win32_NetworkAdapterConfiguration[]> => {
  return queryCim<Win32_NetworkAdapterConfiguration>(
    'Win32_NetworkAdapterConfiguration',
    {
      filter: 'IPEnabled = true',
      properties: [
        'Index',
        'Description',
        'MACAddress',
        'IPAddress',
        'DefaultIPGateway',
      ],
      timeoutMs: opts?.timeoutMs,
    }
  );
};

/**
 * Queries Windows activation status from SoftwareLicensingProduct.
 * Returns 'activated' if licensed (LicenseStatus === 1), 'Not activated' if unlicensed, or 'Unknown'.
 */
export const getActivationStatus = async (
  opts?: { timeoutMs?: number }
): Promise<string> => {
  try {
    const products = await queryCim<SoftwareLicensingProduct>(
      'SoftwareLicensingProduct',
      {
        filter: "PartialProductKey IS NOT NULL AND ApplicationID = '55c92734-d682-4d71-983e-d6ec3f16059f'",
        properties: ['LicenseStatus'],
        timeoutMs: opts?.timeoutMs,
      }
    );
    if (products.length > 0 && products[0].LicenseStatus === 1) {
      return 'activated';
    } else if (products.length > 0 && products[0].LicenseStatus !== null && products[0].LicenseStatus !== undefined) {
      return 'Not activated';
    }
    return 'Unknown';
  } catch (err) {
    console.warn('Failed to query activation status:', err);
    return 'Unknown';
  }
};

/**
 * Queries real-time CPU usage percentage from Win32_PerfFormattedData_PerfOS_Processor.
 */
export const getCpuPerformance = async (
  opts?: { timeoutMs?: number }
): Promise<number | null> => {
  const rows = await queryCim<Win32_PerfFormattedData_PerfOS_Processor>(
    'Win32_PerfFormattedData_PerfOS_Processor',
    {
      filter: "Name='_Total'",
      properties: ['PercentProcessorTime'],
      timeoutMs: opts?.timeoutMs,
    }
  );
  if (rows.length === 0 || rows[0].PercentProcessorTime === null || rows[0].PercentProcessorTime === undefined) {
    return null;
  }
  const parsed = Number(rows[0].PercentProcessorTime);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Queries CPU temperature from MSAcpi_ThermalZoneTemperature in root/wmi.
 * Returns temperature in degrees Celsius, or null if unavailable or unsupported.
 */
export const getCpuTemperature = async (
  opts?: { timeoutMs?: number }
): Promise<number | null> => {
  try {
    const zones = await queryCim<MSAcpi_ThermalZoneTemperature>(
      'MSAcpi_ThermalZoneTemperature',
      {
        namespace: 'root/wmi',
        properties: ['CurrentTemperature'],
        timeoutMs: opts?.timeoutMs,
      }
    );
    if (zones.length === 0 || zones[0].CurrentTemperature === null || zones[0].CurrentTemperature === undefined) {
      return null;
    }
    const rawTemp = Number(zones[0].CurrentTemperature);
    if (!Number.isFinite(rawTemp) || rawTemp <= 0) {
      return null;
    }
    // ACPI temperature is in tenths of Kelvin. Convert to Celsius: (K_tenths / 10) - 273.15
    const tempC = Math.round((rawTemp / 10) - 273.15);
    // Sanity check: valid processor temperatures are typically between 0C and 150C
    if (tempC < 0 || tempC > 150) {
      return null;
    }
    return tempC;
  } catch (err) {
    warnOnce('cim:MSAcpi_ThermalZoneTemperature', 'Failed to query CPU temperature', err);
    return null;
  }
};

/**
 * Queries disk partitions from MSFT_Partition in root/Microsoft/Windows/Storage.
 */
export const getPartitions = async (
  opts?: { timeoutMs?: number }
): Promise<MSFT_Partition[]> => {
  return queryCim<MSFT_Partition>('MSFT_Partition', {
    namespace: 'root/Microsoft/Windows/Storage',
    properties: ['DriveLetter', 'DiskNumber', 'PartitionNumber'],
    timeoutMs: opts?.timeoutMs,
  });
};

/**
 * Queries storage disks from MSFT_Disk in root/Microsoft/Windows/Storage.
 */
export const getDisks = async (
  opts?: { timeoutMs?: number }
): Promise<MSFT_Disk[]> => {
  return queryCim<MSFT_Disk>('MSFT_Disk', {
    namespace: 'root/Microsoft/Windows/Storage',
    properties: ['Number', 'BusType', 'HealthStatus', 'FriendlyName'],
    timeoutMs: opts?.timeoutMs,
  });
};

/**
 * Queries network adapter hardware devices from Win32_NetworkAdapter.
 */
export const getNetworkAdapterDevices = async (
  opts?: { timeoutMs?: number }
): Promise<Win32_NetworkAdapter[]> => {
  return queryCim<Win32_NetworkAdapter>('Win32_NetworkAdapter', {
    properties: ['Index', 'DeviceID', 'Speed', 'Name', 'NetConnectionID'],
    timeoutMs: opts?.timeoutMs,
  });
};

/**
 * Queries network interface performance counters from Win32_PerfFormattedData_Tcpip_NetworkInterface.
 */
export const getNetworkPerformance = async (
  opts?: { timeoutMs?: number }
): Promise<Win32_PerfFormattedData_Tcpip_NetworkInterface[]> => {
  return queryCim<Win32_PerfFormattedData_Tcpip_NetworkInterface>(
    'Win32_PerfFormattedData_Tcpip_NetworkInterface',
    {
      properties: ['Name', 'BytesReceivedPersec', 'BytesSentPersec'],
      timeoutMs: opts?.timeoutMs,
    }
  );
};

/**
 * Queries logical disk read and write performance counters from Win32_PerfFormattedData_PerfDisk_LogicalDisk.
 */
export const getDiskPerformance = async (
  opts?: { timeoutMs?: number }
): Promise<{ diskReadBytesSec: number; diskWriteBytesSec: number }> => {
  const rows = await queryCim<Win32_PerfFormattedData_PerfDisk_LogicalDisk>(
    'Win32_PerfFormattedData_PerfDisk_LogicalDisk',
    {
      filter: "Name='_Total'",
      properties: ['DiskReadBytesPerSec', 'DiskWriteBytesPerSec'],
      timeoutMs: opts?.timeoutMs,
    }
  );
  if (rows.length === 0) {
    return { diskReadBytesSec: 0, diskWriteBytesSec: 0 };
  }
  const read = Number(rows[0].DiskReadBytesPerSec);
  const write = Number(rows[0].DiskWriteBytesPerSec);
  return {
    diskReadBytesSec: Number.isFinite(read) ? Math.max(0, read) : 0,
    diskWriteBytesSec: Number.isFinite(write) ? Math.max(0, write) : 0,
  };
};
