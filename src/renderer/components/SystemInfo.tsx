import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { api } from '../apiClient';
import { SystemSpecs } from '../../shared/types';
import { formatBytes } from '../utils/format';
import {
  Cpu,
  HardDrive,
  MemoryStick,
  Monitor,
  Wifi,
  CircuitBoard,
  Activity,
  RefreshCw,
  Loader2,
  Clock,
  Shield,
} from 'lucide-react';

export const SystemInfo: React.FC = () => {
  const [specs, setSpecs] = useState<SystemSpecs | null>(null);
  const [telemetry, setTelemetry] = useState<{ cpu: number; memory: number; diskRead: number; diskWrite: number }>({
    cpu: 0, memory: 0, diskRead: 0, diskWrite: 0,
  });
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadData = async () => {
    try {
      const [sysSpecs, t] = await Promise.all([
        api.getSystemSpecs(),
        api.getTelemetry(),
      ]);
      setSpecs(sysSpecs);
      setTelemetry(t);
    } catch (e) {
      console.error('Failed to load system info:', e);
    }
  };

  useEffect(() => {
    loadData();
    const timer = setInterval(async () => {
      try {
        const t = await api.getTelemetry();
        setTelemetry(t);
      } catch (e) {}
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadData();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  if (!specs) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-slate-400 animate-spin" />
      </div>
    );
  }

  const uptimeHours = Math.floor(specs.os.uptimeSeconds / 3600);
  const uptimeDays = Math.floor(uptimeHours / 24);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">System Information</h1>
          <p className="text-sm text-slate-400 mt-1">
            Hardware and software overview with real-time monitoring
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium border border-slate-700 transition-all disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* OS Info Card */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800/80 p-6"
      >
        <div className="absolute top-0 right-0 w-64 h-64 bg-slate-500/10 rounded-full blur-3xl pointer-events-none -mr-12 -mt-12" />
        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="flex items-center gap-5">
            <div className="p-3 rounded-xl bg-slate-500/10 border border-slate-500/30">
              <Monitor className="w-6 h-6 text-slate-300" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">{specs.os.distro}</h2>
              <p className="text-sm text-slate-400 mt-1">
                {specs.os.release} (Build {specs.os.build}) &middot; {specs.os.arch}
              </p>
              <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
                <span className="flex items-center gap-1">
                  <Shield className="w-3 h-3 text-emerald-400" /> {specs.os.activationStatus}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Uptime: {uptimeDays}d {uptimeHours % 24}h
                </span>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Hardware Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* CPU */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="p-5 rounded-xl bg-slate-900/60 border border-slate-800"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-blue-400" />
              <span className="text-xs font-bold text-slate-300 uppercase">Processor</span>
            </div>
            <span className="text-xs font-mono text-blue-400">{telemetry.cpu}%</span>
          </div>
          <h3 className="text-sm font-semibold text-white">{specs.cpu.brand}</h3>
          <p className="text-xs text-slate-400 mt-1">{specs.cpu.manufacturer}</p>
          <div className="mt-3 space-y-1 text-xs text-slate-500">
            <div className="flex justify-between">
              <span>Cores</span>
              <span className="text-slate-300">{specs.cpu.physicalCores}P + {specs.cpu.cores - specs.cpu.physicalCores}E</span>
            </div>
            <div className="flex justify-between">
              <span>Speed</span>
              <span className="text-slate-300">{specs.cpu.speedGhz} GHz</span>
            </div>
            {specs.cpu.tempC && (
              <div className="flex justify-between">
                <span>Temp</span>
                <span className="text-slate-300">{specs.cpu.tempC}°C</span>
              </div>
            )}
          </div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full mt-3 overflow-hidden">
            <div className="bg-blue-500 h-full transition-all duration-500" style={{ width: `${telemetry.cpu}%` }} />
          </div>
        </motion.div>

        {/* Memory */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="p-5 rounded-xl bg-slate-900/60 border border-slate-800"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <MemoryStick className="w-4 h-4 text-violet-400" />
              <span className="text-xs font-bold text-slate-300 uppercase">Memory</span>
            </div>
            <span className="text-xs font-mono text-violet-400">{telemetry.memory}%</span>
          </div>
          <h3 className="text-sm font-semibold text-white">
            {formatBytes(specs.memory.usedBytes)} / {formatBytes(specs.memory.totalBytes)}
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            {specs.memory.type || 'DDR4'} {specs.memory.speedMhz ? `@ ${specs.memory.speedMhz} MHz` : ''}
          </p>
          <div className="mt-3 space-y-1 text-xs text-slate-500">
            <div className="flex justify-between">
              <span>Used</span>
              <span className="text-slate-300">{formatBytes(specs.memory.usedBytes)}</span>
            </div>
            <div className="flex justify-between">
              <span>Free</span>
              <span className="text-emerald-400">{formatBytes(specs.memory.freeBytes)}</span>
            </div>
          </div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full mt-3 overflow-hidden">
            <div className="bg-violet-500 h-full transition-all duration-500" style={{ width: `${telemetry.memory}%` }} />
          </div>
        </motion.div>

        {/* GPU */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="p-5 rounded-xl bg-slate-900/60 border border-slate-800"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Monitor className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-bold text-slate-300 uppercase">Graphics</span>
            </div>
          </div>
          <h3 className="text-sm font-semibold text-white">{specs.gpu.model}</h3>
          <p className="text-xs text-slate-400 mt-1">Driver: {specs.gpu.driverVersion}</p>
          <div className="mt-3 space-y-1 text-xs text-slate-500">
            <div className="flex justify-between">
              <span>VRAM</span>
              <span className="text-slate-300">{specs.gpu.vramMb} MB</span>
            </div>
            {specs.gpu.tempC && (
              <div className="flex justify-between">
                <span>Temp</span>
                <span className="text-slate-300">{specs.gpu.tempC}°C</span>
              </div>
            )}
          </div>
        </motion.div>

        {/* Drives */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="p-5 rounded-xl bg-slate-900/60 border border-slate-800"
        >
          <div className="flex items-center gap-2 mb-3">
            <HardDrive className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-bold text-slate-300 uppercase">Storage</span>
          </div>
          <div className="space-y-3">
            {specs.drives.map((drive) => (
              <div key={drive.id}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-slate-300">{drive.label} ({drive.mount})</span>
                  <span className="text-slate-400">{drive.usagePercent}%</span>
                </div>
                <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      drive.usagePercent > 90
                        ? 'bg-rose-500'
                        : drive.usagePercent > 70
                        ? 'bg-amber-500'
                        : 'bg-cyan-500'
                    }`}
                    style={{ width: `${drive.usagePercent}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-slate-500 mt-0.5">
                  <span>{formatBytes(drive.usedBytes)} used</span>
                  <span>{formatBytes(drive.freeBytes)} free</span>
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Motherboard */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="p-5 rounded-xl bg-slate-900/60 border border-slate-800"
        >
          <div className="flex items-center gap-2 mb-3">
            <CircuitBoard className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-bold text-slate-300 uppercase">Motherboard</span>
          </div>
          <h3 className="text-sm font-semibold text-white">{specs.motherboard.manufacturer}</h3>
          <p className="text-xs text-slate-400 mt-1">{specs.motherboard.model}</p>
          <div className="mt-3 space-y-1 text-xs text-slate-500">
            <div className="flex justify-between">
              <span>BIOS</span>
              <span className="text-slate-300">{specs.motherboard.biosVersion}</span>
            </div>
            <div className="flex justify-between">
              <span>BIOS Date</span>
              <span className="text-slate-300">{specs.motherboard.biosDate}</span>
            </div>
          </div>
        </motion.div>

        {/* Network */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="p-5 rounded-xl bg-slate-900/60 border border-slate-800"
        >
          <div className="flex items-center gap-2 mb-3">
            <Wifi className="w-4 h-4 text-purple-400" />
            <span className="text-xs font-bold text-slate-300 uppercase">Network</span>
          </div>
          <h3 className="text-sm font-semibold text-white">{specs.network.interfaceName}</h3>
          <p className="text-xs text-slate-400 mt-1">{specs.network.ipAddress}</p>
          <div className="mt-3 space-y-1 text-xs text-slate-500">
            <div className="flex justify-between">
              <span>MAC</span>
              <span className="text-slate-300 font-mono">{specs.network.macAddress}</span>
            </div>
            <div className="flex justify-between">
              <span>Link Speed</span>
              <span className="text-slate-300">{specs.network.linkSpeedMbps} Mbps</span>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Live Telemetry */}
      <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="w-4 h-4 text-emerald-400" />
          <span className="text-sm font-bold text-slate-200">Live Telemetry</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/60">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
              <span>CPU</span>
              <span className="font-mono font-bold text-blue-400">{telemetry.cpu}%</span>
            </div>
            <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
              <div className="bg-blue-500 h-full transition-all duration-500" style={{ width: `${telemetry.cpu}%` }} />
            </div>
          </div>
          <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/60">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
              <span>Memory</span>
              <span className="font-mono font-bold text-violet-400">{telemetry.memory}%</span>
            </div>
            <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
              <div className="bg-violet-500 h-full transition-all duration-500" style={{ width: `${telemetry.memory}%` }} />
            </div>
          </div>
          <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/60">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
              <span>Disk Read</span>
              <span className="font-mono text-cyan-400 font-bold">{telemetry.diskRead} MB/s</span>
            </div>
            <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
              <div className="bg-cyan-500 h-full transition-all duration-500" style={{ width: `${Math.min(100, telemetry.diskRead * 2)}%` }} />
            </div>
          </div>
          <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/60">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
              <span>Disk Write</span>
              <span className="font-mono text-emerald-400 font-bold">{telemetry.diskWrite} MB/s</span>
            </div>
            <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
              <div className="bg-emerald-500 h-full transition-all duration-500" style={{ width: `${Math.min(100, telemetry.diskWrite * 5)}%` }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
