import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../apiClient';
import {
  DuplicateGroup,
  DuplicateFile,
  DuplicateScanConfig,
  DuplicateScanResult,
} from '../../shared/types';
import { formatBytes } from '../utils/format';
import {
  Copy,
  Loader2,
  Search,
  Trash2,
  Folder,
  File,
  Settings,
  ShieldCheck,
  Clock,
  X,
  AlertTriangle,
  CheckCircle,
} from 'lucide-react';

interface ModalGroupSelection {
  group: DuplicateGroup;
  keepCopy: DuplicateFile;
  filesToDelete: DuplicateFile[];
}

export const DuplicateFinder: React.FC = () => {
  const [scanResult, setScanResult] = useState<DuplicateScanResult | null>(null);
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [scanConfig, setScanConfig] = useState<DuplicateScanConfig>({
    directories: ['C:\\Users\\Downloads', 'C:\\Users\\Documents', 'C:\\Users\\Pictures'],
    matchBy: 'hash',
    fileTypes: ['*'],
    minSizeBytes: 1024 * 1024, // 1 MB (D-DF-4)
  });
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Confirmation modal state (Phase 11 Rail)
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [modalGroups, setModalGroups] = useState<ModalGroupSelection[]>([]);
  const [notification, setNotification] = useState<{
    type: 'success' | 'warning' | 'error';
    message: string;
  } | null>(null);

  const runScan = async () => {
    setIsScanning(true);
    setNotification(null);
    try {
      const result = await api.scanDuplicates(scanConfig);
      setScanResult(result);
      setGroups(result.groups);
    } catch (e) {
      console.error('Duplicate scan failed:', e);
      setNotification({
        type: 'error',
        message: `Duplicate scan failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
    setIsScanning(false);
  };

  const openConfirmModal = (targetGroup?: DuplicateGroup) => {
    if (targetGroup) {
      const keep = targetGroup.files.find((f) => f.isOriginal) || targetGroup.files[0];
      const filesToDelete = targetGroup.files.filter((f) => f.selectedForDeletion && !f.isOriginal);
      if (filesToDelete.length === 0) return;
      setModalGroups([{ group: targetGroup, keepCopy: keep, filesToDelete }]);
    } else {
      const selections: ModalGroupSelection[] = [];
      for (const group of groups) {
        const keep = group.files.find((f) => f.isOriginal) || group.files[0];
        const filesToDelete = group.files.filter((f) => f.selectedForDeletion && !f.isOriginal);
        if (filesToDelete.length > 0) {
          selections.push({ group, keepCopy: keep, filesToDelete });
        }
      }
      if (selections.length === 0) return;
      setModalGroups(selections);
    }
    setShowConfirmModal(true);
  };

  const handleConfirmDelete = async () => {
    const allFilesToDelete = modalGroups.flatMap((mg) => mg.filesToDelete);
    if (allFilesToDelete.length === 0) return;

    setIsDeleting(true);
    try {
      const targetIds = new Set(allFilesToDelete.map((f) => f.id));
      const result = await api.deleteDuplicateFiles(allFilesToDelete.map((f) => f.id));

      if (result.completed > 0) {
        const failedTargets = new Set((result.failures || []).map((f) => f.target.toLowerCase()));
        setGroups((prev) =>
          prev
            .map((g) => {
              const remainingFiles = g.files.filter((f) => {
                if (targetIds.has(f.id) && !failedTargets.has(f.path.toLowerCase())) {
                  return false;
                }
                return true;
              });
              return {
                ...g,
                files: remainingFiles,
                wastedBytes: Math.max(0, (remainingFiles.length - 1) * g.sizeBytes),
              };
            })
            .filter((g) => g.files.length > 1)
        );

        if (result.success) {
          setNotification({
            type: 'success',
            message: `Successfully moved ${result.completed} duplicate file${result.completed === 1 ? '' : 's'} to the Recycle Bin.`,
          });
        } else {
          setNotification({
            type: 'warning',
            message: `Partially completed: ${result.completed} files moved to Recycle Bin, ${result.failed} failed.`,
          });
        }
      } else {
        setNotification({
          type: 'error',
          message: `Deletion failed: ${result.failures?.[0]?.error || result.message || 'Unknown error'}`,
        });
      }
      setShowConfirmModal(false);
    } catch (e) {
      console.error('Delete failed:', e);
      setNotification({
        type: 'error',
        message: `Deletion failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
    setIsDeleting(false);
  };

  const toggleFile = (groupHash: string, fileId: string) => {
    setGroups((prev) =>
      prev.map((g) => {
        if (g.hash !== groupHash) return g;

        const targetFile = g.files.find((f) => f.id === fileId);
        // D-DF-7: Keep-copy is unselectable and cannot be marked for deletion
        if (!targetFile || targetFile.isOriginal) return g;

        const willSelect = !targetFile.selectedForDeletion;
        const currentSelectedCount = g.files.filter((f) => f.selectedForDeletion).length;

        // D-DF-7: A group cannot have all copies selected for deletion
        if (willSelect && currentSelectedCount + 1 >= g.files.length) {
          return g;
        }

        return {
          ...g,
          files: g.files.map((f) =>
            f.id === fileId ? { ...f, selectedForDeletion: willSelect } : f
          ),
        };
      })
    );
  };

  const toggleGroup = (hash: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) next.delete(hash);
      else next.add(hash);
      return next;
    });
  };

  const selectAllDuplicates = (groupHash: string) => {
    // D-DF-7: Select all duplicate copies while preserving the keep-copy unselected
    setGroups((prev) =>
      prev.map((g) =>
        g.hash === groupHash
          ? {
              ...g,
              files: g.files.map((f) =>
                f.isOriginal
                  ? { ...f, selectedForDeletion: false }
                  : { ...f, selectedForDeletion: true }
              ),
            }
          : g
      )
    );
  };

  const totalWasted = groups.reduce((sum, g) => sum + g.wastedBytes, 0);

  const totalSelectedFiles = groups.reduce(
    (sum, g) => sum + g.files.filter((f) => f.selectedForDeletion && !f.isOriginal).length,
    0
  );

  const totalSelectedBytes = groups.reduce(
    (sum, g) =>
      sum +
      g.files
        .filter((f) => f.selectedForDeletion && !f.isOriginal)
        .reduce((s, f) => s + f.sizeBytes, 0),
    0
  );

  const modalTotalFiles = modalGroups.reduce((sum, mg) => sum + mg.filesToDelete.length, 0);
  const modalTotalBytes = modalGroups.reduce(
    (sum, mg) => sum + mg.filesToDelete.reduce((s, f) => s + f.sizeBytes, 0),
    0
  );

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Duplicate Finder</h1>
          <p className="text-sm text-slate-400 mt-1">
            Find and review exact content duplicate files (SHA-256 verified)
          </p>
        </div>
        <div className="flex items-center gap-3">
          {totalSelectedFiles > 0 && (
            <button
              onClick={() => openConfirmModal()}
              disabled={isDeleting || totalSelectedFiles === 0}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 font-bold text-sm border border-rose-500/40 shadow-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-4 h-4 text-rose-400" />
              Delete {totalSelectedFiles} Selected ({formatBytes(totalSelectedBytes)})
            </button>
          )}
          <button
            onClick={runScan}
            disabled={isScanning}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white font-bold text-sm shadow-lg transition-all disabled:opacity-50"
          >
            {isScanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {isScanning ? 'Scanning...' : 'Scan for Duplicates'}
          </button>
        </div>
      </div>

      {/* Notification Banner */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className={`p-4 rounded-xl flex items-center justify-between border ${
              notification.type === 'success'
                ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                : notification.type === 'warning'
                ? 'bg-amber-950/40 border-amber-500/40 text-amber-200'
                : 'bg-rose-950/40 border-rose-500/40 text-rose-200'
            }`}
          >
            <div className="flex items-center gap-3 text-sm">
              {notification.type === 'success' && <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0" />}
              {notification.type === 'warning' && <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0" />}
              {notification.type === 'error' && <AlertTriangle className="w-5 h-5 text-rose-400 flex-shrink-0" />}
              <span>{notification.message}</span>
            </div>
            <button
              onClick={() => setNotification(null)}
              className="p-1 rounded-lg hover:bg-slate-800/50 text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Config & Metrics Summary */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800/80 p-6"
      >
        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl pointer-events-none -mr-12 -mt-12" />
        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="flex items-center gap-5">
            <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/30">
              <Copy className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">
                {groups.length === 0 ? 'No duplicates found' : `${groups.length} Duplicate Groups`}
              </h2>
              {/* Wasted bytes is explicitly labelled as a scan measurement */}
              <p className="text-sm text-slate-400 mt-1">
                Wasted space (scan measurement):{' '}
                <span className="font-semibold text-slate-200">{formatBytes(totalWasted)}</span>
              </p>
            </div>
          </div>
          <div className="flex flex-col md:flex-row items-start md:items-center gap-4 text-xs text-slate-400">
            <span className="flex items-center gap-1">
              <Folder className="w-3 h-3" /> {scanConfig.directories.length} directories
            </span>
            <span className="flex items-center gap-1">
              <Settings className="w-3 h-3" /> Min: {formatBytes(scanConfig.minSizeBytes)}
            </span>
            {scanResult && (
              <>
                <span className="flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3 text-emerald-400" /> {scanResult.scannedFileCount} indexed (
                  {scanResult.belowMinSizeCount} &lt; 1MB, {scanResult.skippedCount} skipped)
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3 text-slate-400" /> {scanResult.scanDurationMs}ms
                </span>
              </>
            )}
          </div>
        </div>
      </motion.div>

      {/* Groups List */}
      {isScanning ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group, idx) => {
            const isExpanded = expandedGroups.has(group.hash);
            const selectedCount = group.files.filter((f) => f.selectedForDeletion && !f.isOriginal).length;
            const hasValidSelection = selectedCount > 0 && selectedCount < group.files.length;

            return (
              <motion.div
                key={group.hash}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: idx * 0.03 }}
                className="rounded-xl bg-slate-900/60 border border-slate-800 overflow-hidden"
              >
                <div
                  className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-800/40 transition-colors"
                  onClick={() => toggleGroup(group.hash)}
                >
                  <div className="flex items-center gap-4">
                    <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400">
                      <Copy className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-slate-200">{group.fileName}</h3>
                      <p className="text-xs text-slate-500">
                        {group.files.length} copies &middot; {formatBytes(group.sizeBytes)} each &middot;{' '}
                        {formatBytes(group.wastedBytes)} wasted (scan measurement)
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {/* Delete button opens confirmation modal, disabled when no valid selection exists (D-DF-7) */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (hasValidSelection) {
                          openConfirmModal(group);
                        }
                      }}
                      disabled={isDeleting || !hasValidSelection}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-medium border border-rose-500/30 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Trash2 className="w-3 h-3" />
                      Delete {selectedCount}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        selectAllDuplicates(group.hash);
                      }}
                      className="text-xs text-blue-400 hover:text-blue-300"
                    >
                      Select all dupes
                    </button>
                  </div>
                </div>
                {isExpanded && (
                  <div className="border-t border-slate-800 divide-y divide-slate-800/60">
                    {group.files.map((file) => (
                      <div
                        key={file.id}
                        className={`flex items-center justify-between px-4 py-2.5 transition-colors ${
                          file.isOriginal ? 'bg-emerald-950/20 hover:bg-emerald-950/30' : 'hover:bg-slate-800/30'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {/* Keep-copy is unselectable: checkbox disabled (D-DF-7) */}
                          <input
                            type="checkbox"
                            checked={file.selectedForDeletion}
                            disabled={file.isOriginal}
                            onChange={() => toggleFile(group.hash, file.id)}
                            className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
                          />
                          <File className={`w-4 h-4 flex-shrink-0 ${file.isOriginal ? 'text-emerald-400' : 'text-slate-400'}`} />
                          <div className="min-w-0">
                            {/* Verbatim full path displayed before confirmation (D-DF-8) */}
                            <p
                              className={`text-xs font-mono break-all ${
                                file.isOriginal ? 'text-emerald-200 font-semibold' : 'text-slate-300'
                              }`}
                              title={file.path}
                            >
                              {file.path}
                            </p>
                            <p className="text-[10px] text-slate-500">
                              {new Date(file.lastModified).toLocaleDateString()} &middot; {formatBytes(file.sizeBytes)}
                            </p>
                          </div>
                        </div>
                        {file.isOriginal ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex-shrink-0 ml-3">
                            KEEP (ORIGINAL)
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-500 flex-shrink-0 ml-3">
                            {file.selectedForDeletion ? 'Selected for removal' : 'Keep copy'}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Confirmation Modal (Phase 11 Rail) */}
      <AnimatePresence>
        {showConfirmModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden"
            >
              {/* Modal Header */}
              <div className="p-6 border-b border-slate-800 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <Trash2 className="w-5 h-5 text-rose-500" />
                    Confirm Duplicate Deletion
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Review preserved originals and files scheduled for removal.
                  </p>
                </div>
                <button
                  onClick={() => setShowConfirmModal(false)}
                  disabled={isDeleting}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-40"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-6 overflow-y-auto space-y-4 text-sm flex-1">
                {/* Reversible Safety Rail: Names the Recycle Bin as the reversible mechanism */}
                <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20 text-xs text-blue-200 space-y-1.5">
                  <div className="flex items-center gap-2 font-bold text-blue-300">
                    <ShieldCheck className="w-4 h-4 flex-shrink-0 text-blue-400" />
                    Reversible Deletion Mechanism: Windows Recycle Bin
                  </div>
                  <p className="leading-relaxed">
                    Selected duplicates will be moved to the <strong>Windows Recycle Bin</strong> (never permanently destroyed).
                    You can restore them from the Recycle Bin if needed. A JSON backup manifest will be written before execution.
                  </p>
                </div>

                {/* Groups and files preview */}
                <div className="space-y-4">
                  {modalGroups.map(({ group, keepCopy, filesToDelete }) => (
                    <div
                      key={group.hash}
                      className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-200">{group.fileName}</span>
                        <span className="text-slate-400 font-mono">
                          {formatBytes(group.sizeBytes)} each
                        </span>
                      </div>

                      {/* Shows keep-copy path verbatim */}
                      <div className="p-3 rounded-lg bg-emerald-950/30 border border-emerald-500/30 space-y-1">
                        <div className="text-[11px] font-bold text-emerald-400 flex items-center gap-1.5">
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                          Preserved Original (Keep-Copy):
                        </div>
                        <p className="text-xs font-mono text-emerald-200 break-all select-all pl-5">
                          {keepCopy.path}
                        </p>
                      </div>

                      {/* Shows the paths to be deleted */}
                      <div className="p-3 rounded-lg bg-rose-950/20 border border-rose-500/20 space-y-1.5">
                        <div className="text-[11px] font-bold text-rose-400 flex items-center gap-1.5">
                          <Trash2 className="w-3.5 h-3.5 text-rose-400 flex-shrink-0" />
                          Moving to Recycle Bin ({filesToDelete.length} {filesToDelete.length === 1 ? 'copy' : 'copies'}):
                        </div>
                        <div className="space-y-1 pl-5">
                          {filesToDelete.map((f) => (
                            <p
                              key={f.id}
                              className="text-xs font-mono text-rose-200 break-all select-all"
                            >
                              {f.path}
                            </p>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Modal Footer */}
              <div className="p-6 border-t border-slate-800 flex items-center justify-between bg-slate-950/40">
                <div className="text-xs text-slate-400">
                  Total reclaimable:{' '}
                  <span className="font-semibold text-slate-200 font-mono">
                    {formatBytes(modalTotalBytes)}
                  </span>{' '}
                  ({modalTotalFiles} file{modalTotalFiles === 1 ? '' : 's'})
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setShowConfirmModal(false)}
                    disabled={isDeleting}
                    className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors disabled:opacity-40"
                  >
                    Cancel
                  </button>
                  {/* Delete button is disabled when no valid selection exists */}
                  <button
                    onClick={handleConfirmDelete}
                    disabled={isDeleting || modalTotalFiles === 0}
                    className="flex items-center gap-2 px-5 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-lg shadow-rose-900/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isDeleting ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Recycling...
                      </>
                    ) : (
                      <>
                        <Trash2 className="w-3.5 h-3.5" />
                        Move to Recycle Bin ({modalTotalFiles})
                      </>
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
