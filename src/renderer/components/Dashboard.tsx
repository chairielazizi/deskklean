import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { api } from '../apiClient';
import { ModuleId, ActivityItem, SystemSpecs, StartupItem, SmartCleanReport } from '../../shared/types';
import { formatBytes, formatDate } from '../utils/format';
import { dataCache } from '../utils/dataCache';
import {
  Sparkles,
  HeartPulse,
  Layers,
  Zap,
  HardDrive,
  Cpu,
  Activity,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  RefreshCw,
  Clock,
  Trash2,
} from 'lucide-react';

interface DashboardProps {
  onNavigate: (module: ModuleId) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ onNavigate }) => {
  const [specs, setSpecs] = useState<SystemSpecs | null>(null);
  const [telemetry, setTelemetry] = useState<{ cpu: number; memory: number; diskRead: number; diskWrite: number }>({
    cpu: 22,
    memory: 40,
    diskRead: 15,
    diskWrite: 4,
  });
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [smartCleanReport, setSmartCleanReport] = useState<SmartCleanReport | null>(() => dataCache.getSmartCleanReport());
  const [startupItems, setStartupItems] = useState<StartupItem[] | null>(() => dataCache.getStartupItems());

  useEffect(() => {
    const unsub = dataCache.subscribe(() => {
      setSmartCleanReport(dataCache.getSmartCleanReport());
      setStartupItems(dataCache.getStartupItems());
    });

    const loadData = async () => {
      try {
        const [sysSpecs, logs] = await Promise.all([
          api.getSystemSpecs(),
          api.getActivityLogs(),
        ]);
        setSpecs(sysSpecs);
        setActivities(logs);

        // Populate startup items into cache if missing
        if (!dataCache.getStartupItems()) {
          api.getStartupItems().then((items) => {
            dataCache.setStartupItems(items);
          }).catch(() => {});
        }
      } catch (e) {
        console.error('Failed to load dashboard data:', e);
      }
    };
    loadData();

    // Poll live telemetry every 2 seconds
    const timer = setInterval(async () => {
      try {
        const data = await api.getTelemetry();
        setTelemetry(data);
      } catch (e) {}
    }, 2000);

    return () => {
      unsub();
      clearInterval(timer);
    };
  }, []);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const [sysSpecs, logs, t] = await Promise.all([
        api.getSystemSpecs(),
        api.getActivityLogs(),
        api.getTelemetry(),
      ]);
      setSpecs(sysSpecs);
      setActivities(logs);
      setTelemetry(t);
    } catch (e) {}
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const slowStartupCount = startupItems
    ? startupItems.filter((item) => item.enabled && (item.impact === 'high' || (item.estimatedBootImpactMs ?? 0) >= 1000)).length
    : null;

  const totalBootDegradation = startupItems
    ? startupItems.filter((item) => item.enabled).reduce((sum, item) => sum + (item.estimatedBootImpactMs ?? 0), 0)
    : null;

  const primaryDrive = specs?.drives?.[0] || {
    label: 'Local Disk (C:)',
    totalBytes: 512 * 1024 * 1024 * 1024,
    usedBytes: 328 * 1024 * 1024 * 1024,
    freeBytes: 184 * 1024 * 1024 * 1024,
    usagePercent: 64,
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto overflow-y-auto">
      {/* Top Banner / Hero Card */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900/90 to-slate-950 border border-slate-800/80 p-6 shadow-xl shadow-black/40"
      >
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />
        <div className="absolute bottom-0 left-1/3 w-64 h-64 bg-teal-500/5 rounded-full blur-2xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="flex items-center gap-5">
            {/* Score Ring */}
            <div className="relative w-24 h-24 flex items-center justify-center rounded-2xl bg-slate-950/80 border border-emerald-500/30 shadow-inner shadow-emerald-950/50">
              <div className="text-center">
                <span className="text-3xl font-black tracking-tight text-white font-mono">84</span>
                <span className="block text-[10px] font-semibold text-emerald-400 uppercase tracking-wider">Health</span>
              </div>
              <div className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-emerald-500 rounded-full border-2 border-slate-900 animate-pulse" />
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-white tracking-tight">System Status: Good</h2>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Ready to optimize
                </span>
              </div>
              <p className="text-xs text-slate-400 max-w-lg leading-relaxed">
                {smartCleanReport ? (
                  <>
                    DeskKlean detected{' '}
                    <strong className="text-emerald-400 font-semibold">
                      {formatBytes(smartCleanReport.totalReclaimableBytes)}
                    </strong>{' '}
                    of cleanable junk files
                  </>
                ) : (
                  <>Smart Clean is ready to scan temporary files and system caches</>
                )}
                {slowStartupCount !== null && slowStartupCount > 0 ? (
                  <>
                    , and{' '}
                    <strong className="text-rose-400 font-semibold">
                      {slowStartupCount} startup items
                    </strong>{' '}
                    affecting boot time.
                  </>
                ) : (
                  '.'
                )}
              </p>
              <div className="flex items-center gap-4 pt-1 text-[11px] text-slate-400">
                <span className="flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> Real-time shield active
                </span>
                <span>•</span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-slate-400" /> Last scan: Today, 08:30 AM
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 w-full md:w-auto">
            <button
              onClick={() => onNavigate('health-check')}
              className="flex-1 md:flex-none flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-slate-950 font-bold text-xs shadow-lg shadow-emerald-950/40 transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              <HeartPulse className="w-4 h-4 text-slate-950" />
              1-Click Health Scan
            </button>
            <button
              onClick={() => onNavigate('smart-clean')}
              className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700/80 text-slate-200 font-semibold text-xs border border-slate-700 transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              <Sparkles className="w-4 h-4 text-emerald-400" />
              Quick Clean
            </button>
          </div>
        </div>
      </motion.div>

      {/* 4 Quick Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Junk Files */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          onClick={() => onNavigate('smart-clean')}
          className="p-4 rounded-xl bg-slate-900/70 border border-slate-800/80 hover:border-emerald-500/40 transition-all cursor-pointer group shadow-sm hover:shadow-emerald-950/30"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Junk Files</span>
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 group-hover:scale-110 transition-transform">
              <Trash2 className="w-4 h-4" />
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-2xl font-black text-white font-mono">
              {smartCleanReport ? formatBytes(smartCleanReport.totalReclaimableBytes) : 'Scan Ready'}
            </div>
            <p className="text-[11px] text-slate-400">
              {smartCleanReport ? 'Reclaimable from temp & caches' : 'Click to run real scan'}
            </p>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-800 flex items-center justify-between text-[11px] text-emerald-400 font-medium">
            <span>Clean now</span>
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
          </div>
        </motion.div>

        {/* Registry Issues */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          onClick={() => onNavigate('registry-fixer')}
          className="p-4 rounded-xl bg-slate-900/70 border border-slate-800/80 hover:border-amber-500/40 transition-all cursor-pointer group shadow-sm hover:shadow-amber-950/30"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Registry Issues</span>
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 group-hover:scale-110 transition-transform">
              <Layers className="w-4 h-4" />
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-2xl font-black text-white font-mono">38 Issues</div>
            <p className="text-[11px] text-slate-400">Broken shortcuts & obsolete keys</p>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-800 flex items-center justify-between text-[11px] text-amber-400 font-medium">
            <span>Fix registry</span>
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
          </div>
        </motion.div>

        {/* Startup Impact */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          onClick={() => onNavigate('startup-optimizer')}
          className="p-4 rounded-xl bg-slate-900/70 border border-slate-800/80 hover:border-rose-500/40 transition-all cursor-pointer group shadow-sm hover:shadow-rose-950/30"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Startup Apps</span>
            <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400 group-hover:scale-110 transition-transform">
              <Zap className="w-4 h-4" />
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-2xl font-black text-white font-mono">
              {slowStartupCount !== null ? `${slowStartupCount} High Impact` : 'Ready'}
            </div>
            <p className="text-[11px] text-slate-400">
              {totalBootDegradation !== null && totalBootDegradation > 0
                ? `Slows boot by ~${(totalBootDegradation / 1000).toFixed(1)} seconds`
                : 'Review startup impact'}
            </p>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-800 flex items-center justify-between text-[11px] text-rose-400 font-medium">
            <span>Speed up boot</span>
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
          </div>
        </motion.div>

        {/* Primary Storage */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          onClick={() => onNavigate('disk-analyzer')}
          className="p-4 rounded-xl bg-slate-900/70 border border-slate-800/80 hover:border-teal-500/40 transition-all cursor-pointer group shadow-sm hover:shadow-teal-950/30"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Drive (C:)</span>
            <div className="p-2 rounded-lg bg-teal-500/10 text-teal-400 group-hover:scale-110 transition-transform">
              <HardDrive className="w-4 h-4" />
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-2xl font-black text-white font-mono">184 GB Free</div>
            <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden mt-1">
              <div
                className="bg-gradient-to-r from-emerald-500 to-teal-400 h-full rounded-full"
                style={{ width: `${primaryDrive.usagePercent}%` }}
              />
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-800 flex items-center justify-between text-[11px] text-teal-400 font-medium">
            <span>Analyze drive space</span>
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
          </div>
        </motion.div>
      </div>

      {/* Hardware Telemetry Bar */}
      <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">Live System Telemetry</span>
          </div>
          <button
            onClick={handleRefresh}
            className="flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-slate-200 transition-colors"
          >
            <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* CPU Load */}
          <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/60">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
              <span>CPU Load</span>
              <span className="font-mono font-bold text-emerald-400">{telemetry.cpu}%</span>
            </div>
            <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
              <div
                className="bg-emerald-500 h-full transition-all duration-500"
                style={{ width: `${telemetry.cpu}%` }}
              />
            </div>
            <div className="mt-1 text-[10px] text-slate-500 truncate">
              {specs?.cpu?.brand || 'Intel Core i7-13700K'}
            </div>
          </div>

          {/* Memory Load */}
          <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/60">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
              <span>Memory Usage</span>
              <span className="font-mono font-bold text-teal-400">{telemetry.memory}%</span>
            </div>
            <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
              <div
                className="bg-teal-500 h-full transition-all duration-500"
                style={{ width: `${telemetry.memory}%` }}
              />
            </div>
            <div className="mt-1 text-[10px] text-slate-500 truncate">
              {formatBytes(specs?.memory?.usedBytes || 13743895347)} / {formatBytes(specs?.memory?.totalBytes || 34359738368)}
            </div>
          </div>

          {/* Disk I/O */}
          <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/60">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
              <span>Disk Read / Write</span>
              <span className="font-mono text-cyan-400 font-bold">{telemetry.diskRead} MB/s</span>
            </div>
            <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
              <div
                className="bg-cyan-500 h-full transition-all duration-500"
                style={{ width: `${Math.min(100, telemetry.diskRead * 2)}%` }}
              />
            </div>
            <div className="mt-1 text-[10px] text-slate-500 truncate">
              Write: {telemetry.diskWrite} MB/s
            </div>
          </div>

          {/* Network Link */}
          <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/60">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
              <span>Network Link</span>
              <span className="font-mono text-purple-400 font-bold">2.5 Gbps</span>
            </div>
            <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
              <div className="bg-purple-500 h-full" style={{ width: '100%' }} />
            </div>
            <div className="mt-1 text-[10px] text-slate-500 truncate">
              IP: {specs?.network?.ipAddress || '192.168.1.105'}
            </div>
          </div>
        </div>
      </div>

      {/* Two Column: Quick Actions + Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Quick Launch Cards */}
        <div className="lg:col-span-2 space-y-3">
          <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Quick Optimization Tools</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div
              onClick={() => onNavigate('smart-clean')}
              className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 hover:border-slate-700 hover:bg-slate-900/90 transition-all cursor-pointer flex items-start gap-3 group"
            >
              <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 group-hover:bg-emerald-500/20 transition-colors">
                <Sparkles className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-xs font-bold text-slate-200 group-hover:text-emerald-300 transition-colors">Smart Clean</h4>
                <p className="text-[11px] text-slate-400 leading-snug mt-0.5">Purge browser caches, Windows temp, and application artifacts.</p>
              </div>
            </div>

            <div
              onClick={() => onNavigate('registry-fixer')}
              className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 hover:border-slate-700 hover:bg-slate-900/90 transition-all cursor-pointer flex items-start gap-3 group"
            >
              <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 group-hover:bg-amber-500/20 transition-colors">
                <Layers className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-xs font-bold text-slate-200 group-hover:text-amber-300 transition-colors">Registry Fixer</h4>
                <p className="text-[11px] text-slate-400 leading-snug mt-0.5">Repair orphaned registry keys and invalid file associations safely.</p>
              </div>
            </div>

            <div
              onClick={() => onNavigate('duplicate-finder')}
              className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 hover:border-slate-700 hover:bg-slate-900/90 transition-all cursor-pointer flex items-start gap-3 group"
            >
              <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400 group-hover:bg-blue-500/20 transition-colors">
                <HardDrive className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-xs font-bold text-slate-200 group-hover:text-blue-300 transition-colors">Duplicate Finder</h4>
                <p className="text-[11px] text-slate-400 leading-snug mt-0.5">Find byte-exact duplicate downloads and photos to reclaim space.</p>
              </div>
            </div>

            <div
              onClick={() => onNavigate('secure-erase')}
              className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 hover:border-slate-700 hover:bg-slate-900/90 transition-all cursor-pointer flex items-start gap-3 group"
            >
              <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400 group-hover:bg-rose-500/20 transition-colors">
                <HardDrive className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-xs font-bold text-slate-200 group-hover:text-rose-300 transition-colors">Secure Shredder</h4>
                <p className="text-[11px] text-slate-400 leading-snug mt-0.5">Permanent unrecoverable data erasure with DoD 5220.22-M algorithms.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Activity Feed */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Recent Optimization Logs</h3>
          <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
            {activities.slice(0, 4).map((act) => (
              <div key={act.id} className="flex items-start gap-2.5 pb-2.5 border-b border-slate-800/60 last:border-0 last:pb-0">
                <div className="mt-0.5">
                  {act.type === 'success' ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  ) : act.type === 'warning' ? (
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-200 truncate">{act.title}</span>
                    {act.spaceFreedBytes && act.spaceFreedBytes > 0 && (
                      <span className="text-[10px] font-mono text-emerald-400 font-bold shrink-0">
                        +{formatBytes(act.spaceFreedBytes)}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-400 line-clamp-1">{act.detail}</p>
                  <span className="text-[9px] text-slate-400">{formatDate(act.timestamp)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
