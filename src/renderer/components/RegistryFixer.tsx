import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { api } from '../apiClient';
import { RegistryIssue, RegistryBackup } from '../../shared/types';
import {
  Layers,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Trash2,
  Database,
  Archive,
  RotateCcw,
  Clock,
} from 'lucide-react';

const SEVERITY_COLORS: Record<string, string> = {
  high: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
  medium: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  low: 'text-slate-400 bg-slate-500/10 border-slate-500/30',
};

export const RegistryFixer: React.FC = () => {
  const [issues, setIssues] = useState<RegistryIssue[]>([]);
  const [backups, setBackups] = useState<RegistryBackup[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isFixing, setIsFixing] = useState(false);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [fixResult, setFixResult] = useState<{ fixedCount: number; backupPath?: string } | null>(null);

  const runScan = async () => {
    setIsScanning(true);
    setFixResult(null);
    try {
      const result = await api.scanRegistry();
      setIssues(result);
      setLastScan(new Date().toISOString());
    } catch (e) {
      console.error('Registry scan failed:', e);
    }
    setIsScanning(false);
  };

  const handleFix = async () => {
    const selected = issues.filter((i) => i.selected);
    if (selected.length === 0) return;

    setIsFixing(true);
    try {
      const result = await api.fixRegistryIssues(
        selected.map((i) => i.id),
        true
      );
      setFixResult(result);
      await runScan();
    } catch (e) {
      console.error('Fix failed:', e);
    }
    setIsFixing(false);
  };

  const toggleIssue = (id: string) => {
    setIssues((prev) => prev.map((i) => (i.id === id ? { ...i, selected: !i.selected } : i)));
  };

  const selectAll = () => {
    setIssues((prev) => prev.map((i) => ({ ...i, selected: true })));
  };

  const loadBackups = async () => {
    try {
      const result = await api.getRegistryBackups();
      setBackups(result);
    } catch (e) {
      console.error('Failed to load backups:', e);
    }
  };

  const handleRestore = async (backupId: string) => {
    try {
      await api.restoreRegistryBackup(backupId);
      await runScan();
    } catch (e) {
      console.error('Restore failed:', e);
    }
  };

  useEffect(() => {
    runScan();
    loadBackups();
  }, []);

  const selectedCount = issues.filter((i) => i.selected).length;
  const criticalCount = issues.filter((i) => i.severity === 'high').length;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Registry Fixer</h1>
          <p className="text-sm text-slate-400 mt-1">
            Scan and repair invalid registry entries, broken shortcuts, and orphaned keys
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
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-slate-950 font-bold text-sm shadow-lg transition-all disabled:opacity-50"
          >
            {isFixing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            Fix {selectedCount} Issues
          </button>
        </div>
      </div>

      {/* Summary */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800/80 p-6"
      >
        <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl pointer-events-none -mr-12 -mt-12" />
        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="flex items-center gap-5">
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30">
              <Layers className="w-6 h-6 text-amber-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">
                {issues.length === 0 ? 'Registry is Clean!' : `${issues.length} Issues Found`}
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                {criticalCount > 0 && `${criticalCount} critical &middot; `}
                Last scan: {lastScan ? new Date(lastScan).toLocaleTimeString() : 'Never'}
              </p>
              {fixResult && (
                <p className="text-xs text-emerald-400 mt-1 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  Fixed {fixResult.fixedCount} issues
                  {fixResult.backupPath && ` &middot; Backup: ${fixResult.backupPath.split('\\').pop()}`}
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
      {isScanning && issues.length === 0 ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
        </div>
      ) : (
        <div className="space-y-2">
          {issues.map((issue, idx) => (
            <motion.div
              key={issue.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.02 }}
              onClick={() => toggleIssue(issue.id)}
              className={`p-4 rounded-xl border transition-all cursor-pointer ${
                issue.selected
                  ? 'bg-amber-500/5 border-amber-500/30'
                  : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-start gap-4">
                <input
                  type="checkbox"
                  checked={issue.selected}
                  onChange={() => toggleIssue(issue.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="mt-1 w-4 h-4 rounded border-slate-600 bg-slate-800 text-amber-500 focus:ring-amber-500/30"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-200">{issue.description}</h3>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${SEVERITY_COLORS[issue.severity]}`}>
                      {issue.severity}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1 font-mono truncate">
                    {issue.keyPath}
                  </p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Backups Section */}
      {backups.length > 0 && (
        <div className="pt-4">
          <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Archive className="w-4 h-4" /> Registry Backups
          </h3>
          <div className="space-y-2">
            {backups.slice(0, 5).map((backup) => (
              <div
                key={backup.id}
                className="flex items-center justify-between p-3 rounded-lg bg-slate-900/60 border border-slate-800"
              >
                <div className="flex items-center gap-3">
                  <Database className="w-4 h-4 text-slate-400" />
                  <div>
                    <p className="text-sm text-slate-200">{new Date(backup.timestamp).toLocaleString()}</p>
                    <p className="text-xs text-slate-500">{backup.issueCount} issues fixed</p>
                  </div>
                </div>
                <button
                  onClick={() => handleRestore(backup.id)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
                >
                  <RotateCcw className="w-3 h-3" /> Restore
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
