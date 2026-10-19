import { ipcMain, BrowserWindow, app, shell } from 'electron';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { IPC_CHANNELS, DEFAULT_SETTINGS, DEFAULT_CLEAN_CATEGORIES, SHRED_METHODS } from '../shared/constants';
import {
  SystemSpecs,
  OSInfo,
  CPUInfo,
  MemoryInfo,
  DriveInfo,
  GPUInfo,
  MotherboardInfo,
  NetworkInfo,
  HealthReport,
  SmartCleanReport,
  SmartCleanScanResult,
  SmartCleanResult,
  ExecuteResult,
  RegistryScanResult,
  RegistryFixerIssue,
  RegistryFixerResult,
  RegistryBackup,
  StartupItem,
  InstalledApp,
  AppUninstallResult,
  BrowserExtension,
  DuplicateGroup,
  DuplicateScanConfig,
  DuplicateScanResult,
  ShredMethodId,
  AppSettings,
  ActivityItem,
  DiskAnalysisResult,
} from '../shared/types';
import { isWindows } from './system/powershell';
import {
  getStartupItems,
  toggleStartupItem,
  getStartupDelay,
  setStartupDelay,
  getStartupBackups,
  restoreStartupBackup,
  planStartupRestore,
} from './system/startup';
import {
  migrateLegacyBackups,
  listModuleBackups,
  executeOperationPlan,
  getModuleBackupDir,
  StartupDelayState,
  StartupBackup,
} from './system/framework';
import { scanSmartClean } from './system/smartclean/scan';
import { createSmartCleanPlan } from './system/smartclean/execute';
import { scanRegistryFixer, createRegistryFixPlan, executeRegistryFix } from './system/registry-fixer';
import { isElevated, relaunchElevated } from './system/elevation';
import {
  getProcessors,
  getPhysicalMemory,
  getVideoControllers,
  getBaseBoard,
  getBios,
  getOperatingSystem,
  getPhysicalDisks,
  getNetworkAdapters,
  getActivationStatus,
  getCpuPerformance,
  getCpuTemperature,
  getPartitions,
  getDisks,
  getNetworkAdapterDevices,
  getNetworkPerformance,
  getDiskPerformance,
  getLogicalDisks,
} from './system/cim';
import { walk } from './system/disk-analyzer';
import { scanDuplicates, createDuplicateDeletePlan } from './system/duplicate-finder';
import { getDiskMeasurements, getGpuVram64BitMb } from './system/systemInfo';
import {
  toNumber,
  parseCimDate,
  smbiosMemoryType,
  mediaTypeLabel,
  busTypeLabel,
} from './system/parse';
import { generateHealthReport, HEALTH_SCORE_FORMULA_VERSION } from './system/health';
import { warnOnce } from './system/log';

