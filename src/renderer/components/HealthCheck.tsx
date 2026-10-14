import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { api } from '../apiClient';
import { HealthCheckResult, HealthIssue } from '../../shared/types';
import { formatBytes } from '../utils/format';
import {
  HeartPulse,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  RefreshCw,
  ArrowRight,
  Clock,
  Loader2,
} from 'lucide-react';

export const HealthCheck: React.FC = () => {
  const [result, setResult] = useState<HealthCheckResult | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isFixing, setIsFixing] = useState(false);
  const [lastScan, setLastScan] = useState<string | null>(null);

  const runScan = async () => {
    setIsScanning(true);
    try {
      const scanResult = await api.runHealthCheckScan();
      setResult(scanResult);
      setLastScan(new Date().toISOString());
    } catch (e) {
      console.error('Health check scan failed:', e);
    }
    setIsScanning(false);
  };

  const handleFix = async () => {
    if (!result) return;
    const selectedIssues = result.issues.filter((i) => i.selected && i.fixable);
    if (selectedIssues.length === 0) return;

    setIsFixing(true);
    try {
      await api.fixHealthIssues(selectedIssues.map((i) => i.id));
      await runScan();
    } catch (e) {
      console.error('Fix failed:', e);
    }
    setIsFixing(false);
  };

  useEffect(() => {
    runScan();
  }, []);

  const toggleIssue = (id: string) => {
    if (!result) return;
    setResult({
      ...result,
      issues: result.issues.map((i) => (i.id === id ? { ...i, selected: !i.selected } : i)),
    });
  };

  const selectAll = () => {
    if (!result) return;
    setResult({ ...result, issues: result.issues.map((i) => ({ ...i, selected: true })) });
  };

  const totalIssues = result?.issues.length || 0;
  const fixableIssues = result?.issues.filter((i) => i.fixable).length || 0;
  const selectedCount = result?.issues.filter((i) => i.selected && i.fixable).length || 0;
  const totalReclaimable = result?.totalSpaceBytes || 0;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Health Check</h1>
          <p className="text-sm text-slate-400 mt-1">
            One-click scan for junk files, privacy traces, and system issues
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={selectAll}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium transition-colors"
          >
            Select All
          </button>
          <button
            onClick={handleFix}
            disabled={isFixing || selectedCount === 0}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-slate-950 font-bold text-sm shadow-lg shadow-emerald-950/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isFixing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            Fix {selectedCount} Issues
          </button>
        </div>
      </div>

      {/* Score Banner */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900/90 to-slate-950 border border-slate-800/80 p-6"
      >
        <div className="absolute top-0 right-0 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none -mr-16 -mt-16" />
        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="flex items-center gap-5">
            <div className="relative w-20 h-20 flex items-center justify-center rounded-2xl bg-slate-950/80 border border-emerald-500/30">
              <div className="text-center">
                <span className="text-2xl font-black text-white font-mono">{result?.score || 0}</span>
                <span className="block text-[10px] font-semibold text-emerald-400 uppercase">Score</span>
              </div>
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">
                {totalIssues === 0 ? 'System is Clean!' : `${totalIssues} Issues Found`}
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                {formatBytes(totalReclaimable)} reclaimable &middot; {fixableIssues} fixable issues
              </p>
              {lastScan && (
                <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Last scan: {new Date(lastScan).toLocaleTimeString()}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={runScan}
            disabled={isScanning}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-sm border border-slate-700 transition-all disabled:opacity-50"
          >
            {isScanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {isScanning ? 'Scanning...' : 'Re-Scan'}
          </button>
        </div>
      </motion.div>

      {/* Issues List */}
      {isScanning && !result ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
        </div>
      ) : result && result.issues.length > 0 ? (
        <div className="space-y-3">
          {result.issues.map((issue, idx) => (
            <motion.div
              key={issue.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.03 }}
              className={`p-4 rounded-xl border transition-all cursor-pointer ${
                issue.selected
                  ? 'bg-emerald-500/5 border-emerald-500/30'
                  : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
              }`}
              onClick={() => toggleIssue(issue.id)}
            >
              <div className="flex items-start gap-4">
                <div className="mt-0.5">
                  {issue.severity === 'critical' ? (
                    <AlertTriangle className="w-5 h-5 text-rose-400" />
                  ) : issue.severity === 'high' ? (
                    <AlertTriangle className="w-5 h-5 text-amber-400" />
                  ) : (
                    <ShieldCheck className="w-5 h-5 text-slate-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-200">{issue.title}</h3>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono text-slate-400">
                        {issue.count} items
                      </span>
                      {issue.spaceReclaimableBytes > 0 && (
                        <span className="text-xs font-mono text-emerald-400 font-bold">
                          {formatBytes(issue.spaceReclaimableBytes)}
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">{issue.description}</p>
                </div>
                <div className="mt-1">
                  {issue.selected ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  ) : (
                    <div className="w-5 h-5 rounded-full border-2 border-slate-600" />
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      ) : result && result.issues.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <CheckCircle2 className="w-16 h-16 text-emerald-500/40 mb-4" />
          <h3 className="text-lg font-semibold text-white">All Clear!</h3>
          <p className="text-sm text-slate-400 mt-1">No issues found. Your system is healthy.</p>
        </div>
      ) : null}
    </div>
  );
};
