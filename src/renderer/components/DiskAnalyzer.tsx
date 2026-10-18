import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../apiClient';
import {
  DiskAnalysisResult,
  DiskFolderNode,
  LargeFileInfo,
  SkippedPath,
  ScanProgressEvent,
} from '../../shared/types';
import { formatBytes } from '../utils/format';
import {
  PieChart,
  Loader2,
  HardDrive,
  Folder,
  File,
  ChevronRight,
  ArrowLeft,
  Search,
  FolderOpen,
  AlertTriangle,
  AlertCircle,
  XCircle,
  ShieldAlert,
} from 'lucide-react';

export const DiskAnalyzer: React.FC = () => {
  const [analysis, setAnalysis] = useState<DiskAnalysisResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [currentDrive, setCurrentDrive] = useState<string>('C:\\');
  const [progress, setProgress] = useState<ScanProgressEvent | null>(null);
  const [view, setView] = useState<'overview' | 'large-files' | 'skipped'>('overview');
  const [activeFolder, setActiveFolder] = useState<DiskFolderNode | null>(null);
  const [folderHistory, setFolderHistory] = useState<DiskFolderNode[]>([]);

  useEffect(() => {
    // Subscribe to scan progress events
    const unsubscribe = api.onDiskScanProgress?.((event: ScanProgressEvent) => {
      setProgress(event);
    });

    // Run initial analysis
    runAnalysis('C:\\');

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const runAnalysis = async (drivePath: string) => {
    setIsLoading(true);
    setProgress(null);
    try {
      const result = await api.analyzeDisk(drivePath);
      setAnalysis(result);
      setCurrentDrive(drivePath);
      setActiveFolder(result.folderTree);
      setFolderHistory([]);
    } catch (e) {
      console.error('Disk analysis failed:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const cancelAnalysis = async () => {
    try {
      await api.cancelDiskAnalysis?.();
    } catch (e) {
      console.error('Cancel analysis failed:', e);
    }
  };

  const navigateToFolder = (folder: DiskFolderNode) => {
    if (activeFolder) {
      setFolderHistory((prev) => [...prev, activeFolder]);
    }
    setActiveFolder(folder);
  };

  const navigateUp = () => {
    if (folderHistory.length === 0) return;
    const previous = folderHistory[folderHistory.length - 1];
    setFolderHistory((prev) => prev.slice(0, -1));
    setActiveFolder(previous);
  };

  const getReasonBadge = (reason: SkippedPath['reason']) => {
    switch (reason) {
      case 'permission-denied':
        return (
          <span className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20">
            Permission Denied
          </span>
        );
      case 'reparse-point-escape':
        return (
          <span className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
            Reparse Point (Escape)
          </span>
        );
      case 'reparse-point-skipped':
        return (
          <span className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
            Reparse Point (In-Root)
          </span>
        );
      case 'not-found':
        return (
          <span className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-slate-500/10 text-slate-400 border border-slate-500/20">
            Not Found
          </span>
        );
      case 'stat-error':
      default:
        return (
          <span className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">
            Stat Error
          </span>
        );
    }
  };

  const permissionDeniedCount =
    analysis?.skippedPaths.filter((p) => p.reason === 'permission-denied').length ?? 0;

  // Drive metrics calculation
  const driveTotal = analysis?.driveTotalBytes ?? null;
  const driveFree = analysis?.driveFreeBytes ?? null;
  const driveUsed =
    driveTotal !== null && driveFree !== null
      ? Math.max(0, driveTotal - driveFree)
      : null;
  const unscannedBytes =
    driveUsed !== null && analysis
      ? Math.max(0, driveUsed - analysis.scannedBytes)
      : null;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Disk Analyzer</h1>
          <p className="text-sm text-slate-400 mt-1">
            Read-only disk walk measuring actual file sizes and folder distribution
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isLoading ? (
            <button
              onClick={cancelAnalysis}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 text-sm font-medium border border-rose-500/30 transition-all"
            >
              <XCircle className="w-4 h-4" />
              Cancel Scan
            </button>
          ) : (
            <button
              onClick={() => runAnalysis(currentDrive)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium border border-slate-700 transition-all"
            >
              <HardDrive className="w-4 h-4" />
              Analyze
            </button>
          )}
        </div>
      </div>

      {/* Progress banner during scan (NO percentage per honesty rule) */}
      <AnimatePresence>
        {isLoading && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="rounded-xl border border-cyan-500/30 bg-cyan-950/30 p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Loader2 className="w-5 h-5 text-cyan-400 animate-spin shrink-0" />
                <div>
                  <h3 className="text-sm font-semibold text-cyan-200">
                    Scanning {currentDrive}...
                  </h3>
                  <p className="text-xs text-slate-400 truncate max-w-2xl font-mono mt-0.5">
                    {progress?.currentPath || 'Initializing scan...'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs font-mono">
                <span className="text-slate-300">
                  Files: <strong className="text-white">{progress?.filesScanned?.toLocaleString() || 0}</strong>
                </span>
                <span className="text-slate-300">
                  Folders: <strong className="text-white">{progress?.directoriesScanned?.toLocaleString() || 0}</strong>
                </span>
                <span className="text-slate-300">
                  Measured: <strong className="text-cyan-300">{formatBytes(progress?.bytesCounted || 0)}</strong>
                </span>
              </div>
            </div>
            {/* Indeterminate pulsing bar */}
            <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-cyan-500 via-blue-500 to-cyan-500 rounded-full animate-pulse" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Incomplete / Partial Results Banner */}
      {analysis && !analysis.complete && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200"
        >
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-sm">
            <h4 className="font-semibold text-amber-300">Scan incomplete — showing partial results</h4>
            <p className="text-xs text-amber-200/80 mt-0.5">
              The walk was interrupted or cancelled. Displaying measured metrics for{' '}
              {analysis.fileCount.toLocaleString()} files across{' '}
              {analysis.directoryCount.toLocaleString()} directories found before stopping.
            </p>
          </div>
        </motion.div>
      )}

      {/* Skipped paths notice banner */}
      {analysis && analysis.skippedPaths.length > 0 && (
        <div className="flex items-center justify-between p-3 rounded-lg bg-slate-900 border border-slate-800 text-xs">
          <div className="flex items-center gap-2 text-slate-300">
            <AlertCircle className="w-4 h-4 text-slate-400 shrink-0" />
            <span>
              {permissionDeniedCount > 0
                ? `${permissionDeniedCount} directories or files could not be read (permission denied). `
                : ''}
              Total skipped paths: {analysis.skippedPaths.length}.
            </span>
          </div>
          <button
            onClick={() => setView('skipped')}
            className="text-cyan-400 hover:text-cyan-300 font-medium underline transition-colors"
          >
            View skipped paths
          </button>
        </div>
      )}

      {/* Drive Overview (Honesty Rule: reports both scannedBytes and drive capacity) */}
      {analysis && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800/80 p-6"
        >
          <div className="absolute top-0 right-0 w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none -mr-12 -mt-12" />
          <div className="relative z-10 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <HardDrive className="w-5 h-5 text-cyan-400" />
                Drive {analysis.rootPath}
              </h2>
              <div className="flex flex-wrap items-center gap-5 text-sm">
                <div>
                  <span className="text-slate-400 text-xs block">Scanned Files</span>
                  <span className="text-white font-bold font-mono">
                    {formatBytes(analysis.scannedBytes)}{' '}
                    <span className="text-xs text-slate-400 font-normal">
                      ({analysis.fileCount.toLocaleString()} files)
                    </span>
                  </span>
                </div>
                {driveUsed !== null && driveTotal !== null && (
                  <div>
                    <span className="text-slate-400 text-xs block">Drive Used (CIM)</span>
                    <span className="text-cyan-300 font-bold font-mono">
                      {formatBytes(driveUsed)}{' '}
                      <span className="text-xs text-slate-400 font-normal">
                        of {formatBytes(driveTotal)}
                      </span>
                    </span>
                  </div>
                )}
                {driveFree !== null && (
                  <div>
                    <span className="text-slate-400 text-xs block">Drive Free</span>
                    <span className="text-emerald-400 font-bold font-mono">
                      {formatBytes(driveFree)}
                    </span>
                  </div>
                )}
                {unscannedBytes !== null && unscannedBytes > 0 && (
                  <div>
                    <span className="text-slate-400 text-xs block">Unscanned / Inaccessible</span>
                    <span className="text-amber-400 font-bold font-mono">
                      {formatBytes(unscannedBytes)}
                    </span>
                  </div>
                )}
                {driveTotal === null && (
                  <div>
                    <span className="text-slate-400 text-xs block">Drive Capacity</span>
                    <span className="text-slate-400 italic text-xs">Not measured (CIM unavailable)</span>
                  </div>
                )}
              </div>
            </div>

            {/* Usage Bar */}
            {driveTotal !== null && driveUsed !== null && driveFree !== null ? (
              <div>
                <div className="w-full bg-slate-800 h-3 rounded-full overflow-hidden flex">
                  {/* Scanned portion */}
                  <div
                    className="bg-cyan-500 h-full transition-all duration-500"
                    style={{
                      width: `${Math.min(100, (analysis.scannedBytes / driveTotal) * 100)}%`,
                    }}
                    title={`Scanned: ${formatBytes(analysis.scannedBytes)}`}
                  />
                  {/* Unscanned used space */}
                  {unscannedBytes !== null && unscannedBytes > 0 && (
                    <div
                      className="bg-amber-600/70 h-full transition-all duration-500"
                      style={{
                        width: `${Math.min(100, (unscannedBytes / driveTotal) * 100)}%`,
                      }}
                      title={`Unscanned / Inaccessible: ${formatBytes(unscannedBytes)}`}
                    />
                  )}
                  {/* Free space remains dark */}
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-400 mt-2">
                  <div className="flex items-center gap-4">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-cyan-500 inline-block" />
                      Scanned ({formatBytes(analysis.scannedBytes)})
                    </span>
                    {unscannedBytes !== null && unscannedBytes > 0 && (
                      <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-600/70 inline-block" />
                        Unscanned ({formatBytes(unscannedBytes)})
                      </span>
                    )}
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-slate-700 inline-block" />
                      Free ({formatBytes(driveFree)})
                    </span>
                  </div>
                  <span>
                    Measured in {(analysis.scanDurationMs / 1000).toFixed(2)}s
                  </span>
                </div>
              </div>
            ) : (
              <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                <div className="bg-cyan-500 h-full w-full" />
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* View Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
        <button
          onClick={() => setView('overview')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            view === 'overview'
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
              : 'bg-slate-800 text-slate-400 hover:text-slate-200'
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setView('large-files')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            view === 'large-files'
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
              : 'bg-slate-800 text-slate-400 hover:text-slate-200'
          }`}
        >
          Large Files {analysis ? `(${analysis.largeFiles.length})` : ''}
        </button>
        <button
          onClick={() => setView('skipped')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            view === 'skipped'
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
              : 'bg-slate-800 text-slate-400 hover:text-slate-200'
          }`}
        >
          Skipped Paths {analysis ? `(${analysis.skippedPaths.length})` : ''}
        </button>
      </div>

      {analysis && (
        <>
          {view === 'overview' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* File Type Breakdown */}
              <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-4">
                <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                  <PieChart className="w-4 h-4 text-cyan-400" />
                  File Type Breakdown
                </h3>
                <div className="space-y-3">
                  {analysis.breakdown.map((ft) => (
                    <div key={ft.type} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: ft.color }}
                          />
                          <span className="text-slate-300 font-medium truncate">
                            {ft.label}
                          </span>
                          <span className="text-[11px] text-slate-500">
                            ({ft.count.toLocaleString()} files)
                          </span>
                        </div>
                        <span className="text-slate-300 font-mono shrink-0 ml-2">
                          {formatBytes(ft.totalBytes)}{' '}
                          <span className="text-slate-500 text-[11px]">({ft.percentage}%)</span>
                        </span>
                      </div>
                      <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${Math.min(100, ft.percentage)}%`,
                            backgroundColor: ft.color,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Folder Tree Explorer */}
              <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                    <FolderOpen className="w-4 h-4 text-cyan-400" />
                    Folder Explorer
                  </h3>
                  {folderHistory.length > 0 && (
                    <button
                      onClick={navigateUp}
                      className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      Back
                    </button>
                  )}
                </div>

                {/* Current directory breadcrumb */}
                <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80 text-xs text-slate-300 font-mono truncate">
                  {activeFolder?.path || analysis.rootPath}
                </div>

                {/* Subfolder list */}
                <div className="space-y-1 max-h-96 overflow-y-auto">
                  {activeFolder?.children && activeFolder.children.length > 0 ? (
                    activeFolder.children.map((folder) => (
                      <button
                        key={folder.path}
                        onClick={() => navigateToFolder(folder)}
                        className="w-full flex items-center justify-between p-2.5 rounded-lg hover:bg-slate-800/60 transition-colors group text-left"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Folder className="w-4 h-4 text-cyan-400/70 shrink-0" />
                          <span className="text-sm text-slate-300 truncate group-hover:text-white">
                            {folder.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-xs font-mono text-slate-300 font-medium">
                            {formatBytes(folder.sizeBytes)}
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono">
                            {folder.percentage}%
                          </span>
                          <span className="text-[10px] text-slate-500">
                            {folder.fileCount.toLocaleString()} files
                          </span>
                          <ChevronRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-400" />
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="py-8 text-center text-xs text-slate-500">
                      No further subdirectories in this folder
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {view === 'large-files' && (
            <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                  <Search className="w-4 h-4 text-cyan-400" />
                  Top {analysis.largeFiles.length} Largest Files
                </h3>
                <span className="text-xs text-slate-500">Sorted by size descending</span>
              </div>
              <div className="space-y-1 divide-y divide-slate-800/40">
                {analysis.largeFiles.map((file, idx) => (
                  <div
                    key={file.id}
                    className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-800/50 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-xs text-slate-500 font-mono w-6 text-right shrink-0">
                        #{idx + 1}
                      </span>
                      <File className="w-4 h-4 text-slate-400 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm text-slate-200 truncate font-medium">{file.name}</p>
                        <p className="text-xs text-slate-500 truncate font-mono">{file.path}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-5 shrink-0 text-xs">
                      {file.extension && (
                        <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-mono text-[11px]">
                          .{file.extension}
                        </span>
                      )}
                      <span className="font-mono text-cyan-400 font-bold">
                        {formatBytes(file.sizeBytes)}
                      </span>
                      <span className="text-slate-500 text-[11px] hidden sm:inline">
                        {new Date(file.lastModified).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {view === 'skipped' && (
            <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-amber-400" />
                  Skipped & Inaccessible Paths ({analysis.skippedPaths.length})
                </h3>
                <span className="text-xs text-slate-500">
                  Honest reporting of unstat-able paths & reparse points
                </span>
              </div>
              {analysis.skippedPaths.length > 0 ? (
                <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
                  {analysis.skippedPaths.map((item, idx) => (
                    <div
                      key={`${item.path}-${idx}`}
                      className="flex items-center justify-between p-2.5 rounded-lg bg-slate-950/40 border border-slate-800/60 hover:bg-slate-800/40 transition-colors"
                    >
                      <span className="text-xs font-mono text-slate-300 truncate max-w-2xl">
                        {item.path}
                      </span>
                      <div className="shrink-0 ml-3">{getReasonBadge(item.reason)}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-12 text-center text-xs text-slate-500">
                  No paths were skipped during this scan.
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};