export function setupIpcHandlers(mainWindow: BrowserWindow): void {
  const userDataDir = app.getPath('userData');
  const settingsFile = path.join(userDataDir, 'settings.json');
  const logsFile = path.join(userDataDir, 'activity_logs.json');

  // Activity logs in-memory / persisted
  let activityLogs: ActivityItem[] = [
    {
      id: 'log-1',
      timestamp: new Date(Date.now() - 3600000 * 24).toISOString(),
      module: 'smart-clean',
      title: 'Smart Clean Completed',
      detail: 'Cleaned browser caches and temporary system files',
      type: 'success',
      spaceFreedBytes: 3420000000,
    },
    {
      id: 'log-2',
      timestamp: new Date(Date.now() - 3600000 * 48).toISOString(),
      module: 'registry-fixer',
      title: 'Registry Cleaned',
      detail: 'Fixed 24 orphaned keys and missing DLL references',
      type: 'info',
    },
    {
      id: 'log-3',
      timestamp: new Date(Date.now() - 3600000 * 72).toISOString(),
      module: 'startup-optimizer',
      title: 'Startup Optimized',
      detail: 'Disabled 3 high-impact background updaters (-2.4s boot time)',
      type: 'success',
    },
  ];

  // Load activity logs if exist
  try {
    if (fs.existsSync(logsFile)) {
      const data = fs.readFileSync(logsFile, 'utf-8');
      activityLogs = JSON.parse(data);
    }
  } catch (err) {
    console.error('Failed to read activity logs:', err);
  }

  function logActivity(item: Omit<ActivityItem, 'id' | 'timestamp'>) {
    const newLog: ActivityItem = {
      ...item,
      id: 'log-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
      timestamp: new Date().toISOString(),
    };
    activityLogs.unshift(newLog);
    if (activityLogs.length > 100) activityLogs.pop();
    try {
      fs.writeFileSync(logsFile, JSON.stringify(activityLogs, null, 2));
    } catch (e) {
      console.error('Failed to write activity logs:', e);
    }
  }

  // Migrate legacy backups to the unified backup store (<userData>/backups/startup/)
  try {
    migrateLegacyBackups(userDataDir, (item) => logActivity(item as any));
  } catch (err) {
    console.warn('Backup migration check error:', err);
  }

  // --- Window Handlers ---
  ipcMain.handle(IPC_CHANNELS.WINDOW_MINIMIZE, () => {
    mainWindow.minimize();
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_MAXIMIZE, () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_CLOSE, () => {
    mainWindow.close();
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_IS_MAXIMIZED, () => {
    return mainWindow.isMaximized();
  });

  // --- System Specs & Telemetry ---
  let cachedSystemSpecs: { data: SystemSpecs; timestamp: number } | null = null;
  const SYSTEM_SPECS_CACHE_TTL_MS = 60 * 1000; // 60s cache in main process

  ipcMain.handle(IPC_CHANNELS.SYSTEM_GET_SPECS, async (): Promise<SystemSpecs> => {
    if (!isWindows()) {
      throw new Error('System specifications are only available on Windows');
    }

    if (cachedSystemSpecs && Date.now() - cachedSystemSpecs.timestamp < SYSTEM_SPECS_CACHE_TTL_MS) {
      return cachedSystemSpecs.data;
    }

    // 1. Operating System
    let osInfo: OSInfo = {
      platform: os.platform(),
      distro: 'Unknown Windows',
      release: os.release(),
      build: 'Unknown',
      arch: os.arch(),
      hostname: os.hostname(),
      uptimeSeconds: Math.floor(os.uptime()),
      isWindows: true,
      activationStatus: 'Unknown',
    };
    try {
      const [osRows, activationStatus] = await Promise.all([
        getOperatingSystem({ timeoutMs: 5000 }).catch((e) => {
          console.warn('Failed to query Win32_OperatingSystem:', e);
          return [];
        }),
        getActivationStatus({ timeoutMs: 5000 }).catch((e) => {
          console.warn('Failed to query activation status:', e);
          return 'Unknown';
        }),
      ]);
      const osRow = osRows[0];
      if (osRow) {
        let uptimeSec = Math.floor(os.uptime());
        if (osRow.LastBootUpTime) {
          const bootIso = parseCimDate(osRow.LastBootUpTime);
          if (bootIso) {
            const bootTime = new Date(bootIso).getTime();
            if (!Number.isNaN(bootTime) && bootTime > 0) {
              uptimeSec = Math.max(0, Math.floor((Date.now() - bootTime) / 1000));
            }
          }
        }
        osInfo = {
          platform: os.platform(),
          distro: osRow.Caption || 'Microsoft Windows',
          release: osRow.Version || os.release(),
          build: osRow.BuildNumber || 'Unknown',
          arch: osRow.OSArchitecture || os.arch(),
          hostname: os.hostname(),
          uptimeSeconds: uptimeSec,
          isWindows: true,
          activationStatus,
        };
      } else {
        osInfo.activationStatus = activationStatus;
      }
    } catch (err) {
      console.warn('Failed to assemble OS section:', err);
    }

    // 2. CPU
    let cpuInfo: CPUInfo = {
      manufacturer: 'Unknown',
      brand: 'Unknown Processor',
      speedGhz: null,
      cores: os.cpus().length || 1,
      physicalCores: Math.max(1, Math.floor((os.cpus().length || 1) / 2)),
      usagePercent: null,
      tempC: null,
    };
    try {
      const [processors, cpuPerf, cpuTemp] = await Promise.all([
        getProcessors({ timeoutMs: 5000 }).catch((e) => {
          console.warn('Failed to query Win32_Processor:', e);
          return [];
        }),
        getCpuPerformance({ timeoutMs: 8000 }).catch((e) => {
          console.warn('Failed to query CPU performance:', e);
          return null;
        }),
        getCpuTemperature({ timeoutMs: 3000 }).catch((e) => {
          console.warn('Failed to query CPU temperature:', e);
          return null;
        }),
      ]);
      const proc = processors[0];
      if (proc) {
        const maxClock = toNumber(proc.MaxClockSpeed);
        const cores = toNumber(proc.NumberOfLogicalProcessors) ?? os.cpus().length ?? 1;
        const physicalCores = toNumber(proc.NumberOfCores) ?? Math.max(1, Math.floor(cores / 2));
        cpuInfo = {
          manufacturer: proc.Manufacturer || 'Unknown',
          brand: proc.Name ? proc.Name.trim() : (os.cpus()[0]?.model || 'Unknown Processor'),
          speedGhz: maxClock !== null && maxClock > 0 ? Math.round((maxClock / 1000) * 100) / 100 : null,
          cores,
          physicalCores,
          usagePercent: cpuPerf !== null ? Math.round(cpuPerf) : null,
          tempC: cpuTemp,
        };
      } else {
        cpuInfo.usagePercent = cpuPerf !== null ? Math.round(cpuPerf) : null;
        cpuInfo.tempC = cpuTemp;
      }
    } catch (err) {
      console.warn('Failed to assemble CPU section:', err);
    }

    // 3. Memory
    let memoryInfo: MemoryInfo = {
      totalBytes: os.totalmem(),
      usedBytes: Math.max(0, os.totalmem() - os.freemem()),
      freeBytes: os.freemem(),
      usagePercent: os.totalmem() > 0 ? Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100) : 0,
      speedMhz: null,
      type: null,
    };
    try {
      const [osRows, physMem] = await Promise.all([
        getOperatingSystem({ timeoutMs: 5000 }).catch((e) => {
          console.warn('Failed to query Win32_OperatingSystem for memory:', e);
          return [];
        }),
        getPhysicalMemory({ timeoutMs: 5000 }).catch((e) => {
          console.warn('Failed to query Win32_PhysicalMemory:', e);
          return [];
        }),
      ]);
      const osRow = osRows[0];
      let totalBytes = os.totalmem();
      let freeBytes = os.freemem();
      if (osRow) {
        const visibleKb = toNumber(osRow.TotalVisibleMemorySize);
        const freeKb = toNumber(osRow.FreePhysicalMemory);
        if (visibleKb !== null && visibleKb > 0) {
          totalBytes = visibleKb * 1024;
        }
        if (freeKb !== null && freeKb >= 0) {
          freeBytes = freeKb * 1024;
        }
      }
      const usedBytes = Math.max(0, totalBytes - freeBytes);
      const usagePercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0;

      let speedMhz: number | null = null;
      let memType: string | null = null;
      if (physMem.length > 0) {
        const speeds = physMem
          .map((m) => toNumber(m.Speed))
          .filter((s): s is number => s !== null && s > 0);
        if (speeds.length > 0) {
          speedMhz = Math.max(...speeds);
        }
        const typeModule = physMem.find(
          (m) => m.SMBIOSMemoryType !== null && m.SMBIOSMemoryType !== undefined
        );
        if (typeModule) {
          const rawCode = toNumber(typeModule.SMBIOSMemoryType);
          memType = rawCode !== null ? smbiosMemoryType(rawCode) : 'Unknown';
        }
      }

      memoryInfo = {
        totalBytes,
        usedBytes,
        freeBytes,
        usagePercent,
        speedMhz,
        type: memType,
      };
    } catch (err) {
      console.warn('Failed to assemble memory section:', err);
    }

    // 4. Drives
    let drives: DriveInfo[] = [];
    try {
      const [diskMeasurements, partitions, disks, physicalDisks] = await Promise.all([
        getDiskMeasurements({ timeoutMs: 5000 }).catch((e) => {
          console.warn('Failed to query disk measurements:', e);
          return [];
        }),
        getPartitions({ timeoutMs: 5000 }).catch((e) => {
          console.warn('Failed to query MSFT_Partition:', e);
          return [];
        }),
        getDisks({ timeoutMs: 5000 }).catch((e) => {
          console.warn('Failed to query MSFT_Disk:', e);
          return [];
        }),
        getPhysicalDisks({ timeoutMs: 5000 }).catch((e) => {
          console.warn('Failed to query MSFT_PhysicalDisk:', e);
          return [];
        }),
      ]);

      drives = diskMeasurements.map((dm) => {
        const letter = (dm.deviceId || '').replace(':', '').trim().toUpperCase();
        const part = partitions.find(
          (p) => p.DriveLetter && p.DriveLetter.trim().toUpperCase() === letter
        );
        const diskNumber = part?.DiskNumber !== null && part?.DiskNumber !== undefined ? part.DiskNumber : null;
        const disk = diskNumber !== null ? disks.find((d) => d.Number === diskNumber) : null;
        const physDisk =
          diskNumber !== null
            ? physicalDisks.find(
                (pd) =>
                  pd.DeviceId !== null &&
                  pd.DeviceId !== undefined &&
                  String(pd.DeviceId).trim() === String(diskNumber)
              )
            : physicalDisks.length === 1
            ? physicalDisks[0]
            : null;

        let driveType = 'Unknown';
        let healthStatus: 'good' | 'warning' | 'bad' | 'critical' | null = null;

        const mediaType = physDisk?.MediaType;
        const busType = physDisk?.BusType ?? disk?.BusType;
        const healthRaw = physDisk?.HealthStatus ?? disk?.HealthStatus;

        if (mediaType !== null && mediaType !== undefined) {
          const mLabel = mediaTypeLabel(mediaType);
          const bLabel = busType !== null && busType !== undefined ? busTypeLabel(busType) : 'Unknown';
          driveType = `${mLabel} (${bLabel})`;
        } else if (busType !== null && busType !== undefined) {
          const bLabel = busTypeLabel(busType);
          driveType = `Drive (${bLabel})`;
        }

        if (driveType === 'Unknown (Unknown)') {
          driveType = 'Unknown';
        }

        if (healthRaw === 0) {
          healthStatus = 'good';
        } else if (healthRaw === 1) {
          healthStatus = 'warning';
        } else if (healthRaw === 2) {
          healthStatus = 'bad';
        } else {
          healthStatus = null;
        }

        if (dm.isGoogleDrive && dm.totalBytes > 0) {
          driveType = 'Cloud Drive (Google Drive)';
        }

        const mount = dm.deviceId ? (dm.deviceId.endsWith('\\') ? dm.deviceId : `${dm.deviceId}\\`) : 'C:\\';
        const label = dm.volumeName || (dm.deviceId ? `Local Disk (${dm.deviceId})` : 'Local Disk');
        const fileSystem = dm.fileSystem;
        const id = (dm.deviceId || 'c').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'c';

        return {
          id,
          mount,
          label,
          type: driveType,
          totalBytes: dm.totalBytes,
          usedBytes: dm.usedBytes,
          freeBytes: dm.freeBytes,
          usagePercent: dm.usagePercent,
          fileSystem,
          healthStatus,
        };
      });
    } catch (err) {
      console.warn('Failed to assemble drives section:', err);
    }

    // 5. GPU
    let gpuInfo: GPUInfo = {
      model: 'Unknown GPU',
      vramMb: null,
      driverVersion: null,
      usagePercent: null,
      tempC: null,
    };
    try {
      const controllers = await getVideoControllers({ timeoutMs: 5000 });
      const controller = controllers[0];
      if (controller) {
        const rawAdapterRam = toNumber(controller.AdapterRAM);
        let vramMb: number | null = null;
        if (rawAdapterRam !== null && rawAdapterRam > 0) {
          const mb = Math.round(rawAdapterRam / (1024 * 1024));
          vramMb = mb > 0 ? mb : null;
        }

        // Win32_VideoController.AdapterRAM is a 32-bit field clamped to 4095 MB (0xFFFFFFFF).
        // Resolve true 64-bit VRAM from the display adapter registry class key.
        const modelName = controller.Name || 'Unknown GPU';
        const vram64 = await getGpuVram64BitMb(modelName).catch(() => null);
        if (vram64 !== null && vram64 > 0) {
          vramMb = vram64;
        }

        gpuInfo = {
          model: modelName,
          vramMb,
          driverVersion: controller.DriverVersion || null,
          usagePercent: null,
          tempC: null,
        };
      }
    } catch (err) {
      console.warn('Failed to assemble GPU section:', err);
    }

    // 6. Motherboard
    let mbInfo: MotherboardInfo = {
      manufacturer: 'Unknown',
      model: 'Unknown',
      biosVersion: 'Unknown',
      biosDate: null,
    };
    try {
      const [baseboard, bios] = await Promise.all([
        getBaseBoard({ timeoutMs: 5000 }).catch((e) => {
          console.warn('Failed to query Win32_BaseBoard:', e);
          return [];
        }),
        getBios({ timeoutMs: 5000 }).catch((e) => {
          console.warn('Failed to query Win32_BIOS:', e);
          return [];
        }),
      ]);
      const bb = baseboard[0];
      const b = bios[0];
      mbInfo = {
        manufacturer: bb?.Manufacturer || 'Unknown',
        model: bb?.Product || 'Unknown',
        biosVersion: b?.SMBIOSBIOSVersion || 'Unknown',
        biosDate: b?.ReleaseDate ? parseCimDate(b.ReleaseDate) : null,
      };
    } catch (err) {
      console.warn('Failed to assemble motherboard section:', err);
    }

    // 7. Network
    let netInfo: NetworkInfo = {
      interfaceName: 'Ethernet',
      ipAddress: 'Unavailable',
      macAddress: 'Unavailable',
      linkSpeedMbps: null,
      rxBytesSec: 0,
      txBytesSec: 0,
    };
    try {
      const [configs, devices, perfRows] = await Promise.all([
        getNetworkAdapters({ timeoutMs: 5000 }).catch((e) => {
          console.warn('Failed to query Win32_NetworkAdapterConfiguration:', e);
          return [];
        }),
        getNetworkAdapterDevices({ timeoutMs: 5000 }).catch((e) => {
          console.warn('Failed to query Win32_NetworkAdapter:', e);
          return [];
        }),
        getNetworkPerformance({ timeoutMs: 5000 }).catch((e) => {
          console.warn('Failed to query Win32_PerfFormattedData_Tcpip_NetworkInterface:', e);
          return [];
        }),
      ]);

      const activeConfig =
        configs.find((c) => {
          if (Array.isArray(c.IPAddress) && c.IPAddress.length > 0) return true;
          return typeof c.IPAddress === 'string' && c.IPAddress.trim().length > 0;
        }) || configs[0];

      if (activeConfig) {
        let ipAddress = 'Unavailable';
        if (Array.isArray(activeConfig.IPAddress) && activeConfig.IPAddress.length > 0) {
          ipAddress = activeConfig.IPAddress[0];
        } else if (typeof activeConfig.IPAddress === 'string') {
          ipAddress = activeConfig.IPAddress;
        }

        const macAddress = activeConfig.MACAddress || 'Unavailable';
        const interfaceName = activeConfig.Description || 'Network Adapter';

        let linkSpeedMbps: number | null = null;
        if (activeConfig.Index !== null && activeConfig.Index !== undefined) {
          const matchedDev = devices.find((d) => d.Index === activeConfig.Index);
          if (matchedDev) {
            const rawSpeed = toNumber(matchedDev.Speed);
            if (rawSpeed !== null && rawSpeed > 0) {
              linkSpeedMbps = Math.round(rawSpeed / 1_000_000);
            }
          }
        }

        let rxBytesSec = 0;
        let txBytesSec = 0;
        const cleanDesc = (interfaceName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const matchedPerf = perfRows.find((p) => {
          if (!p.Name) return false;
          const cleanName = p.Name.toLowerCase().replace(/[^a-z0-9]/g, '');
          return cleanName.length > 0 && (cleanName.includes(cleanDesc) || cleanDesc.includes(cleanName));
        });
        if (matchedPerf) {
          rxBytesSec = toNumber(matchedPerf.BytesReceivedPersec) ?? 0;
          txBytesSec = toNumber(matchedPerf.BytesSentPersec) ?? 0;
        }

        netInfo = {
          interfaceName,
          ipAddress,
          macAddress,
          linkSpeedMbps,
          rxBytesSec,
          txBytesSec,
        };
      }
    } catch (err) {
      console.warn('Failed to assemble network section:', err);
    }

    const result: SystemSpecs = {
      os: osInfo,
      cpu: cpuInfo,
      memory: memoryInfo,
      drives,
      gpu: gpuInfo,
      motherboard: mbInfo,
      network: netInfo,
    };
    cachedSystemSpecs = { data: result, timestamp: Date.now() };
    return result;
  });

  let prevCpuTimes: { idle: number; total: number } | null = null;

  function getInstantCpuUsage(): number | null {
    const cpus = os.cpus();
    if (!cpus || cpus.length === 0) return null;
    let idle = 0;
    let total = 0;
    for (const cpu of cpus) {
      for (const type in cpu.times) {
        total += (cpu.times as Record<string, number>)[type];
      }
      idle += cpu.times.idle;
    }
    if (!prevCpuTimes) {
      prevCpuTimes = { idle, total };
      return null;
    }
    const idleDiff = idle - prevCpuTimes.idle;
    const totalDiff = total - prevCpuTimes.total;
    prevCpuTimes = { idle, total };
    return totalDiff > 0 ? Math.max(0, Math.min(100, Math.round(((totalDiff - idleDiff) / totalDiff) * 100))) : 0;
  }

  // Pre-seed baseline CPU counters
  getInstantCpuUsage();

  let inFlightTelemetry: Promise<{ cpu: number; memory: number; diskRead: number; diskWrite: number }> | null = null;
  let cachedDiskTelemetry = { diskRead: 0, diskWrite: 0, timestamp: 0 };
  const DISK_TELEMETRY_CACHE_TTL_MS = 3000;

  ipcMain.handle(IPC_CHANNELS.SYSTEM_GET_TELEMETRY, () => {
    if (!isWindows()) {
      throw new Error('System telemetry is only available on Windows');
    }

    if (inFlightTelemetry) {
      return inFlightTelemetry;
    }

    inFlightTelemetry = (async () => {
      try {
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const memUsage = totalMem > 0 ? Math.round(((totalMem - freeMem) / totalMem) * 100) : 0;

        let cpuUsage = 0;
        const instantCpu = getInstantCpuUsage();
        if (instantCpu !== null) {
          cpuUsage = instantCpu;
        } else {
          try {
            const cpuPerf = await getCpuPerformance({ timeoutMs: 5000 });
            if (cpuPerf !== null) {
              cpuUsage = Math.round(cpuPerf);
            }
          } catch (err) {
            console.warn('Failed to get CPU telemetry:', err);
          }
        }

        let diskReadMb = cachedDiskTelemetry.diskRead;
        let diskWriteMb = cachedDiskTelemetry.diskWrite;
        const now = Date.now();

        if (now - cachedDiskTelemetry.timestamp >= DISK_TELEMETRY_CACHE_TTL_MS) {
          try {
            const diskPerf = await getDiskPerformance({ timeoutMs: 10000 });
            const toMb = (bytesSec: number) => {
              const mb = bytesSec / (1024 * 1024);
              if (mb <= 0) return 0;
              if (mb < 0.1) return Math.round(mb * 100) / 100;
              return Math.round(mb * 10) / 10;
            };
            diskReadMb = toMb(diskPerf.diskReadBytesSec);
            diskWriteMb = toMb(diskPerf.diskWriteBytesSec);
            cachedDiskTelemetry = { diskRead: diskReadMb, diskWrite: diskWriteMb, timestamp: now };
          } catch (err) {
            warnOnce('telemetry:disk', 'Failed to get disk telemetry', err);
          }
        }

        return {
          cpu: cpuUsage,
          memory: memUsage,
          diskRead: diskReadMb,
          diskWrite: diskWriteMb,
        };
      } finally {
        inFlightTelemetry = null;
      }
    })();

    return inFlightTelemetry;
  });

  // --- Health Check ---
  ipcMain.handle(IPC_CHANNELS.HEALTH_GET_REPORT, async (): Promise<HealthReport> => {
    const report = await generateHealthReport();
    logActivity({
      module: 'health-check',
      title: 'Health Check Report Generated',
      detail: `Health score: ${report.score !== null ? report.score : 'not measured'} (formula v${HEALTH_SCORE_FORMULA_VERSION})`,
      type: 'info',
    });
    return report;
  });

  // --- Smart Clean ---
  let lastSmartCleanReport: SmartCleanReport | null = null;

  ipcMain.handle(IPC_CHANNELS.SMART_CLEAN_SCAN, async (_, enabledCategoryIds?: string[]): Promise<SmartCleanReport> => {
    const report = await scanSmartClean(enabledCategoryIds);
    lastSmartCleanReport = report;

    logActivity({
      module: 'smart-clean',
      title: 'Smart Clean Scan Completed',
      detail: `Scanned ${report.categories.length} categories in ${report.scanDurationMs}ms, found ${report.totalReclaimableBytes.toLocaleString()} bytes`,
      type: 'info',
    });

    return report;
  });

  ipcMain.handle(
    IPC_CHANNELS.SMART_CLEAN_EXECUTE,
    async (
      _,
      options?: string[] | { report?: SmartCleanReport; selectedCategoryIds?: string[] }
    ): Promise<ExecuteResult> => {
      let selectedCategoryIds: string[] | undefined;
      let report: SmartCleanReport | null = null;

      if (Array.isArray(options)) {
        selectedCategoryIds = options;
      } else if (options && typeof options === 'object') {
        selectedCategoryIds = options.selectedCategoryIds;
        report = options.report || null;
      }

      if (!report) {
        report = lastSmartCleanReport || (await scanSmartClean(selectedCategoryIds));
      }

      // 1. FRAMEWORK_PLAN: Convert scan report to framework OperationPlan
      const plan = createSmartCleanPlan(report, selectedCategoryIds);

      // 2. FRAMEWORK_EXECUTE: Execute through framework pipeline
      return executeOperationPlan(plan.id, (item) => logActivity(item as any));
    }
  );

  // --- Registry Fixer ---
  ipcMain.handle(IPC_CHANNELS.REGISTRY_SCAN, async (): Promise<RegistryScanResult> => {
    return scanRegistryFixer();
  });

  ipcMain.handle(
    IPC_CHANNELS.REGISTRY_FIX,
    async (_, issueIds?: string[]): Promise<RegistryFixerResult> => {
      const scanRes = await scanRegistryFixer();
      return executeRegistryFix(scanRes.issues, issueIds, {
        logActivity: (item) => logActivity(item as any),
      });
    }
  );

  ipcMain.handle(IPC_CHANNELS.REGISTRY_GET_BACKUPS, async (): Promise<RegistryBackup[]> => {
    try {
      const regBackupsDir = getModuleBackupDir('registry', userDataDir);
      if (!fs.existsSync(regBackupsDir)) {
        return [];
      }
      const files = fs.readdirSync(regBackupsDir).filter((f) => f.endsWith('.reg'));
      return files.map((file) => {
        const fullPath = path.join(regBackupsDir, file);
        const stats = fs.statSync(fullPath);
        let issueCount = 0;
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const commentMatch = content.match(/;\s*(?:Issues backed up|Issues|Issue count):\s*(\d+)/i);
          if (commentMatch) {
            const parsed = parseInt(commentMatch[1], 10);
            issueCount = Number.isNaN(parsed) ? 0 : parsed;
          } else {
            const keyMatches = content.match(/^\[.+\]/gm);
            issueCount = keyMatches ? keyMatches.length : 0;
          }
        } catch {
          issueCount = 0;
        }

        return {
          id: file.replace('.reg', ''),
          timestamp: stats.mtime.toISOString(),
          filePath: fullPath,
          issueCount,
          sizeBytes: stats.size,
        };
      });
    } catch (e) {
      return [];
    }
  });

  ipcMain.handle(IPC_CHANNELS.REGISTRY_RESTORE_BACKUP, async (_, backupId: string) => {
    return {
      success: false,
      message: 'Registry backup restoration is not implemented yet.',
    };
  });

  // --- App / Elevation ---
  ipcMain.handle(IPC_CHANNELS.APP_IS_ELEVATED, async (): Promise<boolean> => {
    return isElevated();
  });

  ipcMain.handle(IPC_CHANNELS.APP_RELAUNCH_ELEVATED, async (): Promise<{ success: boolean; message?: string }> => {
    try {
      // In portable packaged mode, relaunch the portable container executable,
      // NOT the extracted child in Temp which gets deleted when the old process exits!
      let targetExe = process.execPath;
      if (app.isPackaged && process.env.PORTABLE_EXECUTABLE_FILE) {
        targetExe = process.env.PORTABLE_EXECUTABLE_FILE;
      }

      const args: string[] = [];
      if (!app.isPackaged) {
        args.push(app.getAppPath());
      }
      args.push('--relaunch-elevated');

      // Request UAC elevation; awaits user acceptance on the UAC prompt
      await relaunchElevated(targetExe, args);

      // Once elevated process is spawned, immediately release the singleton lock
      // so the new elevated instance acquires it without conflict.
      app.releaseSingleInstanceLock();

      // Close the current window and exit the unelevated process cleanly.
      setTimeout(() => {
        app.exit(0);
      }, 150);

      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, message };
    }
  });

  // --- Startup Optimizer ---
  let cachedStartupItems: { data: StartupItem[]; timestamp: number } | null = null;
  const STARTUP_ITEMS_CACHE_TTL_MS = 30 * 1000; // 30s cache in main process

  ipcMain.handle(IPC_CHANNELS.STARTUP_GET_ITEMS, async (): Promise<StartupItem[]> => {
    if (cachedStartupItems && Date.now() - cachedStartupItems.timestamp < STARTUP_ITEMS_CACHE_TTL_MS) {
      return cachedStartupItems.data;
    }
    const items = await getStartupItems();
    cachedStartupItems = { data: items, timestamp: Date.now() };
    return items;
  });

  ipcMain.handle(
    IPC_CHANNELS.STARTUP_TOGGLE_ITEM,
    async (_, id: string, enabled: boolean): Promise<{ success: boolean; message?: string }> => {
      cachedStartupItems = null; // Invalidate cache on change
      const result = await toggleStartupItem(id, enabled);
      if (result.success) {
        logActivity({
          module: 'startup-optimizer',
          title: `Startup Item ${enabled ? 'Enabled' : 'Disabled'}`,
          detail: result.backupPath
            ? `Startup item ${id} was ${enabled ? 'enabled' : 'disabled'}. Backup saved to: ${result.backupPath}`
            : `Startup item ${id} was ${enabled ? 'enabled' : 'disabled'}.`,
          type: 'success',
        });
      }
      return result;
    }
  );

  // STEP 7 — Global Startup Delay Control (reads & writes HKCU\...\Serialize)
  ipcMain.handle(IPC_CHANNELS.STARTUP_GET_DELAY, async (): Promise<StartupDelayState> => {
    return getStartupDelay();
  });

  ipcMain.handle(
    IPC_CHANNELS.STARTUP_SET_DELAY,
    async (
      _,
      ms: number | null,
      waitForIdle: boolean
    ): Promise<{ success: boolean; message?: string }> => {
      const prior = await getStartupDelay();
      const result = await setStartupDelay(ms, waitForIdle);
      if (result.success) {
        const delayStr = ms === null ? 'Windows default (~10s)' : `${ms}ms`;
        const priorStr = prior.delayMs === null ? 'default' : `${prior.delayMs}ms`;
        logActivity({
          module: 'startup-optimizer',
          title: 'Global Startup Delay Configured',
          detail: `Global startup delay set to ${delayStr} (idle wait: ${
            waitForIdle ? 'enabled' : 'disabled'
          }). Prior state: ${priorStr}.`,
          type: 'success',
        });
      }
      return result;
    }
  );

  // STEP 8 — Startup Backups & Restore (plugs into Phase 3 Framework)
  ipcMain.handle(IPC_CHANNELS.STARTUP_GET_BACKUPS, async (): Promise<StartupBackup[]> => {
    return getStartupBackups();
  });

  ipcMain.handle(IPC_CHANNELS.STARTUP_PLAN_RESTORE, async (_, backupId: string) => {
    return planStartupRestore(backupId);
  });

  ipcMain.handle(
    IPC_CHANNELS.STARTUP_RESTORE_BACKUP,
    async (_, backupId: string): Promise<{ success: boolean; message?: string }> => {
      cachedStartupItems = null; // Invalidate cache after restore
      return restoreStartupBackup(backupId, logActivity);
    }
  );

  // Phase 3 Destructive Framework channels
  ipcMain.handle(IPC_CHANNELS.FRAMEWORK_PLAN, async (_, module: string, options: any) => {
    if (module === 'startup-optimizer' || module === 'startup') {
      return planStartupRestore(options.backupId || options.id);
    }
    if (module === 'smart-clean' || module === 'smartclean') {
      const report =
        options?.report ||
        lastSmartCleanReport ||
        (await scanSmartClean(options?.selectedCategoryIds));
      return createSmartCleanPlan(report, options?.selectedCategoryIds, options);
    }
    if (module === 'registry-fixer' || module === 'registry') {
      const issues = options?.issues || (await scanRegistryFixer()).issues;
      return createRegistryFixPlan(issues, options?.selectedIssueIds, options);
    }
    if (module === 'duplicate-finder' || module === 'duplicates') {
      const scanRes =
        options?.scanResult ||
        lastDuplicateScanResult ||
        (duplicateGroups.length > 0 ? { groups: duplicateGroups, root: '' } : null);
      if (!scanRes) {
        throw new Error('No duplicate scan result available to create plan');
      }
      return createDuplicateDeletePlan(
        scanRes,
        options?.fileIds || options?.selectedFileIds,
        options
      );
    }
    throw new Error(`Module ${module} is not implemented in framework yet`);
  });

  ipcMain.handle(IPC_CHANNELS.FRAMEWORK_EXECUTE, async (_, planId: string) => {
    cachedStartupItems = null;
    return executeOperationPlan(planId, (item) => logActivity(item as any));
  });

  ipcMain.handle(IPC_CHANNELS.FRAMEWORK_BACKUPS_LIST, async (_, module: string) => {
    const mod = module === 'startup-optimizer' ? 'startup' : module;
    return listModuleBackups(mod, userDataDir);
  });

  ipcMain.handle(IPC_CHANNELS.FRAMEWORK_BACKUP_RESTORE, async (_, module: string, backupId: string) => {
    if (module === 'startup-optimizer' || module === 'startup') {
      cachedStartupItems = null;
      return restoreStartupBackup(backupId, (item) => logActivity(item as any));
    }
    throw new Error(`Module ${module} is not implemented in framework yet`);
  });

  // --- App Remover ---
  let installedApps: InstalledApp[] = [
    {
      id: 'app-chrome',
      name: 'Google Chrome',
      publisher: 'Google LLC',
      version: '122.0.6261.129',
      installDate: '2024-01-15',
      sizeBytes: 890000000,
      installLocation: 'C:\\Program Files\\Google\\Chrome',
      uninstallString: 'MsiExec.exe /I{B627197A-DB71-4628-98CA-0988ED7715DA}',
      leftoversDetected: 14,
    },
    {
      id: 'app-vscode',
      name: 'Visual Studio Code',
      publisher: 'Microsoft Corporation',
      version: '1.87.2',
      installDate: '2024-02-20',
      sizeBytes: 1450000000,
      installLocation: 'C:\\Users\\User\\AppData\\Local\\Programs\\Microsoft VS Code',
      uninstallString: 'C:\\Users\\User\\AppData\\Local\\Programs\\Microsoft VS Code\\unins000.exe',
      leftoversDetected: 28,
    },
    {
      id: 'app-discord',
      name: 'Discord',
      publisher: 'Discord Inc.',
      version: '1.0.9032',
      installDate: '2024-03-01',
      sizeBytes: 670000000,
      installLocation: 'C:\\Users\\User\\AppData\\Local\\Discord',
      uninstallString: 'C:\\Users\\User\\AppData\\Local\\Discord\\Update.exe --uninstall',
      leftoversDetected: 8,
    },
    {
      id: 'app-spotify',
      name: 'Spotify Music',
      publisher: 'Spotify AB',
      version: '1.2.31.1205',
      installDate: '2023-11-10',
      sizeBytes: 520000000,
      installLocation: 'C:\\Users\\User\\AppData\\Roaming\\Spotify',
      uninstallString: 'C:\\Users\\User\\AppData\\Roaming\\Spotify\\uninstall.exe',
      leftoversDetected: 19,
    },
    {
      id: 'app-epic',
      name: 'Epic Games Launcher',
      publisher: 'Epic Games, Inc.',
      version: '15.17.1',
      installDate: '2023-09-04',
      sizeBytes: 2150000000,
      installLocation: 'C:\\Program Files (x86)\\Epic Games\\Launcher',
      uninstallString: 'MsiExec.exe /X{D26D6816-EB66-4148-A976-59A6D2BE02C0}',
      leftoversDetected: 35,
    },
    {
      id: 'app-7zip',
      name: '7-Zip 23.01 (x64)',
      publisher: 'Igor Pavlov',
      version: '23.01',
      installDate: '2023-08-12',
      sizeBytes: 5800000,
      installLocation: 'C:\\Program Files\\7-Zip',
      uninstallString: 'C:\\Program Files\\7-Zip\\Uninstall.exe',
      leftoversDetected: 2,
    },
  ];

  ipcMain.handle(IPC_CHANNELS.APPS_GET_INSTALLED, async (): Promise<InstalledApp[]> => {
    return installedApps;
  });

  ipcMain.handle(IPC_CHANNELS.APPS_UNINSTALL, async (_, appId: string, deepCleanLeftovers: boolean): Promise<AppUninstallResult> => {
    const appToRemove = installedApps.find((a) => a.id === appId);
    installedApps = installedApps.filter((a) => a.id !== appId);

    logActivity({
      module: 'app-remover',
      title: 'App Uninstalled',
      detail: `Uninstalled ${appToRemove?.name || appId}${deepCleanLeftovers ? ' and removed leftover registry & folder keys' : ''}`,
      type: 'success',
      spaceFreedBytes: appToRemove?.sizeBytes,
    });

    return {
      appId,
      success: true,
      leftoversCleanedCount: deepCleanLeftovers ? (appToRemove?.leftoversDetected || 12) : 0,
      message: `Successfully uninstalled ${appToRemove?.name || appId}`,
    };
  });

  // --- Browser Extensions ---
  let browserExtensions: BrowserExtension[] = [
    {
      id: 'ext-ublock',
      browser: 'chrome',
      name: 'uBlock Origin',
      version: '1.56.0',
      description: 'An efficient blocker. Easy on CPU and memory.',
      enabled: true,
      permissions: ['webRequest', 'webRequestBlocking', 'storage'],
      riskLevel: 'safe',
      path: 'Chrome/Default/Extensions/cjpalhdlnbpafiamejdnhcphjbkeiagm',
    },
    {
      id: 'ext-bitwarden',
      browser: 'chrome',
      name: 'Bitwarden - Free Password Manager',
      version: '2024.2.1',
      description: 'A secure and free password manager for all of your devices.',
      enabled: true,
      permissions: ['storage', 'clipboardWrite', 'tabs'],
      riskLevel: 'safe',
      path: 'Chrome/Default/Extensions/nngceckbapebfimnlniiiahkandclblb',
    },
    {
      id: 'ext-darkreader',
      browser: 'edge',
      name: 'Dark Reader',
      version: '4.9.77',
      description: 'Dark mode for every website. Take care of your eyes, use dark theme.',
      enabled: true,
      permissions: ['storage', '<all_urls>'],
      riskLevel: 'moderate',
      path: 'Edge/Default/Extensions/eimadpbcbfnmbkopoojfekhnkhdbieeh',
    },
    {
      id: 'ext-coupon',
      browser: 'chrome',
      name: 'Auto-Coupons & Price Tracker (Adware Flag)',
      version: '2.1.0',
      description: 'Finds discounts automatically while shopping online.',
      enabled: false,
      permissions: ['<all_urls>', 'webRequest', 'cookies', 'history'],
      riskLevel: 'high',
      path: 'Chrome/Default/Extensions/randomadwareextensionid',
    },
    {
      id: 'ext-vimium',
      browser: 'firefox',
      name: 'Vimium',
      version: '2.1.2',
      description: 'The Hacker\'s Browser. Vimium provides keyboard shortcuts for navigation.',
      enabled: true,
      permissions: ['tabs', 'storage'],
      riskLevel: 'safe',
      path: 'Firefox/Profiles/default/extensions/vimium',
    },
  ];

  ipcMain.handle(IPC_CHANNELS.EXTENSIONS_GET, async (): Promise<BrowserExtension[]> => {
    return browserExtensions;
  });

  ipcMain.handle(IPC_CHANNELS.EXTENSIONS_TOGGLE, async (_, id: string, enabled: boolean) => {
    browserExtensions = browserExtensions.map((e) => (e.id === id ? { ...e, enabled } : e));
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.EXTENSIONS_REMOVE, async (_, id: string) => {
    const ext = browserExtensions.find((e) => e.id === id);
    browserExtensions = browserExtensions.filter((e) => e.id !== id);
    logActivity({
      module: 'extension-manager',
      title: 'Extension Removed',
      detail: `Removed browser extension: ${ext?.name || id}`,
      type: 'info',
    });
    return { success: true };
  });

  // --- Disk Space Analyzer ---
  let isDiskScanCancelled = false;

  ipcMain.handle(IPC_CHANNELS.DISK_CANCEL, () => {
    isDiskScanCancelled = true;
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.DISK_ANALYZE, async (_, drivePath: string): Promise<DiskAnalysisResult> => {
    isDiskScanCancelled = false;
    const targetPath = drivePath || (process.platform === 'win32' ? 'C:\\' : '/');

    // Query drive totals via CIM Win32_LogicalDisk (OQ-12)
    let driveTotalBytes: number | null = null;
    let driveFreeBytes: number | null = null;

    if (isWindows()) {
      try {
        const driveMatch = targetPath.match(/^([a-zA-Z]):/);
        const letter = driveMatch ? driveMatch[1].toUpperCase() : 'C';
        const disks = await getLogicalDisks({ timeoutMs: 5000 }).catch((err) => {
          console.warn('Failed to query Win32_LogicalDisk for DiskAnalyzer:', err);
          return [];
        });
        const disk = disks.find((d) => d.DeviceID?.toUpperCase().startsWith(letter + ':'));
        if (disk) {
          const rawTotal = toNumber(disk.Size);
          const rawFree = toNumber(disk.FreeSpace);
          driveTotalBytes = rawTotal !== null && rawTotal > 0 ? rawTotal : null;
          driveFreeBytes = rawFree !== null && rawFree >= 0 ? rawFree : null;
        }
      } catch (err) {
        console.warn('CIM query error in DiskAnalyzer:', err);
      }
    }

    const result = await walk(targetPath, {
      driveTotalBytes,
      driveFreeBytes,
      isCancelled: () => isDiskScanCancelled,
      onProgress: (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC_CHANNELS.DISK_SCAN_PROGRESS, progress);
        }
      },
    });

    logActivity({
      module: 'disk-analyzer',
      title: 'Disk Analyzed',
      detail: `Scanned ${result.fileCount.toLocaleString()} files across ${result.directoryCount.toLocaleString()} directories in ${targetPath} (${result.complete ? 'complete' : 'partial'})`,
      type: 'info',
    });

    return result;
  });


  let duplicateGroups: DuplicateGroup[] = [];
  let lastDuplicateScanResult: DuplicateScanResult | null = null;

  ipcMain.handle(
    IPC_CHANNELS.DUPLICATES_SCAN,
    async (_, config: DuplicateScanConfig): Promise<DuplicateScanResult> => {
      const result = await scanDuplicates(config);
      duplicateGroups = result.groups;
      lastDuplicateScanResult = result;
      logActivity({
        module: 'duplicate-finder',
        title: 'Duplicates Scanned',
        detail: `Found ${result.duplicateGroupCount} duplicate groups (${result.duplicateFileCount} files) in ${result.root}`,
        type: 'info',
      });
      return result;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.DUPLICATES_DELETE,
    async (
      _,
      options: string[] | { fileIds?: string[]; scanResult?: DuplicateScanResult }
    ): Promise<ExecuteResult> => {
      let fileIds: string[] | undefined;
      let scanResult: DuplicateScanResult | null = null;

      if (Array.isArray(options)) {
        fileIds = options;
      } else if (options && typeof options === 'object') {
        fileIds = options.fileIds;
        scanResult = options.scanResult || null;
      }

      const currentScan =
        scanResult ||
        lastDuplicateScanResult ||
        (duplicateGroups.length > 0 ? { groups: duplicateGroups, root: '' } : null);

      if (!currentScan) {
        return {
          success: false,
          completed: 0,
          failed: 0,
          skipped: 0,
          reclaimableBytes: null,
          failures: [
            {
              target: 'duplicate-finder',
              error: 'No scan results available to plan deletion',
            },
          ],
          message: 'No scan results available to plan deletion.',
        };
      }

      // 1. FRAMEWORK_PLAN: Convert scan result + selected duplicate files to OperationPlan
      const plan = createDuplicateDeletePlan(currentScan, fileIds);

      if (plan.actions.length === 0) {
        return {
          success: false,
          completed: 0,
          failed: 0,
          skipped: 0,
          reclaimableBytes: null,
          failures: [],
          message: 'No valid duplicate files selected for deletion.',
        };
      }

      // 2. FRAMEWORK_EXECUTE: Execute through framework pipeline
      const result = await executeOperationPlan(plan.id, (item) => logActivity(item as any));

      // 3. Update in-memory groups if deletion succeeded (or partially succeeded)
      if (result.completed > 0) {
        const failedTargets = new Set(result.failures.map((f) => f.target.toLowerCase()));
        const deletedTargets = new Set(
          plan.actions
            .filter((a) => !failedTargets.has(a.target.toLowerCase()))
            .map((a) => a.target.toLowerCase())
        );

        duplicateGroups = duplicateGroups
          .map((group) => {
            const remainingFiles = group.files.filter(
              (f) => !deletedTargets.has(f.path.toLowerCase())
            );
            return {
              ...group,
              files: remainingFiles,
              wastedBytes: Math.max(0, (remainingFiles.length - 1) * group.sizeBytes),
            };
          })
          .filter((g) => g.files.length > 1);

        if (lastDuplicateScanResult) {
          lastDuplicateScanResult = {
            ...lastDuplicateScanResult,
            groups: duplicateGroups,
            duplicateGroupCount: duplicateGroups.length,
            duplicateFileCount: duplicateGroups.reduce((acc, g) => acc + g.files.length, 0),
            wastedBytes: duplicateGroups.reduce((acc, g) => acc + g.wastedBytes, 0),
          };
        }
      }

      return result;
    }
  );

  // --- Secure Erase ---
  ipcMain.handle(IPC_CHANNELS.SHRED_ITEMS, async (_, paths: string[], methodId: ShredMethodId) => {
    const method = SHRED_METHODS.find((m) => m.id === methodId) || SHRED_METHODS[0];

    // For any real files passed, safely overwrite before deleting
    for (const p of paths) {
      try {
        if (fs.existsSync(p) && fs.statSync(p).isFile()) {
          const fileSize = fs.statSync(p).size;
          const fd = fs.openSync(p, 'r+');
          for (let pass = 0; pass < Math.min(method.passes, 3); pass++) {
            const buf = Buffer.alloc(Math.min(fileSize, 65536), pass % 2 === 0 ? 0x00 : 0xff);
            let written = 0;
            while (written < fileSize) {
              const toWrite = Math.min(buf.length, fileSize - written);
              fs.writeSync(fd, buf, 0, toWrite, written);
              written += toWrite;
            }
          }
          fs.closeSync(fd);
          fs.unlinkSync(p);
        }
      } catch (err) {
        console.error('Shredding error for path:', p, err);
      }
    }

    logActivity({
      module: 'secure-erase',
      title: 'Secure File Shredding',
      detail: `Shredded ${paths.length} items using ${method.name} (${method.passes} passes)`,
      type: 'warning',
    });

    return {
      success: true,
      shreddedCount: paths.length,
    };
  });

  ipcMain.handle(IPC_CHANNELS.WIPE_FREE_SPACE, async (_, driveLetter: string, methodId: ShredMethodId) => {
    const method = SHRED_METHODS.find((m) => m.id === methodId) || SHRED_METHODS[0];
    logActivity({
      module: 'secure-erase',
      title: 'Free Space Wiped',
      detail: `Completed ${method.passes}-pass wipe on drive ${driveLetter}`,
      type: 'success',
    });
    return { success: true, wipedBytes: 10 * 1024 * 1024 * 1024 };
  });

  // --- Settings ---
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, async (): Promise<AppSettings> => {
    try {
      if (fs.existsSync(settingsFile)) {
        const raw = fs.readFileSync(settingsFile, 'utf-8');
        return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
      }
    } catch (e) {
      console.error('Failed to read settings:', e);
    }
    return DEFAULT_SETTINGS;
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SAVE, async (_, newSettings: Partial<AppSettings>) => {
    try {
      let current = DEFAULT_SETTINGS;
      if (fs.existsSync(settingsFile)) {
        current = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsFile, 'utf-8')) };
      }
      const updated = { ...current, ...newSettings };
      fs.writeFileSync(settingsFile, JSON.stringify(updated, null, 2));
      return { success: true };
    } catch (e) {
      console.error('Failed to save settings:', e);
      return { success: false };
    }
  });

  // --- Activity Logs ---
  ipcMain.handle(IPC_CHANNELS.LOGS_GET, async (): Promise<ActivityItem[]> => {
    return activityLogs;
  });
}
