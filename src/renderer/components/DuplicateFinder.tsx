import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { api } from '../apiClient';
import { DuplicateGroup, DuplicateScanConfig } from '../../shared/types';
import { formatBytes } from '../utils/format';
import {
  Copy,
  Loader2,
  Search,
  Trash2,
  CheckCircle2,
  Folder,
  File,
  Settings,
} from 'lucide-react';

export const DuplicateFinder: React.FC = () => {
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [scanConfig, setScanConfig] = useState<DuplicateScanConfig>({
    directories: ['C:\\Users\\Downloads', 'C:\\Users\\Documents', 'C:\\Users\\Pictures'],
    matchBy: 'hash',
    fileTypes: ['*'],
    minSizeBytes: 1024 * 1024, // 1 MB
  });
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const runScan = async () => {
    setIsScanning(true);
    try {
      const result = await api.scanDuplicates(scanConfig);
      setGroups(result);
    } catch (e) {
      console.error('Duplicate scan failed:', e);
    }
    setIsScanning(false);
  };

  const handleDelete = async (group: DuplicateGroup) => {
    const filesToDelete = group.files.filter((f) => f.selectedForDeletion && !f.isOriginal);
    if (filesToDelete.length === 0) return;

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
      prev.map((g) =>
        g.hash === groupHash
          ? {
              ...g,
              files: g.files.map((f) =>
                f.id === fileId ? { ...f, selectedForDeletion: !f.selectedForDeletion } : f
              ),
            }
          : g
      )
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
    setGroups((prev) =>
      prev.map((g) =>
        g.hash === groupHash
          ? {
              ...g,
              files: g.files.map((f) =>
                f.isOriginal ? f : { ...f, selectedForDeletion: true }
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
            Find and remove duplicate files to reclaim disk space
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

      {/* Config Summary */}
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
              <p className="text-sm text-slate-400 mt-1">
                {formatBytes(totalWasted)} wasted space
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-400">
            <span className="flex items-center gap-1">
              <Folder className="w-3 h-3" /> {scanConfig.directories.length} directories
            </span>
            <span className="flex items-center gap-1">
              <Settings className="w-3 h-3" /> Min: {formatBytes(scanConfig.minSizeBytes)}
            </span>
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
                        {group.files.length} copies &middot; {formatBytes(group.sizeBytes)} each &middot; {formatBytes(group.wastedBytes)} wasted
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {selectedCount > 0 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(group);
                        }}
                        disabled={isDeleting}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-medium border border-rose-500/30 transition-all"
                      >
                        {isDeleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                        Delete {selectedCount}
                      </button>
                    )}
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
                        className="flex items-center justify-between px-4 py-2.5 hover:bg-slate-800/30 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={file.selectedForDeletion}
                            disabled={file.isOriginal}
                            onChange={() => toggleFile(group.hash, file.id)}
                            className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-blue-500"
                          />
                          <File className="w-4 h-4 text-slate-400" />
                          <div>
                            <p className="text-xs text-slate-300 font-mono truncate max-w-[400px]">
                              {file.path}
                            </p>
                            <p className="text-[10px] text-slate-500">
                              {new Date(file.lastModified).toLocaleDateString()} &middot; {formatBytes(file.sizeBytes)}
                            </p>
                          </div>
                        </div>
                        {file.isOriginal && (
                          <span className="text-[10px] text-emerald-400 font-semibold">ORIGINAL</span>
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
