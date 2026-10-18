import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '../apiClient';
import { DuplicateGroup, DuplicateScanConfig, DuplicateScanResult } from '../../shared/types';
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
} from 'lucide-react';

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

  const runScan = async () => {
    setIsScanning(true);
    try {
      const result = await api.scanDuplicates(scanConfig);
      setScanResult(result);
      setGroups(result.groups);
    } catch (e) {
      console.error('Duplicate scan failed:', e);
    }
    setIsScanning(false);
  };

  const handleDelete = async (group: DuplicateGroup) => {
    // Phase 10: UI selection guards enforce keep-copy is preserved and not all copies can be deleted
    const filesToDelete = group.files.filter((f) => f.selectedForDeletion && !f.isOriginal);
    if (filesToDelete.length === 0 || filesToDelete.length >= group.files.length) return;

    setIsDeleting(true);
    try {
      await api.deleteDuplicateFiles(filesToDelete.map((f) => f.id));
      setGroups((prev) => prev.filter((g) => g.hash !== group.hash));
    } catch (e) {
      console.error('Delete failed:', e);
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
        <button
          onClick={runScan}
          disabled={isScanning}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white font-bold text-sm shadow-lg transition-all disabled:opacity-50"
        >
          {isScanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          {isScanning ? 'Scanning...' : 'Scan for Duplicates'}
        </button>
      </div>

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
                    {/* Delete button is disabled when no valid selection exists (D-DF-7) */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (hasValidSelection) {
                          handleDelete(group);
                        }
                      }}
                      disabled={isDeleting || !hasValidSelection}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-medium border border-rose-500/30 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      {isDeleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
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
    </div>
  );
};
