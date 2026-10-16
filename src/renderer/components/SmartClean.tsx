import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../apiClient';
import { SmartCleanReport, SmartCleanCategory, ExcludedCategory } from '../../shared/types';
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
} from 'lucide-react';

export const SmartClean: React.FC = () => {
  const [report, setReport] = useState<SmartCleanReport | null>(() => dataCache.getSmartCleanReport());
  const [isScanning, setIsScanning] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [optInWindowsOld, setOptInWindowsOld] = useState(false);
  const [optInSystemRestore, setOptInSystemRestore] = useState(false);
  const [categorySelections, setCategorySelections] = useState<Record<string, boolean>>({});

  const runScan = async () => {
    setIsScanning(true);
    try {
      const optIns: string[] = [];
      if (optInWindowsOld) optIns.push('windows-old');
      if (optInSystemRestore) optIns.push('system-restore');

      const selectedScanIds = optIns.length > 0
        ? [
            'user-temp', 'system-temp', 'delivery-optimization-cache', 'thumbnail-cache',
            'wer-report-queue', 'wer-report-archive', 'crash-dumps', 'minidump',
            'memory-dump', 'recycle-bin', 'panther-logs', 'system-logs',
            'directx-shader-cache', 'nvidia-shader-cache', 'recent-documents', 'jump-lists',
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
  const selectedCategories = report?.categories.filter(
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

  const totalFilesInReport = report?.categories.reduce((sum, c) => sum + (c.fileCount || 0), 0) ?? 0;
  const totalSkippedInReport = report?.categories.reduce((sum, c) => sum + c.inUseCount, 0) ?? 0;

  const isAllSelected = Boolean(
    report &&
    report.categories.length > 0 &&
    report.categories.every((cat) => categorySelections[cat.id] ?? (cat.defaultEnabled ?? true))
  );

  const isSomeSelected = Boolean(
    report &&
    report.categories.some((cat) => categorySelections[cat.id] ?? (cat.defaultEnabled ?? true))
  );

  const handleSelectAll = (select: boolean) => {
    if (!report) return;
    const next: Record<string, boolean> = {};
    for (const cat of report.categories) {
      next[cat.id] = select;
    }
    setCategorySelections(next);
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-white tracking-tight">Smart Clean</h1>
            <span className="px-2 py-0.5 text-xs font-semibold rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Phase 5 Read-Only
            </span>
          </div>
          <p className="text-sm text-slate-400 mt-1">
            Real measured scan of temporary files, error logs, and system junk. No deletions performed.
          </p>
        </div>
        <button
          onClick={runScan}
          disabled={isScanning}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium border border-slate-700/80 transition-all disabled:opacity-50 shadow-sm cursor-pointer"
        >
          {isScanning ? <Loader2 className="w-4 h-4 animate-spin text-emerald-400" /> : <RefreshCw className="w-4 h-4 text-emerald-400" />}
          {isScanning ? 'Scanning...' : 'Scan Again'}
        </button>
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
              <div className="text-sm font-medium text-slate-200">Previous Windows Installations (Windows.old)</div>
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
              <div className="text-sm font-medium text-slate-200">System Restore Points (via VSS)</div>
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
          <p className="text-sm text-slate-400">Walking filesystem categories and measuring real bytes...</p>
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
                              <div key={idx} className="flex items-center justify-between gap-2 text-slate-400">
                                <span className="truncate">{sf.path}</span>
                                <span className="text-amber-500/80 text-[10px] shrink-0">{sf.reason}</span>
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
                              <div key={idx} className="flex items-center justify-between gap-3 text-slate-400 hover:text-slate-200">
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
                        <span>Deletion semantics: {cat.deletionMethod === 'recycle-bin' ? 'Recycle Bin' : 'Permanent delete'}</span>
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
              <h3 className="text-sm font-semibold text-slate-200">Excluded System Locations</h3>
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
    </div>
  );
};
