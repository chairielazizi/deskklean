import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../apiClient';
import {
  SmartCleanReport,
  SmartCleanCategory,
  ExcludedCategory,
  ExecuteResult,
} from '../../shared/types';
import { formatBytes } from '../utils/format';
import { dataCache } from '../utils/dataCache';
import {
  Sparkles,
  RefreshCw,
  Loader2,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  AlertTriangle,
  Info,
  ExternalLink,
  Lock,
  Ban,
  Clock,
  FileText,
  CheckCircle2,
  AlertCircle,
  CheckSquare,
  Square,
  Trash2,
} from 'lucide-react';

export const SmartClean: React.FC = () => {
  const [report, setReport] = useState<SmartCleanReport | null>(() =>
    dataCache.getSmartCleanReport()
  );
  const [isScanning, setIsScanning] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showResultModal, setShowResultModal] = useState(false);
  const [executeResult, setExecuteResult] = useState<ExecuteResult | null>(null);
  const [isAppElevated, setIsAppElevated] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [optInWindowsOld, setOptInWindowsOld] = useState(false);
  const [optInSystemRestore, setOptInSystemRestore] = useState(false);
  const [categorySelections, setCategorySelections] = useState<Record<string, boolean>>({});

  useEffect(() => {
    api
      .isElevated()
      .then(setIsAppElevated)
      .catch(() => setIsAppElevated(false));
  }, []);

  const runScan = async () => {
    setIsScanning(true);
    try {
      const optIns: string[] = [];
      if (optInWindowsOld) optIns.push('windows-old');
      if (optInSystemRestore) optIns.push('system-restore');

      const selectedScanIds =
        optIns.length > 0
          ? [
              'user-temp',
              'system-temp',
              'delivery-optimization-cache',
              'thumbnail-cache',
              'wer-report-queue',
              'wer-report-archive',
              'crash-dumps',
              'minidump',
              'memory-dump',
              'recycle-bin',
              'panther-logs',
              'system-logs',
              'directx-shader-cache',
              'nvidia-shader-cache',
              'recent-documents',
              'jump-lists',
              ...optIns,
            ]
          : undefined;

      const res = await api.scanSmartClean(selectedScanIds);
      setReport(res);
      dataCache.setSmartCleanReport(res);

      // Initialize or preserve category selections
      setCategorySelections((prev) => {
        const next = { ...prev };
        for (const cat of res.categories) {
          if (next[cat.id] === undefined) {
            next[cat.id] = cat.defaultEnabled ?? true;
          }
        }
        return next;
      });
    } catch (e) {
      console.error('Smart clean scan failed:', e);
    } finally {
      setIsScanning(false);
    }
  };

  useEffect(() => {
    if (!report || optInWindowsOld || optInSystemRestore) {
      runScan();
    }
  }, [optInWindowsOld, optInSystemRestore]);

  const toggleCategoryExpand = (id: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleCategorySelection = (id: string) => {
    setCategorySelections((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  // Dynamic calculations reflecting actual user selection in real-time
  const selectedCategories =
    report?.categories.filter(
      (cat) => categorySelections[cat.id] ?? (cat.defaultEnabled ?? true)
    ) ?? [];

  const selectedReclaimableBytes = selectedCategories.reduce(
    (sum, cat) => sum + (cat.reclaimableBytes || 0),
    0
  );

  const selectedFilesCount = selectedCategories.reduce(
    (sum, cat) => sum + (cat.fileCount || 0),
    0
  );

  const totalFilesInReport =
    report?.categories.reduce((sum, c) => sum + (c.fileCount || 0), 0) ?? 0;
  const totalSkippedInReport =
    report?.categories.reduce((sum, c) => sum + c.inUseCount, 0) ?? 0;

  const isAllSelected = Boolean(
    report &&
      report.categories.length > 0 &&
      report.categories.every(
        (cat) => categorySelections[cat.id] ?? (cat.defaultEnabled ?? true)
      )
  );

  const isSomeSelected = Boolean(
    report &&
      report.categories.some(
        (cat) => categorySelections[cat.id] ?? (cat.defaultEnabled ?? true)
      )
  );

  const handleSelectAll = (select: boolean) => {
    if (!report) return;
    const next: Record<string, boolean> = {};
    for (const cat of report.categories) {
      next[cat.id] = select;
    }
    setCategorySelections(next);
  };

  const selectedRequireElevation = selectedCategories.some((cat) => cat.adminRequired);
  const elevationBlocked = selectedRequireElevation && !isAppElevated;
  const hasPermanentDeletion = selectedCategories.some(
    (cat) => cat.deletionMethod === 'permanent'
  );

  const handleExecute = async () => {
    if (selectedCategories.length === 0 || elevationBlocked) return;
    setIsExecuting(true);
    try {
      const selectedIds = selectedCategories.map((c) => c.id);
      const res = await api.executeSmartClean(selectedIds);
      setExecuteResult(res);
      setShowConfirmModal(false);
      setShowResultModal(true);
    } catch (err) {
      console.error('Smart Clean execute failed:', err);
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-white tracking-tight">Smart Clean</h1>
            <span className="px-2 py-0.5 text-xs font-semibold rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Phase 6 Ready
            </span>
          </div>
          <p className="text-sm text-slate-400 mt-1">
            Real measured scan and execution of temporary files, error logs, and system junk through the safe framework.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={runScan}
            disabled={isScanning || isExecuting}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium border border-slate-700/80 transition-all disabled:opacity-50 shadow-sm cursor-pointer"
          >
            {isScanning ? (
              <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
            ) : (
              <RefreshCw className="w-4 h-4 text-emerald-400" />
            )}
            {isScanning ? 'Scanning...' : 'Scan Again'}
          </button>

          <button
            onClick={() => setShowConfirmModal(true)}
            disabled={isScanning || isExecuting || selectedCategories.length === 0}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold shadow-md shadow-emerald-950/30 border border-emerald-500/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            {isExecuting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
            {isExecuting
              ? 'Cleaning...'
              : `Clean Selected (${formatBytes(selectedReclaimableBytes)})`}
          </button>
        </div>
      </div>

      {/* Summary Banner */}
      {report && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 p-6"
        >
          <div className="absolute top-0 right-0 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none -mr-16 -mt-16" />
          <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-400">
                <Sparkles className="w-4 h-4" />
                Real Measured Space
              </div>
              <h2 className="text-2xl font-black text-white">
                {formatBytes(selectedReclaimableBytes)} Reclaimable
              </h2>
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 pt-1">
                <span>{selectedFilesCount.toLocaleString()} files selected</span>
                <span>&bull;</span>
                <span>
                  {selectedCategories.length} of {report.categories.length} categories selected
                </span>
                <span>&bull;</span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-slate-500" />
                  {report.scanDurationMs} ms elapsed
                </span>
                {totalSkippedInReport > 0 && (
                  <>
                    <span>&bull;</span>
                    <span className="text-amber-400 font-medium">
                      {totalSkippedInReport} locked/in-use files skipped
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="px-3.5 py-2 rounded-xl bg-slate-800/80 border border-slate-700/60 text-xs text-slate-300 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Protected paths enforced</span>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Opt-In Categories Banner */}
      <div className="rounded-xl bg-slate-900/50 border border-amber-500/20 p-4 space-y-3">
        <div className="flex items-center gap-2 text-amber-400 text-sm font-semibold">
          <AlertTriangle className="w-4 h-4" />
          <span>Conditional System Areas (Opt-In Required)</span>
        </div>
        <p className="text-xs text-slate-400">
          These items reclaim significant storage but carry consequences. They are excluded from default passes.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
          {/* Windows.old toggle */}
          <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="text-sm font-medium text-slate-200">
                Previous Windows Installations (Windows.old)
              </div>
              <p className="text-xs text-slate-400">
                Permanent loss of rollback to previous Windows version. Windows automatically removes it after 10 days.
              </p>
            </div>
            <input
              type="checkbox"
              checked={optInWindowsOld}
              onChange={(e) => setOptInWindowsOld(e.target.checked)}
              className="mt-1 w-4 h-4 rounded border-slate-600 bg-slate-800 text-amber-500 focus:ring-amber-500/30 cursor-pointer"
            />
          </div>

          {/* System Restore toggle */}
          <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="text-sm font-medium text-slate-200">
                System Restore Points (via VSS)
              </div>
              <p className="text-xs text-slate-400">
                Permanent loss of all restore points — inability to roll back system changes.
              </p>
            </div>
            <input
              type="checkbox"
              checked={optInSystemRestore}
              onChange={(e) => setOptInSystemRestore(e.target.checked)}
              className="mt-1 w-4 h-4 rounded border-slate-600 bg-slate-800 text-amber-500 focus:ring-amber-500/30 cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* Category Results */}
      {isScanning && !report ? (
        <div className="flex flex-col items-center justify-center py-20 space-y-3">
          <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
          <p className="text-sm text-slate-400">
            Walking filesystem categories and measuring real bytes...
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Category List Header with Select / Unselect All Controls */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-1 py-1">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  ref={(input) => {
                    if (input) {
                      input.indeterminate = !isAllSelected && isSomeSelected;
                    }
                  }}
                  onChange={(e) => handleSelectAll(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-emerald-500 focus:ring-emerald-500/30 cursor-pointer"
                />
                <span className="text-sm font-semibold text-slate-200">
                  {isAllSelected ? 'Deselect All' : 'Select All'}
                </span>
              </label>
              <span className="text-xs text-slate-600">•</span>
              <span className="text-xs text-slate-400">
                {selectedCategories.length} of {report?.categories.length ?? 0} categories selected
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleSelectAll(true)}
                disabled={isAllSelected}
                className="px-3 py-1 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                Select All
              </button>
              <button
                type="button"
                onClick={() => handleSelectAll(false)}
                disabled={!isSomeSelected}
                className="px-3 py-1 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                Unselect All
              </button>
            </div>
          </div>

          <div className="space-y-2.5">
            {report?.categories.map((cat) => {
              const isExpanded = expandedCategories.has(cat.id);
              const isSelected = categorySelections[cat.id] ?? true;

              return (
                <div
                  key={cat.id}
                  className="rounded-xl bg-slate-900/70 border border-slate-800/80 overflow-hidden transition-all"
                >
                  <div className="p-4 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleCategorySelection(cat.id)}
                        className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-emerald-500 focus:ring-emerald-500/30"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="text-sm font-semibold text-slate-100">{cat.name}</h4>
                          <span
                            className={`px-2 py-0.5 text-[10px] font-bold rounded uppercase tracking-wider ${
                              cat.verdict === 'SAFE'
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            }`}
                          >
                            {cat.verdict}
                          </span>
                          <span
                            className={`px-2 py-0.5 text-[10px] font-medium rounded ${
                              cat.deletionMethod === 'recycle-bin'
                                ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                                : 'bg-slate-800 text-slate-300 border border-slate-700'
                            }`}
                          >
                            {cat.deletionMethod === 'recycle-bin' ? 'Recycle Bin' : 'Permanent'}
                          </span>
                          {cat.adminRequired && (
                            <span className="px-2 py-0.5 text-[10px] font-medium rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                              Admin
                            </span>
                          )}
                          {cat.status === 'partial' && (
                            <span className="px-2 py-0.5 text-[10px] font-medium rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                              Partial ({cat.inUseCount} locked)
                            </span>
                          )}
                          {cat.status === 'failed' && (
                            <span className="px-2 py-0.5 text-[10px] font-medium rounded bg-rose-500/10 text-rose-400 border border-rose-500/20">
                              Unreadable
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 font-mono truncate mt-0.5">{cat.path}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 shrink-0">
                      <div className="text-right">
                        {cat.reclaimableBytes !== null ? (
                          <div className="font-mono text-sm font-bold text-emerald-400">
                            {formatBytes(cat.reclaimableBytes)}
                          </div>
                        ) : (
                          <div className="text-xs text-slate-500 italic">Unmeasured</div>
                        )}
                        <div className="text-xs text-slate-400">
                          {cat.fileCount !== null ? `${cat.fileCount} files` : 'No files'}
                        </div>
                      </div>

                      <button
                        onClick={() => toggleCategoryExpand(cat.id)}
                        className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
                        title="View details and file paths"
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {isExpanded && (
                    <div className="px-4 pb-4 pt-2 border-t border-slate-800/80 bg-slate-950/40 space-y-3">
                      {/* Reason if failed */}
                      {cat.failureReason && (
                        <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                          <span>{cat.failureReason}</span>
                        </div>
                      )}

                      {/* Consequence if conditional */}
                      {cat.consequence && (
                        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 flex items-start gap-2">
                          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                          <span>{cat.consequence}</span>
                        </div>
                      )}

                      {/* Skipped / In-Use files */}
                      {cat.skippedFiles && cat.skippedFiles.length > 0 && (
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-400">
                            <Lock className="w-3.5 h-3.5" />
                            <span>Skipped Files in Use ({cat.skippedFiles.length})</span>
                          </div>
                          <div className="max-h-36 overflow-y-auto space-y-1 rounded-lg bg-slate-900 p-2.5 border border-slate-800 font-mono text-[11px]">
                            {cat.skippedFiles.map((sf, idx) => (
                              <div
                                key={idx}
                                className="flex items-center justify-between gap-2 text-slate-400"
                              >
                                <span className="truncate">{sf.path}</span>
                                <span className="text-amber-500/80 text-[10px] shrink-0">
                                  {sf.reason}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Enumerated files preview */}
                      {cat.files && cat.files.length > 0 && (
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs text-slate-400">
                            <span className="font-semibold text-slate-300">
                              Measured Files ({cat.files.length})
                            </span>
                            <span className="text-[11px] font-mono">
                              Showing up to 25 items
                            </span>
                          </div>
                          <div className="max-h-48 overflow-y-auto space-y-1 rounded-lg bg-slate-900 p-2.5 border border-slate-800 font-mono text-[11px]">
                            {cat.files.slice(0, 25).map((f, idx) => (
                              <div
                                key={idx}
                                className="flex items-center justify-between gap-3 text-slate-400 hover:text-slate-200"
                              >
                                <span className="truncate">{f.path}</span>
                                <span className="font-mono text-emerald-400/90 text-right shrink-0">
                                  {formatBytes(f.sizeBytes)}
                                </span>
                              </div>
                            ))}
                            {cat.files.length > 25 && (
                              <div className="text-center py-1 text-slate-500 text-[10px] italic">
                                ... and {cat.files.length - 25} more files
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Source Citation */}
                      <div className="pt-1 flex items-center justify-between text-[11px] text-slate-500">
                        <span>
                          Deletion semantics:{' '}
                          {cat.deletionMethod === 'recycle-bin'
                            ? 'Move to Recycle Bin'
                            : 'Permanent delete'}
                        </span>
                        <a
                          href={cat.source}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 text-emerald-400/80 hover:text-emerald-300 hover:underline"
                        >
                          Official Microsoft Documentation
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Excluded Locations Section */}
      {report?.excluded && report.excluded.length > 0 && (
        <div className="space-y-3 pt-4 border-t border-slate-800/80">
          <div>
            <div className="flex items-center gap-2">
              <Ban className="w-4 h-4 text-rose-400" />
              <h3 className="text-sm font-semibold text-slate-200">
                Excluded System Locations
              </h3>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              These locations were evaluated and deliberately excluded from scanning and cleaning to protect system integrity.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {report.excluded.map((item, idx) => (
              <div
                key={idx}
                className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-slate-200">{item.name}</span>
                  <span
                    className={`px-2 py-0.5 text-[10px] font-bold rounded uppercase tracking-wider ${
                      item.verdict === 'RISKY'
                        ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                        : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                    }`}
                  >
                    {item.verdict}
                  </span>
                </div>
                <div className="text-xs font-mono text-slate-400">{item.path}</div>
                <p className="text-xs text-slate-400 leading-relaxed">{item.reason}</p>
                {item.source && (
                  <div className="pt-1">
                    <a
                      href={item.source}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300"
                    >
                      Documentation source
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="relative w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-5 max-h-[90vh] flex flex-col">
            <div className="space-y-1">
              <h3 className="text-xl font-bold text-white tracking-tight">
                Confirm System Cleanup
              </h3>
              <p className="text-xs text-slate-400">
                Review the {selectedCategories.length} selected categories (
                {formatBytes(selectedReclaimableBytes)}) and their deletion semantics before executing.
              </p>
            </div>

            {/* Reversibility Banner */}
            {hasPermanentDeletion ? (
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1 text-xs">
                  <div className="font-semibold text-amber-300">Irreversible Operation</div>
                  <p className="text-amber-200/80 leading-relaxed">
                    Categories marked for permanent deletion cannot be restored from the Recycle Bin. Windows will regenerate necessary system caches and temporary files automatically.
                  </p>
                </div>
              </div>
            ) : (
              <div className="p-3.5 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-start gap-3">
                <Info className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
                <div className="space-y-1 text-xs">
                  <div className="font-semibold text-blue-300">Reversible Operation</div>
                  <p className="text-blue-200/80 leading-relaxed">
                    All selected categories will be moved to the Recycle Bin and can be restored if needed.
                  </p>
                </div>
              </div>
            )}

            {/* Elevation Guard Banner */}
            {elevationBlocked && (
              <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs space-y-2.5">
                <div className="flex items-center gap-2 font-semibold text-rose-400">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Administrator Privileges Required</span>
                </div>
                <p className="text-rose-300/90 leading-relaxed">
                  One or more selected categories require administrator rights to clean. DeskKlean refuses to half-complete an unelevated cleanup pass.
                </p>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await api.relaunchElevated();
                    } catch (err) {
                      console.error('Relaunch failed:', err);
                    }
                  }}
                  className="px-3.5 py-1.5 rounded-lg bg-rose-500 hover:bg-rose-600 text-white font-semibold transition-colors cursor-pointer inline-flex items-center gap-1.5 shadow-sm"
                >
                  <Lock className="w-3.5 h-3.5" />
                  Relaunch DeskKlean as Administrator
                </button>
              </div>
            )}

            {/* Category Breakdown in Dialog */}
            <div className="overflow-y-auto space-y-2 flex-1 pr-1 max-h-64">
              {selectedCategories.map((cat) => (
                <div
                  key={cat.id}
                  className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-slate-200">{cat.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-emerald-400">
                        {formatBytes(cat.reclaimableBytes || 0)}
                      </span>
                      <span
                        className={`px-2 py-0.5 text-[11px] font-semibold rounded ${
                          cat.deletionMethod === 'recycle-bin'
                            ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                            : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                        }`}
                      >
                        {cat.deletionMethod === 'recycle-bin'
                          ? 'Move to Recycle Bin'
                          : 'Delete Permanently'}
                      </span>
                      {cat.adminRequired && (
                        <span className="px-2 py-0.5 text-[10px] font-medium rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                          Admin
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Explicit consequence for Windows.old */}
                  {cat.id === 'windows-old' && (
                    <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>
                        <strong>Consequence:</strong> Permanent loss of rollback to previous Windows version. Windows automatically removes it after 10 days.
                      </span>
                    </div>
                  )}

                  {/* Explicit consequence for System Restore */}
                  {cat.id === 'system-restore' && (
                    <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>
                        <strong>Consequence:</strong> Permanent loss of all restore points via VSS — inability to roll back system changes.
                      </span>
                    </div>
                  )}

                  {/* General consequence if set */}
                  {cat.consequence &&
                    cat.id !== 'windows-old' &&
                    cat.id !== 'system-restore' && (
                      <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>
                          <strong>Consequence:</strong> {cat.consequence}
                        </span>
                      </div>
                    )}
                </div>
              ))}
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                disabled={isExecuting}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium transition-colors cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleExecute}
                disabled={isExecuting || elevationBlocked}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold shadow-md transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                {isExecuting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
                {isExecuting
                  ? 'Cleaning...'
                  : elevationBlocked
                  ? 'Elevation Required'
                  : 'Confirm and Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Result Modal */}
      {showResultModal && executeResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="relative w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              {executeResult.success ? (
                <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
              ) : (
                <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
                  <AlertCircle className="w-6 h-6" />
                </div>
              )}
              <div>
                <h3 className="text-lg font-bold text-white">
                  {executeResult.success
                    ? 'Smart Clean Completed'
                    : 'Smart Clean Finished (Partial)'}
                </h3>
                <p className="text-xs text-slate-400">
                  {executeResult.message ||
                    (executeResult.success
                      ? 'All selected categories cleaned successfully.'
                      : 'Some items were skipped or failed.')}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-center">
              <div>
                <div className="text-xs text-slate-500">Completed</div>
                <div className="text-lg font-bold text-emerald-400">
                  {executeResult.completed}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Skipped (in use)</div>
                <div className="text-lg font-bold text-amber-400">
                  {executeResult.skipped}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Failed</div>
                <div className="text-lg font-bold text-rose-400">
                  {executeResult.failed}
                </div>
              </div>
            </div>

            {executeResult.reclaimableBytes !== null &&
              executeResult.reclaimableBytes > 0 && (
                <div className="text-center p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-sm font-semibold">
                  {formatBytes(executeResult.reclaimableBytes)} Freed
                </div>
              )}

            {executeResult.failures && executeResult.failures.length > 0 && (
              <div className="space-y-1.5 max-h-36 overflow-y-auto">
                <div className="text-xs font-semibold text-rose-400">
                  Errors encountered:
                </div>
                {executeResult.failures.map((f, i) => (
                  <div
                    key={i}
                    className="text-[11px] p-2 rounded bg-rose-500/10 border border-rose-500/20 text-rose-300 font-mono"
                  >
                    <div className="truncate font-semibold">{f.target}</div>
                    <div>{f.error}</div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowResultModal(false);
                  runScan();
                }}
                className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-sm font-semibold transition-colors cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
