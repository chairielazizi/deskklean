import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { api } from '../apiClient';
import {
  RegistryFixerIssue,
  RegistryBackup,
  RegistryScanResult,
  RegistryFixerResult,
  OperationPlan,
} from '../../shared/types';
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
  Info,
  FolderX,
  FileQuestion,
  Network,
  ShieldAlert,
  ShieldCheck,
  AlertCircle,
  X,
} from 'lucide-react';

export const RegistryFixer: React.FC = () => {
  const [issues, setIssues] = useState<RegistryFixerIssue[]>([]);
  const [indeterminateCount, setIndeterminateCount] = useState<number>(0);
  const [skippedNetworkCount, setSkippedNetworkCount] = useState<number>(0);
  const [backups, setBackups] = useState<RegistryBackup[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [fixResult, setFixResult] = useState<RegistryFixerResult | null>(null);

  // Phase 8 state: modal, planning, elevation
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isPlanning, setIsPlanning] = useState(false);
  const [isFixing, setIsFixing] = useState(false);
  const [plan, setPlan] = useState<OperationPlan | null>(null);
  const [isElevated, setIsElevated] = useState(false);

  const runScan = async () => {
    setIsScanning(true);
    setFixResult(null);
    try {
      const result: RegistryScanResult = await api.scanRegistry();
      setIssues(result.issues || []);
      setIndeterminateCount(result.indeterminateCount ?? 0);
      setSkippedNetworkCount(result.skippedNetworkCount ?? 0);
      setLastScan(result.scannedAt || new Date().toISOString());
    } catch (e) {
      console.error('Registry scan failed:', e);
    }
    setIsScanning(false);
  };

  const toggleIssue = (id: string) => {
    setIssues((prev) => prev.map((i) => (i.id === id ? { ...i, selected: !i.selected } : i)));
  };

  const selectAll = () => {
    const allSelected = issues.every((i) => i.selected);
    setIssues((prev) => prev.map((i) => ({ ...i, selected: !allSelected })));
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
      await loadBackups();
    } catch (e) {
      console.error('Restore failed:', e);
    }
  };

  useEffect(() => {
    runScan();
    loadBackups();
    api.isElevated().then(setIsElevated).catch(() => setIsElevated(false));
  }, []);

  const openConfirm = async () => {
    const selectedIds = issues.filter((i) => i.selected).map((i) => i.id);
    if (selectedIds.length === 0) return;

    setIsPlanning(true);
    try {
      const elevated = await api.isElevated().catch(() => false);
      setIsElevated(elevated);

      if (api.planRegistryFix) {
        const p = await api.planRegistryFix(selectedIds);
        setPlan(p);
      } else {
        const selectedIssues = issues.filter((i) => i.selected);
        setPlan({
          id: `plan-local-${Date.now()}`,
          module: 'registry-fixer',
          actions: selectedIssues.map((i) => ({
            id: i.id,
            kind: i.type === 'orphaned_uninstall' ? 'registry-key' : 'registry-value',
            target: `${i.hive}\\${i.keyPath}${i.valueName ? `\\${i.valueName}` : ''}`,
            description: `Delete ${i.displayName}`,
            reclaimableBytes: null,
          })),
          blocked: [],
          totalReclaimableBytes: null,
          reversibility: 'reversible',
          requiresElevation: selectedIssues.some((i) => i.hive === 'HKLM'),
          createdAt: new Date().toISOString(),
        });
      }
      setShowConfirmModal(true);
    } catch (e) {
      console.error('Failed to generate registry fix plan:', e);
    } finally {
      setIsPlanning(false);
    }
  };

  const handleExecuteFix = async () => {
    const selectedIds = issues.filter((i) => i.selected).map((i) => i.id);
    setIsFixing(true);
    try {
      const res = await api.fixRegistryIssues(selectedIds);
      setFixResult(res);
      setShowConfirmModal(false);
      await runScan();
      await loadBackups();
    } catch (e) {
      console.error('Failed to fix registry issues:', e);
      setFixResult({
        success: false,
        fixedCount: 0,
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setIsFixing(false);
    }
  };

  const handleRelaunch = async () => {
    try {
      await api.relaunchElevated();
    } catch (e) {
      console.error('Relaunch elevated failed:', e);
    }
  };

  const selectedCount = issues.filter((i) => i.selected).length;
  const elevationBlocked = Boolean(plan?.requiresElevation && !isElevated);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white">Registry Fixer</h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700">
              Housekeeping
            </span>
          </div>
          {/* Honesty Requirement: Must state that registry cleaning does not improve system speed */}
          <p className="text-xs font-semibold text-amber-400 mt-1 flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5 flex-shrink-0" />
            Registry cleaning does not improve system speed.
          </p>
          <p className="text-sm text-slate-400 mt-1">
            Safely identifies provably dead registry entries. An entry is flagged only when its target is proven gone.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={selectAll}
            disabled={issues.length === 0}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium transition-colors disabled:opacity-50"
          >
            {issues.length > 0 && issues.every((i) => i.selected) ? 'Deselect All' : 'Select All'}
          </button>
          {/* Honesty Requirement: Labeled 'Remove dead entries', enabled when at least 1 entry selected */}
          <button
            onClick={openConfirm}
            disabled={selectedCount === 0 || isFixing || isPlanning}
            title={
              selectedCount === 0
                ? 'Select at least one entry to remove.'
                : 'Remove selected dead entries with automatic .reg backup.'
            }
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold text-sm shadow-md transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            {isPlanning || isFixing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
            Remove dead entries ({selectedCount})
          </button>
        </div>
      </div>

      {/* Summary Banner */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800/80 p-6"
      >
        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="flex items-center gap-5">
            <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60">
              <Layers className="w-6 h-6 text-slate-300" />
            </div>
            <div>
              {/* Honesty Requirement: NO 'issues found' counter implying system is unhealthy */}
              <h2 className="text-lg font-bold text-white">
                {issues.length === 0
                  ? 'No dead entries detected'
                  : `${issues.length} dead ${issues.length === 1 ? 'entry' : 'entries'} detected`}
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                Last scan: {lastScan ? new Date(lastScan).toLocaleTimeString() : 'Never'} &middot; Provable subset only
              </p>
              {fixResult && (
                <div
                  className={`mt-2 p-2.5 rounded-lg border text-xs flex items-start gap-2 ${
                    fixResult.success
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                      : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                  }`}
                >
                  {fixResult.success ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                  )}
                  <div>
                    <span className="font-semibold">{fixResult.message}</span>
                    {fixResult.backupPath && (
                      <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                        Backup: {fixResult.backupPath}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
          <button
            onClick={runScan}
            disabled={isScanning}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-sm border border-slate-700 transition-all disabled:opacity-50 cursor-pointer"
          >
            {isScanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {isScanning ? 'Scanning...' : 'Re-Scan'}
          </button>
        </div>

        {/* Honesty Requirement: Surface indeterminateCount and skippedNetworkCount so incompleteness is visible */}
        <div className="mt-5 pt-4 border-t border-slate-800/80 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div className="flex items-start gap-2 text-slate-400 bg-slate-950/40 p-2.5 rounded-lg border border-slate-800/50">
            <FileQuestion className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-slate-300">Unchecked entries:</span>
                <span className="font-mono text-amber-400 font-bold">{indeterminateCount}</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Skipped because permission was denied (EACCES/EPERM) or I/O error occurred. Never guessed.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2 text-slate-400 bg-slate-950/40 p-2.5 rounded-lg border border-slate-800/50">
            <Network className="w-4 h-4 text-cyan-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-slate-300">Network paths skipped:</span>
                <span className="font-mono text-cyan-400 font-bold">{skippedNetworkCount}</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                UNC shares and mapped network drives are skipped. Reachability is not provability.
              </p>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Issues List */}
      {isScanning && issues.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
          <p className="text-sm text-slate-400">Verifying filesystem targets...</p>
        </div>
      ) : issues.length === 0 ? (
        <div className="p-8 text-center bg-slate-900/40 border border-slate-800/60 rounded-xl">
          <CheckCircle2 className="w-10 h-10 text-emerald-500/80 mx-auto mb-2" />
          <p className="text-sm font-semibold text-slate-200">No dead registry entries found</p>
          <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
            All scanned uninstall locations and shell MUI caches point to valid targets or are safely skipped.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {issues.map((issue, idx) => (
            <motion.div
              key={issue.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: Math.min(idx * 0.02, 0.3) }}
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
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-slate-200 truncate">
                      {issue.displayName}
                    </h3>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                        {issue.type === 'orphaned_uninstall' ? 'Orphaned Uninstall' : 'Stale MUICache'}
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border text-slate-400 bg-slate-500/10 border-slate-500/30">
                        low risk
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    {issue.description}
                  </p>
                  <p className="text-xs text-slate-500 mt-1 font-mono truncate">
                    {issue.hive}\{issue.keyPath}
                    {issue.valueName ? ` -> "${issue.valueName}"` : ''}
                  </p>

                  {/* Honesty Requirement: Show each issue's evidence (the checked path and that it is gone) */}
                  <div className="mt-2.5 p-2.5 rounded-lg bg-slate-950/70 border border-slate-800/80 text-xs font-mono space-y-1">
                    <div className="flex items-start gap-2">
                      <span className="text-slate-500 select-none flex-shrink-0">Checked Path:</span>
                      <span className="text-rose-300 break-all">{issue.evidence.checkedPath}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500 select-none flex-shrink-0">Proof:</span>
                      <span className="text-rose-400 font-semibold flex items-center gap-1.5">
                        <FolderX className="w-3.5 h-3.5 flex-shrink-0" />
                        Target is provably absent on disk ({issue.evidence.outcome})
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Backups Section (Phase 2 listing) */}
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
                    <p className="text-xs text-slate-500">{backup.issueCount} items saved &middot; {backup.filePath}</p>
                  </div>
                </div>
                <button
                  onClick={() => handleRestore(backup.id)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" /> Restore
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Confirmation Step (Phase 8 Rail) */}
      {showConfirmModal && plan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="p-6 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Trash2 className="w-5 h-5 text-amber-500" />
                  Confirm Removal of Dead Entries
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Please review the entries to be removed and the safety guarantees before confirming.
                </p>
              </div>
              <button
                onClick={() => setShowConfirmModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-4 text-sm flex-1">
              {/* Safety & Backup Guarantee */}
              <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300 space-y-1">
                <div className="flex items-center gap-2 font-bold text-emerald-400">
                  <ShieldCheck className="w-4 h-4 flex-shrink-0" />
                  Reversible Operation & Mandatory Backup
                </div>
                <p>
                  This operation is fully reversible. A valid Windows Registry (<code className="font-mono text-emerald-200">.reg</code>) backup
                  will be created and validated on disk before any entry is touched.
                </p>
                <p className="font-mono text-[11px] text-slate-400 pt-1">
                  Store: %APPDATA%\DeskKlean\backups\registry\
                </p>
              </div>

              {/* Elevation Notice if HKLM is targeted */}
              {elevationBlocked && (
                <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300 space-y-2">
                  <div className="flex items-center gap-2 font-bold text-rose-400">
                    <ShieldAlert className="w-4 h-4 flex-shrink-0" />
                    Administrator Rights Required
                  </div>
                  <p>
                    One or more selected entries are located under <code className="font-mono text-rose-200">HKEY_LOCAL_MACHINE</code>.
                    Windows requires elevated privileges to modify system-wide registry keys.
                  </p>
                  <button
                    onClick={handleRelaunch}
                    className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs transition-colors cursor-pointer"
                  >
                    Relaunch as Administrator
                  </button>
                </div>
              )}

              {/* Blocked Entries if any were refused by safety policy */}
              {plan.blocked.length > 0 && (
                <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300 space-y-2">
                  <div className="flex items-center gap-2 font-bold text-amber-400">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    Blocked by Safety Policy ({plan.blocked.length})
                  </div>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {plan.blocked.map((b, i) => (
                      <div key={i} className="p-2 rounded bg-slate-950/60 border border-slate-800">
                        <p className="font-mono text-slate-200 break-all">{b.target}</p>
                        <p className="text-[11px] text-amber-400/90 mt-0.5">{b.reason}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Planned Deletions List */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
                  <span>Planned Deletions ({plan.actions.length})</span>
                  <span className="text-slate-500 font-mono">reclaimableBytes: null</span>
                </div>
                <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                  {plan.actions.map((action) => (
                    <div
                      key={action.id}
                      className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800 flex items-start justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-slate-200 truncate">
                          {(action.metadata?.displayName as string) || action.id}
                        </div>
                        <div className="font-mono text-[11px] text-slate-400 break-all mt-0.5">
                          {action.target}
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300 border border-slate-700 flex-shrink-0">
                        {action.kind === 'registry-key' ? 'delete-key' : 'delete-value'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="p-4 border-t border-slate-800 flex items-center justify-end gap-3 bg-slate-950/40">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                disabled={isFixing}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteFix}
                disabled={isFixing || elevationBlocked || plan.actions.length === 0}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold shadow-md transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                {isFixing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                {isFixing
                  ? 'Removing...'
                  : elevationBlocked
                  ? 'Elevation Required'
                  : `Confirm and Remove (${plan.actions.length})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
