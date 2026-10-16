import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { api } from '../apiClient';
import { HealthReport, ModuleId, HealthMeasurement, HealthIssue } from '../../shared/types';
import { formatBytes, formatNumber, formatRelativeTime } from '../utils/format';
import { dataCache } from '../utils/dataCache';
import {
  HeartPulse,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ArrowRight,
  Clock,
  Loader2,
  HardDrive,
  Cloud,
  Rocket,
  Sparkles,
  PieChart,
  HelpCircle,
  Info,
} from 'lucide-react';

interface HealthCheckProps {
  onNavigate?: (module: ModuleId) => void;
}

const DEEP_LINK_TO_MODULE_ID: Record<string, ModuleId> = {
  SystemInfo: 'system-info',
  'system-info': 'system-info',
  'System Info': 'system-info',
  'Startup Optimizer': 'startup-optimizer',
  'startup-optimizer': 'startup-optimizer',
  StartupOptimizer: 'startup-optimizer',
  SmartClean: 'smart-clean',
  'smart-clean': 'smart-clean',
  'Smart Clean': 'smart-clean',
  DiskAnalyzer: 'disk-analyzer',
  'disk-analyzer': 'disk-analyzer',
  'Disk Analyzer': 'disk-analyzer',
};

function resolveModuleId(target: string): ModuleId {
  return DEEP_LINK_TO_MODULE_ID[target] || (target as ModuleId);
}

function getModuleIcon(moduleName: string) {
  const norm = moduleName.toLowerCase().replace(/[^a-z]/g, '');
  if (norm.includes('systeminfo') || norm.includes('disk')) return HardDrive;
  if (norm.includes('startup')) return Rocket;
  if (norm.includes('smartclean')) return Sparkles;
  if (norm.includes('diskanalyzer')) return PieChart;
  return HeartPulse;
}

function formatMeasurementValue(m: HealthMeasurement): string {
  if (m.unit === 'bytes') {
    return formatBytes(m.value);
  }
  if (m.unit === 'percent') {
    return `${m.value}%`;
  }
  return formatNumber(m.value);
}

interface DriveGroup {
  drive: string;
  totalBytes: number | null;
  freeBytes: number | null;
  freePercent: number | null;
  isCloud?: boolean;
}

function parseDriveMeasurements(measurements: HealthMeasurement[]): {
  drives: DriveGroup[];
  other: HealthMeasurement[];
} {
  const driveMap = new Map<string, DriveGroup>();
  const other: HealthMeasurement[] = [];

  for (const m of measurements) {
    const match = m.label.match(/\(([A-Za-z0-9_:\s\-·]+)\)$/);
    if (match) {
      const rawDrive = match[1].trim();
      const isCloud = rawDrive.toLowerCase().includes('google drive') || m.label.toLowerCase().includes('google drive');
      const cleanDrive = rawDrive.split('·')[0].split('-')[0].trim();
      const driveKey = cleanDrive.endsWith(':') ? cleanDrive : `${cleanDrive}:`;
      const displayName = isCloud ? `${driveKey} (Google Drive)` : driveKey;

      if (!driveMap.has(driveKey)) {
        driveMap.set(driveKey, {
          drive: displayName,
          totalBytes: null,
          freeBytes: null,
          freePercent: null,
          isCloud,
        });
      }
      const group = driveMap.get(driveKey)!;
      if (isCloud) group.isCloud = true;
      if (m.label.startsWith('Total disk space')) {
        group.totalBytes = typeof m.value === 'number' ? m.value : null;
      } else if (m.label.startsWith('Free disk space bytes')) {
        group.freeBytes = typeof m.value === 'number' ? m.value : null;
      } else if (m.label.startsWith('Free disk space')) {
        group.freePercent = typeof m.value === 'number' ? m.value : null;
      }
    } else {
      other.push(m);
    }
  }

  return {
    drives: Array.from(driveMap.values()),
    other,
  };
}

