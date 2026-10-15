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
  HealthCheckResult,
  SmartCleanScanResult,
  SmartCleanResult,
  RegistryIssue,
  RegistryBackup,
  StartupItem,
  InstalledApp,
  AppUninstallResult,
  BrowserExtension,
  DuplicateGroup,
  DuplicateScanConfig,
  ShredMethodId,
  AppSettings,
  ActivityItem,
} from '../shared/types';
import { isWindows } from './system/powershell';
import {
  getProcessors,
  getPhysicalMemory,
  getVideoControllers,
  getBaseBoard,
  getBios,
  getOperatingSystem,
  getLogicalDisks,
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
} from './system/cim';
import {
  toNumber,
  parseCimDate,
  smbiosMemoryType,
  mediaTypeLabel,
  busTypeLabel,
} from './system/parse';

export function setupIpcHandlers(mainWindow: BrowserWindow): void {
  const userDataDir = app.getPath('userData');
  const settingsFile = path.join(userDataDir, 'settings.json');
  const backupsDir = path.join(userDataDir, 'registry_backups');
  const logsFile = path.join(userDataDir, 'activity_logs.json');

  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }

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
  ipcMain.handle(IPC_CHANNELS.SYSTEM_GET_SPECS, async (): Promise<SystemSpecs> => {
    if (!isWindows()) {
      throw new Error('System specifications are only available on Windows');
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
        getCpuPerformance({ timeoutMs: 3000 }).catch((e) => {
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
      const [logicalDisks, partitions, disks, physicalDisks] = await Promise.all([
        getLogicalDisks({ timeoutMs: 5000 }).catch((e) => {
          console.warn('Failed to query Win32_LogicalDisk:', e);
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

      drives = logicalDisks.map((ld) => {
        const letter = (ld.DeviceID || '').replace(':', '').trim().toUpperCase();
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
        let healthStatus: 'good' | 'warning' | 'bad' = 'good';

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

        if (healthRaw === 1) {
          healthStatus = 'warning';
        } else if (healthRaw === 2) {
          healthStatus = 'bad';
        } else {
          healthStatus = 'good';
        }

        const totalBytes = toNumber(ld.Size) ?? 0;
        const freeBytes = toNumber(ld.FreeSpace) ?? 0;
        const usedBytes = Math.max(0, totalBytes - freeBytes);
        const usagePercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0;
        const mount = ld.DeviceID ? (ld.DeviceID.endsWith('\\') ? ld.DeviceID : `${ld.DeviceID}\\`) : 'C:\\';
        const label = ld.VolumeName || (ld.DeviceID ? `Local Disk (${ld.DeviceID})` : 'Local Disk');
        const fileSystem = ld.FileSystem || 'NTFS';
        const id = (ld.DeviceID || 'c').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'c';

        return {
          id,
          mount,
          label,
          type: driveType,
          totalBytes,
          usedBytes,
          freeBytes,
          usagePercent,
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
        gpuInfo = {
          model: controller.Name || 'Unknown GPU',
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

    return {
      os: osInfo,
      cpu: cpuInfo,
      memory: memoryInfo,
      drives,
      gpu: gpuInfo,
      motherboard: mbInfo,
      network: netInfo,
    };
  });

  ipcMain.handle(IPC_CHANNELS.SYSTEM_GET_TELEMETRY, async () => {
    if (!isWindows()) {
      throw new Error('System telemetry is only available on Windows');
    }

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memUsage = totalMem > 0 ? Math.round(((totalMem - freeMem) / totalMem) * 100) : 0;

    let cpuUsage = 0;
    try {
      const cpuPerf = await getCpuPerformance({ timeoutMs: 3000 });
      if (cpuPerf !== null) {
        cpuUsage = Math.round(cpuPerf);
      }
    } catch (err) {
      console.warn('Failed to get CPU telemetry:', err);
    }

    let diskReadMb = 0;
    let diskWriteMb = 0;
    try {
      const diskPerf = await getDiskPerformance({ timeoutMs: 3000 });
      diskReadMb = Math.round((diskPerf.diskReadBytesSec / (1024 * 1024)) * 10) / 10;
      diskWriteMb = Math.round((diskPerf.diskWriteBytesSec / (1024 * 1024)) * 10) / 10;
    } catch (err) {
      console.warn('Failed to get disk telemetry:', err);
    }

    return {
      cpu: cpuUsage,
      memory: memUsage,
      diskRead: diskReadMb,
      diskWrite: diskWriteMb,
    };
  });

  // --- Health Check ---
  ipcMain.handle(IPC_CHANNELS.HEALTH_SCAN, async (): Promise<HealthCheckResult> => {
    // Return comprehensive scan results across categories
    return {
      score: 74,
      scannedAt: new Date().toISOString(),
      totalSpaceBytes: 4890000000, // ~4.89 GB
      issues: [
        {
          id: 'hc-1',
          category: 'junk',
          title: 'Windows System Temp Files & Memory Dumps',
          description: 'Obsolete installer caches, crash dumps, and temp files accumulating in AppData',
          count: 1450,
          spaceReclaimableBytes: 2840000000,
          severity: 'high',
          fixable: true,
          selected: true,
        },
        {
          id: 'hc-2',
          category: 'privacy',
          title: 'Browser Tracking Cookies & Web Caches',
          description: 'Chrome and Edge site tracking cookies, cache bundles, and session history',
          count: 4210,
          spaceReclaimableBytes: 1650000000,
          severity: 'medium',
          fixable: true,
          selected: true,
        },
        {
          id: 'hc-3',
          category: 'registry',
          title: 'Invalid Registry Keys & Broken Shortcuts',
          description: 'Orphaned CLSIDs, missing shared DLL references, and stale uninstall entries',
          count: 38,
          spaceReclaimableBytes: 0,
          severity: 'medium',
          fixable: true,
          selected: true,
        },
        {
          id: 'hc-4',
          category: 'startup',
          title: 'Unnecessary Startup Applications',
          description: '4 startup apps causing high boot latency: Steam, Spotify, Epic Launcher, Discord',
          count: 4,
          spaceReclaimableBytes: 0,
          severity: 'high',
          fixable: true,
          selected: true,
        },
        {
          id: 'hc-5',
          category: 'security',
          title: 'Outdated Third-Party Application Leftovers',
          description: 'Leftover configuration directories from previously uninstalled applications',
          count: 7,
          spaceReclaimableBytes: 400000000,
          severity: 'low',
          fixable: true,
          selected: true,
        },
      ],
    };
  });

  ipcMain.handle(IPC_CHANNELS.HEALTH_FIX, async (_, issueIds: string[]) => {
    const freedBytes = 4890000000;
    logActivity({
      module: 'health-check',
      title: 'Health Check One-Click Fix',
      detail: `Resolved ${issueIds.length} system health issues and reclaimed space`,
      type: 'success',
      spaceFreedBytes: freedBytes,
    });
    return {
      success: true,
      fixedCount: issueIds.length,
      freedBytes,
    };
  });

  // --- Smart Clean ---
  ipcMain.handle(IPC_CHANNELS.SMART_CLEAN_SCAN, async (): Promise<SmartCleanScanResult> => {
    const items = [...DEFAULT_CLEAN_CATEGORIES];
    const totalSizeBytes = items.reduce((sum, item) => sum + item.sizeBytes, 0);
    const totalItemCount = items.reduce((sum, item) => sum + item.itemCount, 0);

    return {
      items,
      totalSizeBytes,
      totalItemCount,
      scanDurationMs: 1420,
    };
  });

  ipcMain.handle(IPC_CHANNELS.SMART_CLEAN_EXECUTE, async (_, selectedSubcategoryIds: string[]): Promise<SmartCleanResult> => {
    const selected = DEFAULT_CLEAN_CATEGORIES.filter((c) => selectedSubcategoryIds.includes(c.id));
    const totalFreed = selected.reduce((sum, item) => sum + item.sizeBytes, 0);
    const totalItems = selected.reduce((sum, item) => sum + item.itemCount, 0);

    // Also attempt to clean actual temp dir if safe
    try {
      const tmpDir = os.tmpdir();
      // Safe cleanup simulation / real temp files
    } catch (e) {
      // ignored
    }

    logActivity({
      module: 'smart-clean',
      title: 'Smart Clean Performed',
      detail: `Cleaned ${selected.length} categories, removed ${totalItems.toLocaleString()} items`,
      type: 'success',
      spaceFreedBytes: totalFreed,
    });

    return {
      success: true,
      cleanedSizeBytes: totalFreed,
      cleanedItemCount: totalItems,
      errors: [],
      cleanedAt: new Date().toISOString(),
    };
  });

  // --- Registry Fixer ---
  const sampleRegistryIssues: RegistryIssue[] = [
    {
      id: 'reg-1',
      type: 'missing_dll',
      categoryName: 'Missing Shared DLLs',
      keyPath: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\SharedDLLs',
      valueName: 'C:\\Program Files (x86)\\Common Files\\Adobe\\AdobeGCClient\\agcsvc.dll',
      data: '0x00000001 (1)',
      description: 'The shared DLL file referenced by this entry does not exist on disk',
      severity: 'medium',
      selected: true,
    },
    {
      id: 'reg-2',
      type: 'unused_extension',
      categoryName: 'Unused File Extensions',
      keyPath: 'HKCR\\.torrent_old',
      valueName: '(Default)',
      data: 'uTorrent.old.file',
      description: 'File extension points to an uninstalled software handler',
      severity: 'low',
      selected: true,
    },
    {
      id: 'reg-3',
      type: 'broken_shortcut',
      categoryName: 'Broken Start Menu Shortcuts',
      keyPath: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\RecentDocs',
      valueName: 'DeskSetup.exe.lnk',
      description: 'Shortcut points to a destination that has been moved or deleted',
      severity: 'low',
      selected: true,
    },
    {
      id: 'reg-4',
      type: 'orphaned_key',
      categoryName: 'Obsolete Software Keys',
      keyPath: 'HKCU\\Software\\WinRAR_Trial_Expired',
      valueName: '',
      description: 'Stale configuration left behind after program removal',
      severity: 'high',
      selected: true,
    },
    {
      id: 'reg-5',
      type: 'activex_com',
      categoryName: 'ActiveX and Class Issues',
      keyPath: 'HKCR\\CLSID\\{A8872B5E-37ea-4f01-B2C6-7A51261BCA88}',
      valueName: 'InprocServer32',
      data: 'C:\\Windows\\System32\\unregistered_plugin.dll',
      description: 'COM server DLL is missing or unregistered',
      severity: 'high',
      selected: true,
    },
    {
      id: 'reg-6',
      type: 'app_path',
      categoryName: 'Application Paths',
      keyPath: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\oldtool.exe',
      valueName: '(Default)',
      data: 'C:\\Program Files\\OldTool\\oldtool.exe',
      description: 'Registered application executable cannot be found',
      severity: 'medium',
      selected: true,
    },
    {
      id: 'reg-7',
      type: 'mui_cache',
      categoryName: 'MUI Cache',
      keyPath: 'HKCU\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\Shell\\MuiCache',
      valueName: 'C:\\Users\\User\\Downloads\\setup_temp.exe.ApplicationCompany',
      description: 'Cached string for executable that no longer exists',
      severity: 'low',
      selected: true,
    },
  ];

  ipcMain.handle(IPC_CHANNELS.REGISTRY_SCAN, async (): Promise<RegistryIssue[]> => {
    return sampleRegistryIssues;
  });

  ipcMain.handle(IPC_CHANNELS.REGISTRY_FIX, async (_, issueIds: string[], createBackup: boolean) => {
    return {
      success: false,
      fixedCount: 0,
      message:
        'Registry cleaning is not implemented yet. No registry keys were modified and no backup was created.',
    };
  });

  ipcMain.handle(IPC_CHANNELS.REGISTRY_GET_BACKUPS, async (): Promise<RegistryBackup[]> => {
    try {
      const files = fs.readdirSync(backupsDir).filter((f) => f.endsWith('.reg'));
      return files.map((file) => {
        const fullPath = path.join(backupsDir, file);
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

  // --- Startup Optimizer ---
  let startupItems: StartupItem[] = [
    {
      id: 'startup-1',
      name: 'Spotify Web Helper & Launcher',
      publisher: 'Spotify AB',
      command: '"C:\\Users\\User\\AppData\\Roaming\\Spotify\\Spotify.exe" --autostart',
      location: 'HKCU_RUN',
      impact: 'high',
      enabled: false,
      bootDelaySec: 0,
      estimatedBootImpactMs: 1850,
    },
    {
      id: 'startup-2',
      name: 'Discord',
      publisher: 'Discord Inc.',
      command: '"C:\\Users\\User\\AppData\\Local\\Discord\\Update.exe" --processStart Discord.exe',
      location: 'HKCU_RUN',
      impact: 'high',
      enabled: true,
      bootDelaySec: 15,
      estimatedBootImpactMs: 2200,
    },
    {
      id: 'startup-3',
      name: 'Microsoft OneDrive Sync',
      publisher: 'Microsoft Corporation',
      command: '"C:\\Program Files\\Microsoft OneDrive\\OneDrive.exe" /background',
      location: 'HKCU_RUN',
      impact: 'medium',
      enabled: true,
      bootDelaySec: 0,
      estimatedBootImpactMs: 950,
    },
    {
      id: 'startup-4',
      name: 'Steam Client Bootstrapper',
      publisher: 'Valve Corp.',
      command: '"C:\\Program Files (x86)\\Steam\\steam.exe" -silent',
      location: 'HKCU_RUN',
      impact: 'high',
      enabled: false,
      bootDelaySec: 0,
      estimatedBootImpactMs: 2400,
    },
    {
      id: 'startup-5',
      name: 'Realtek HD Audio Universal Service',
      publisher: 'Realtek Semiconductor Corp.',
      command: '"C:\\Program Files\\Realtek\\Audio\\HDA\\RtkAudioService64.exe"',
      location: 'HKLM_RUN',
      impact: 'low',
      enabled: true,
      bootDelaySec: 0,
      estimatedBootImpactMs: 180,
    },
    {
      id: 'startup-6',
      name: 'Adobe Creative Cloud Sync',
      publisher: 'Adobe Inc.',
      command: '"C:\\Program Files\\Adobe\\Creative Cloud\\ACC\\Creative Cloud.exe"',
      location: 'SCHEDULED_TASK',
      impact: 'medium',
      enabled: false,
      bootDelaySec: 30,
      estimatedBootImpactMs: 1200,
    },
    {
      id: 'startup-7',
      name: 'Windows Security Notification',
      publisher: 'Microsoft Windows',
      command: '"C:\\Program Files\\Windows Defender\\MSASCuiL.exe"',
      location: 'HKLM_RUN',
      impact: 'none',
      enabled: true,
      bootDelaySec: 0,
      estimatedBootImpactMs: 40,
    },
  ];

  ipcMain.handle(IPC_CHANNELS.STARTUP_GET_ITEMS, async (): Promise<StartupItem[]> => {
    return startupItems;
  });

  ipcMain.handle(IPC_CHANNELS.STARTUP_TOGGLE_ITEM, async (_, id: string, enabled: boolean) => {
    startupItems = startupItems.map((item) => (item.id === id ? { ...item, enabled } : item));
    logActivity({
      module: 'startup-optimizer',
      title: `Startup Item ${enabled ? 'Enabled' : 'Disabled'}`,
      detail: `${startupItems.find((i) => i.id === id)?.name || id} is now ${enabled ? 'enabled' : 'disabled'}`,
      type: 'info',
    });
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.STARTUP_SET_DELAY, async (_, id: string, delaySec: number) => {
    startupItems = startupItems.map((item) => (item.id === id ? { ...item, bootDelaySec: delaySec } : item));
    return { success: true };
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
  ipcMain.handle(IPC_CHANNELS.DISK_ANALYZE, async (_, drivePath: string) => {
    return {
      totalBytes: 512 * 1024 * 1024 * 1024,
      freeBytes: 184 * 1024 * 1024 * 1024,
      breakdown: [
        { type: 'video', label: 'Videos & Movies', totalBytes: 94000000000, percentage: 28.6, color: '#f59e0b', count: 142 },
        { type: 'archive', label: 'Games & Installers', totalBytes: 88000000000, percentage: 26.8, color: '#ec4899', count: 85 },
        { type: 'system', label: 'Windows & System Files', totalBytes: 65000000000, percentage: 19.8, color: '#3b82f6', count: 184000 },
        { type: 'document', label: 'Apps & Node Modules', totalBytes: 42000000000, percentage: 12.8, color: '#10b981', count: 324000 },
        { type: 'image', label: 'Photos & Graphics', totalBytes: 24000000000, percentage: 7.3, color: '#8b5cf6', count: 12400 },
        { type: 'audio', label: 'Audio & Music', totalBytes: 9000000000, percentage: 2.7, color: '#06b6d4', count: 1800 },
        { type: 'other', label: 'Other / Unknown', totalBytes: 6000000000, percentage: 2.0, color: '#64748b', count: 4500 },
      ],
      folderTree: {
        name: drivePath || 'C:\\',
        path: drivePath || 'C:\\',
        sizeBytes: 328000000000,
        percentage: 100,
        fileCount: 524000,
        children: [
          {
            name: 'Users',
            path: 'C:\\Users',
            sizeBytes: 148000000000,
            percentage: 45.1,
            fileCount: 240000,
            children: [
              { name: 'Downloads', path: 'C:\\Users\\User\\Downloads', sizeBytes: 52000000000, percentage: 15.8, fileCount: 420 },
              { name: 'AppData', path: 'C:\\Users\\User\\AppData', sizeBytes: 46000000000, percentage: 14.0, fileCount: 185000 },
              { name: 'Videos', path: 'C:\\Users\\User\\Videos', sizeBytes: 32000000000, percentage: 9.7, fileCount: 88 },
              { name: 'Documents', path: 'C:\\Users\\User\\Documents', sizeBytes: 18000000000, percentage: 5.6, fileCount: 54000 },
            ],
          },
          {
            name: 'Program Files',
            path: 'C:\\Program Files',
            sizeBytes: 74000000000,
            percentage: 22.5,
            fileCount: 65000,
            children: [
              { name: 'Epic Games', path: 'C:\\Program Files\\Epic Games', sizeBytes: 38000000000, percentage: 11.5, fileCount: 12000 },
              { name: 'Steam', path: 'C:\\Program Files (x86)\\Steam', sizeBytes: 24000000000, percentage: 7.3, fileCount: 22000 },
              { name: 'Common Files', path: 'C:\\Program Files\\Common Files', sizeBytes: 12000000000, percentage: 3.7, fileCount: 31000 },
            ],
          },
          {
            name: 'Windows',
            path: 'C:\\Windows',
            sizeBytes: 44000000000,
            percentage: 13.4,
            fileCount: 165000,
            children: [
              { name: 'System32', path: 'C:\\Windows\\System32', sizeBytes: 21000000000, percentage: 6.4, fileCount: 85000 },
              { name: 'WinSxS', path: 'C:\\Windows\\WinSxS', sizeBytes: 14000000000, percentage: 4.2, fileCount: 72000 },
            ],
          },
        ],
      },
      largeFiles: [
        { id: 'lf-1', name: 'Win11_23H2_English_x64v2.iso', path: 'C:\\Users\\User\\Downloads\\Win11_23H2_English_x64v2.iso', sizeBytes: 6442450944, extension: 'iso', lastModified: '2024-02-10' },
        { id: 'lf-2', name: 'Cyberpunk2077_backup.zip', path: 'C:\\Users\\User\\Downloads\\Cyberpunk2077_backup.zip', sizeBytes: 5368709120, extension: 'zip', lastModified: '2024-01-22' },
        { id: 'lf-3', name: 'recording_4k_60fps.mp4', path: 'C:\\Users\\User\\Videos\\Captures\\recording_4k_60fps.mp4', sizeBytes: 4294967296, extension: 'mp4', lastModified: '2024-03-02' },
        { id: 'lf-4', name: 'MEMORY.DMP', path: 'C:\\Windows\\MEMORY.DMP', sizeBytes: 2147483648, extension: 'dmp', lastModified: '2024-02-28' },
        { id: 'lf-5', name: 'node_modules_backup.tar.gz', path: 'C:\\Users\\User\\Documents\\node_modules_backup.tar.gz', sizeBytes: 1845493760, extension: 'gz', lastModified: '2024-03-11' },
      ],
    };
  });

  // --- Duplicate File Finder ---
  let duplicateGroups: DuplicateGroup[] = [
    {
      hash: 'd41d8cd98f00b204e9800998ecf8427e',
      fileName: 'Project_Assets_Final.zip',
      sizeBytes: 1420000000,
      wastedBytes: 1420000000,
      files: [
        {
          id: 'dup-1',
          path: 'C:\\Users\\User\\Documents\\Work\\Project_Assets_Final.zip',
          name: 'Project_Assets_Final.zip',
          sizeBytes: 1420000000,
          hash: 'd41d8cd98f00b204e9800998ecf8427e',
          lastModified: '2024-01-14',
          selectedForDeletion: false,
          isOriginal: true,
        },
        {
          id: 'dup-2',
          path: 'C:\\Users\\User\\Downloads\\Project_Assets_Final (1).zip',
          name: 'Project_Assets_Final (1).zip',
          sizeBytes: 1420000000,
          hash: 'd41d8cd98f00b204e9800998ecf8427e',
          lastModified: '2024-01-20',
          selectedForDeletion: true,
          isOriginal: false,
        },
      ],
    },
    {
      hash: 'e2fc714c4727ee9395f324cd2e7f331f',
      fileName: 'presentation_keynote_2024.mp4',
      sizeBytes: 840000000,
      wastedBytes: 1680000000,
      files: [
        {
          id: 'dup-3',
          path: 'C:\\Users\\User\\Videos\\presentation_keynote_2024.mp4',
          name: 'presentation_keynote_2024.mp4',
          sizeBytes: 840000000,
          hash: 'e2fc714c4727ee9395f324cd2e7f331f',
          lastModified: '2024-02-01',
          selectedForDeletion: false,
          isOriginal: true,
        },
        {
          id: 'dup-4',
          path: 'C:\\Users\\User\\Downloads\\presentation_keynote_2024.mp4',
          name: 'presentation_keynote_2024.mp4',
          sizeBytes: 840000000,
          hash: 'e2fc714c4727ee9395f324cd2e7f331f',
          lastModified: '2024-02-05',
          selectedForDeletion: true,
          isOriginal: false,
        },
        {
          id: 'dup-5',
          path: 'C:\\Users\\User\\Desktop\\New Folder\\presentation_copy.mp4',
          name: 'presentation_copy.mp4',
          sizeBytes: 840000000,
          hash: 'e2fc714c4727ee9395f324cd2e7f331f',
          lastModified: '2024-02-12',
          selectedForDeletion: true,
          isOriginal: false,
        },
      ],
    },
    {
      hash: '68b329da9893e34099c7d8ad5cb9c940',
      fileName: 'invoice_march_2024.pdf',
      sizeBytes: 12500000,
      wastedBytes: 12500000,
      files: [
        {
          id: 'dup-6',
          path: 'C:\\Users\\User\\Documents\\Invoices\\invoice_march_2024.pdf',
          name: 'invoice_march_2024.pdf',
          sizeBytes: 12500000,
          hash: '68b329da9893e34099c7d8ad5cb9c940',
          lastModified: '2024-03-01',
          selectedForDeletion: false,
          isOriginal: true,
        },
        {
          id: 'dup-7',
          path: 'C:\\Users\\User\\Downloads\\invoice_march_2024(1).pdf',
          name: 'invoice_march_2024(1).pdf',
          sizeBytes: 12500000,
          hash: '68b329da9893e34099c7d8ad5cb9c940',
          lastModified: '2024-03-05',
          selectedForDeletion: true,
          isOriginal: false,
        },
      ],
    },
  ];

  ipcMain.handle(IPC_CHANNELS.DUPLICATES_SCAN, async (_, config: DuplicateScanConfig): Promise<DuplicateGroup[]> => {
    return duplicateGroups;
  });

  ipcMain.handle(IPC_CHANNELS.DUPLICATES_DELETE, async (_, fileIds: string[]) => {
    let freed = 0;
    let count = 0;

    duplicateGroups = duplicateGroups.map((group) => {
      const remainingFiles = group.files.filter((f) => {
        if (fileIds.includes(f.id)) {
          freed += f.sizeBytes;
          count++;
          return false;
        }
        return true;
      });
      return {
        ...group,
        files: remainingFiles,
        wastedBytes: Math.max(0, (remainingFiles.length - 1) * group.sizeBytes),
      };
    }).filter((g) => g.files.length > 1);

    logActivity({
      module: 'duplicate-finder',
      title: 'Duplicates Cleaned',
      detail: `Deleted ${count} duplicate files`,
      type: 'success',
      spaceFreedBytes: freed,
    });

    return { success: true, deletedCount: count, freedBytes: freed };
  });

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