export const HealthCheck: React.FC<HealthCheckProps> = ({ onNavigate }) => {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCached, setIsCached] = useState(false);
  const [isStale, setIsStale] = useState(false);

  const runScan = async () => {
    setIsScanning(true);
    setError(null);
    try {
      const data = await api.getHealthReport();
      dataCache.setHealthReport(data);
      setReport(data);
      setIsCached(false);
      setIsStale(false);
    } catch (e: unknown) {
      console.error('Health check aggregation failed:', e);
      setError(e instanceof Error ? e.message : 'Failed to retrieve health report');
    } finally {
      setIsScanning(false);
    }
  };

  useEffect(() => {
    const cached = dataCache.getHealthReport();
    if (cached) {
      setReport(cached);
      setIsCached(true);
      setIsStale(dataCache.isHealthReportStale());
    } else {
      runScan();
    }
  }, []);

  useEffect(() => {
    if (!isCached) return;
    const interval = setInterval(() => {
      setIsStale(dataCache.isHealthReportStale());
    }, 15000);
    return () => clearInterval(interval);
  }, [isCached]);

  const allIssues: HealthIssue[] = report
    ? report.components.flatMap((c) => c.issues)
    : [];

  const getScoreColor = (score: number | null) => {
    if (score === null) return 'text-slate-400 border-slate-700 bg-slate-900/60';
    if (score >= 80) return 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10';
    if (score >= 60) return 'text-amber-400 border-amber-500/30 bg-amber-500/10';
    return 'text-rose-400 border-rose-500/30 bg-rose-500/10';
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <HeartPulse className="w-6 h-6 text-emerald-400" />
            Health Check
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Pure aggregator combining real measurements from System Info, Startup Optimizer, and other modules
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <button
            onClick={runScan}
            disabled={isScanning}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-sm border border-slate-700 transition-all disabled:opacity-50"
          >
            {isScanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {isScanning ? 'Aggregating...' : 'Re-Scan'}
          </button>
          {isCached && report && (
            <p className={`text-xs flex items-center gap-1.5 font-mono ${isStale ? 'text-amber-400' : 'text-slate-400'}`}>
              <Clock className="w-3.5 h-3.5" />
              <span>
                Last scanned {formatRelativeTime(report.generatedAt)}{isStale ? ' (stale)' : ''} &middot; Re-Scan for fresh numbers
              </span>
            </p>
          )}
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Score Banner */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900/90 to-slate-950 border border-slate-800/80 p-6"
      >
        <div className="absolute top-0 right-0 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none -mr-16 -mt-16" />
        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="flex items-center gap-5">
            <div
              className={`relative w-24 h-24 flex items-center justify-center rounded-2xl border ${getScoreColor(
                report?.score ?? null
              )}`}
            >
              <div className="text-center px-1">
                {report && report.score !== null ? (
                  <>
                    <span className="text-3xl font-black font-mono leading-none">{report.score}</span>
                    <span className="block text-[10px] font-semibold uppercase tracking-wider mt-1 opacity-80">
                      Score
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-xs font-bold leading-tight block">Not yet</span>
                    <span className="text-xs font-bold leading-tight block">measured</span>
                  </>
                )}
              </div>
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">
                {report === null
                  ? 'Scanning system...'
                  : report.score === null
                  ? 'Health Score Not Yet Measured'
                  : allIssues.length === 0
                  ? 'System Measurements Optimal'
                  : `${allIssues.length} Potential ${allIssues.length === 1 ? 'Issue' : 'Issues'} Detected`}
              </h2>
              <p className="text-sm text-slate-400 mt-1 max-w-xl">
                {report?.score === null
                  ? 'No constituent modules have reported disk pressure or active measurements yet.'
                  : 'Score is derived from real disk pressure measurements. Health Check has no scan or fix logic of its own; resolving issues is handled by the respective modules.'}
              </p>
              {report?.generatedAt && (
                <p className="text-xs text-slate-500 mt-2 flex items-center gap-1.5 font-mono">
                  <Clock className="w-3.5 h-3.5" /> Generated at:{' '}
                  {new Date(report.generatedAt).toLocaleTimeString()}
                  {isCached ? ' (cached)' : ''}
                </p>
              )}
            </div>
          </div>
        </div>
      </motion.div>

      {/* Derived Issues */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">Derived Issues</h2>
          <span className="text-xs font-mono text-slate-400">
            {allIssues.length} {allIssues.length === 1 ? 'issue' : 'issues'}
          </span>
        </div>

        {isScanning && !report ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
          </div>
        ) : allIssues.length > 0 ? (
          <div className="space-y-3">
            {allIssues.map((issue, idx) => (
              <motion.div
                key={`${issue.module}-${issue.measurementRef}-${idx}`}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.04 }}
                className="p-4 rounded-xl border bg-slate-900/60 border-slate-800 hover:border-slate-700 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="flex items-start gap-3.5">
                  <div className="mt-0.5">
                    {issue.severity === 'critical' ? (
                      <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
                    ) : issue.severity === 'warning' ? (
                      <AlertCircle className="w-5 h-5 text-amber-400 shrink-0" />
                    ) : (
                      <Info className="w-5 h-5 text-sky-400 shrink-0" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold text-slate-200">{issue.description}</h3>
                      <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                        {issue.module}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      Triggered by measurement:{' '}
                      <span className="text-slate-300 font-mono font-medium">{issue.measurementRef}</span>
                    </p>
                  </div>
                </div>

                {onNavigate && (
                  <button
                    onClick={() => onNavigate(resolveModuleId(issue.deepLink))}
                    className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-400 hover:text-emerald-300 font-medium text-xs border border-slate-700 hover:border-slate-600 transition-all shrink-0 self-start md:self-auto"
                  >
                    <span>Manage in {issue.deepLink}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </motion.div>
            ))}
          </div>
        ) : report ? (
          <div className="p-6 rounded-xl border border-slate-800 bg-slate-900/40 text-center">
            <CheckCircle2 className="w-10 h-10 text-emerald-400/60 mx-auto mb-2" />
            <h3 className="text-sm font-semibold text-white">No Issues Detected</h3>
            <p className="text-xs text-slate-400 mt-1">
              All measured components are operating within normal thresholds.
            </p>
          </div>
        ) : null}
      </div>

      {/* Constituent Measurements */}
      {report && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-white">Constituent Components</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Direct measurements returned by constituent modules without modification
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {report.components.map((comp) => {
              const Icon = getModuleIcon(comp.module);
              return (
                <div
                  key={comp.module}
                  className="rounded-xl border border-slate-800 bg-slate-900/50 p-5 space-y-4 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-lg bg-slate-800 text-slate-300">
                          <Icon className="w-4 h-4" />
                        </div>
                        <h3 className="text-sm font-bold text-white">{comp.module}</h3>
                      </div>
                      <span
                        className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded border ${
                          comp.status === 'ok'
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                            : comp.status === 'partial'
                            ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                            : comp.status === 'failed'
                            ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                            : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}
                      >
                        {comp.status === 'ok'
                          ? 'Measured'
                          : comp.status === 'partial'
                          ? 'Partial'
                          : comp.status === 'failed'
                          ? 'Failed'
                          : 'Not Built'}
                      </span>
                    </div>

                    {comp.measurements.length > 0 ? (
                      (() => {
                        const { drives, other } = parseDriveMeasurements(comp.measurements);
                        if (drives.length > 0) {
                          return (
                            <div className="mt-4 space-y-2.5">
                              {drives.map((d) => {
                                const usedPercent =
                                  d.freePercent !== null
                                    ? Math.max(0, Math.min(100, Math.round(100 - d.freePercent)))
                                    : null;
                                return (
                                  <div
                                    key={d.drive}
                                    className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80 space-y-2"
                                  >
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2">
                                        {d.isCloud ? (
                                          <Cloud className="w-3.5 h-3.5 text-sky-400" />
                                        ) : (
                                          <HardDrive className="w-3.5 h-3.5 text-cyan-400" />
                                        )}
                                        <span className="text-xs font-bold text-white tracking-wide">
                                          Drive {d.drive}
                                        </span>
                                        {d.isCloud && (
                                          <span className="text-[10px] bg-sky-500/15 text-sky-400 border border-sky-500/30 px-1.5 py-0.5 rounded font-medium">
                                            Cloud
                                          </span>
                                        )}
                                      </div>
                                      {d.freePercent !== null && (
                                        <span
                                          className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded border ${
                                            d.freePercent < 15
                                              ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                                              : d.freePercent < 25
                                              ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                                              : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                          }`}
                                        >
                                          {d.freePercent}% free
                                        </span>
                                      )}
                                    </div>

                                    {usedPercent !== null && (
                                      <div className="w-full bg-slate-800/80 h-1.5 rounded-full overflow-hidden">
                                        <div
                                          className={`h-full rounded-full transition-all duration-300 ${
                                            d.isCloud
                                              ? 'bg-sky-400'
                                              : usedPercent > 90
                                              ? 'bg-rose-500'
                                              : usedPercent > 75
                                              ? 'bg-amber-500'
                                              : 'bg-cyan-500'
                                          }`}
                                          style={{ width: `${usedPercent}%` }}
                                        />
                                      </div>
                                    )}

                                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                                      <span>
                                        Total:{' '}
                                        <span className="font-mono text-slate-200 font-medium">
                                          {d.totalBytes !== null ? formatBytes(d.totalBytes) : '—'}
                                        </span>
                                      </span>
                                      <span>
                                        Free:{' '}
                                        <span className="font-mono text-slate-200 font-medium">
                                          {d.freeBytes !== null ? formatBytes(d.freeBytes) : '—'}
                                        </span>
                                      </span>
                                    </div>
                                  </div>
                                );
                              })}

                              {other.map((m, mIdx) => (
                                <div
                                  key={mIdx}
                                  className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-slate-950/40 text-xs border border-slate-800/60"
                                >
                                  <span className="text-slate-300">{m.label}</span>
                                  <span className="font-mono font-semibold text-white">
                                    {formatMeasurementValue(m)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          );
                        }

                        return (
                          <div className="mt-4 space-y-2">
                            {comp.measurements.map((m, mIdx) => (
                              <div
                                key={mIdx}
                                className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-slate-950/40 text-xs border border-slate-800/60"
                              >
                                <span className="text-slate-300">{m.label}</span>
                                <span className="font-mono font-semibold text-white">
                                  {formatMeasurementValue(m)}
                                </span>
                              </div>
                            ))}
                          </div>
                        );
                      })()
                    ) : (
                      <div className="mt-4 py-4 text-center">
                        <p className="text-xs text-slate-500 italic">
                          {comp.status === 'not_built'
                            ? 'Module not yet built in this phase (marked as not measured)'
                            : comp.status === 'failed'
                            ? 'Component scan failed — no measurements available'
                            : 'No measurements returned'}
                        </p>
                      </div>
                    )}
                  </div>

                  {onNavigate && comp.status !== 'not_built' && (
                    <button
                      onClick={() => onNavigate(resolveModuleId(comp.module))}
                      className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium border border-slate-700/60 transition-colors"
                    >
                      <span>Open {comp.module}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Unmeasured Modules List */}
      {report && report.unmeasured && report.unmeasured.length > 0 && (
        <div className="rounded-xl border border-slate-800/80 bg-slate-900/30 p-5 space-y-2">
          <div className="flex items-center gap-2 text-slate-300 text-xs font-semibold uppercase tracking-wider">
            <HelpCircle className="w-4 h-4 text-slate-500" />
            <span>Unmeasured Modules ({report.unmeasured.length})</span>
          </div>
          <p className="text-xs text-slate-400">
            The following constituent modules are planned for future phases and have not yet been built:{' '}
            <span className="text-slate-200 font-mono font-medium">
              {report.unmeasured.join(', ')}
            </span>
            . Health Check does not invent placeholder data or assume clean states for unmeasured modules.
          </p>
        </div>
      )}
    </div>
  );
};
