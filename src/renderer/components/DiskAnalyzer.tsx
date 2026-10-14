import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { api } from '../apiClient';
import { FileTypeBreakdown, DiskFolderNode, LargeFileInfo } from '../../shared/types';
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
} from 'lucide-react';

interface DiskAnalysis {
  breakdown: FileTypeBreakdown[];
  folderTree: DiskFolderNode;
  largeFiles: LargeFileInfo[];
  totalBytes: number;
  freeBytes: number;
}

export const DiskAnalyzer: React.FC = () => {
  const [analysis, setAnalysis] = useState<DiskAnalysis | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [currentPath, setCurrentPath] = useState<string>('C:\\');
  const [selectedFileType, setSelectedFileType] = useState<string | null>(null);
  const [view, setView] = useState<'overview' | 'large-files'>('overview');

  const runAnalysis = async (drivePath: string) => {
    setIsLoading(true);
    try {
      const result = await api.analyzeDisk(drivePath);
      setAnalysis(result);
      setCurrentPath(drivePath);
    } catch (e) {
      console.error('Disk analysis failed:', e);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    runAnalysis('C:\\');
  }, []);

  const navigateToFolder = (path: string) => {
    // In a real app, this would re-analyze; here we just update the path
    setCurrentPath(path);
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Disk Analyzer</h1>
          <p className="text-sm text-slate-400 mt-1">
            Visualize disk usage and find large files
          </p>
        </div>
        <button
          onClick={() => runAnalysis(currentPath)}
          disabled={isLoading}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium border border-slate-700 transition-all disabled:opacity-50"
        >
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <HardDrive className="w-4 h-4" />}
          Analyze
        </button>
      </div>

      {/* Drive Overview */}
      {analysis && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800/80 p-6"
        >
          <div className="absolute top-0 right-0 w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none -mr-12 -mt-12" />
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <HardDrive className="w-5 h-5 text-cyan-400" />
                Drive {currentPath}
              </h2>
              <div className="flex items-center gap-4 text-sm">
                <span className="text-slate-400">
                  Used: <span className="text-white font-bold">{formatBytes(analysis.totalBytes)}</span>
                </span>
                <span className="text-slate-400">
                  Free: <span className="text-emerald-400 font-bold">{formatBytes(analysis.freeBytes)}</span>
                </span>
              </div>
            </div>
            {/* Usage bar */}
            <div className="w-full bg-slate-800 h-3 rounded-full overflow-hidden">
              <div
                className="bg-gradient-to-r from-cyan-500 to-blue-500 h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(100, (analysis.totalBytes / (analysis.totalBytes + analysis.freeBytes)) * 100)}%`,
                }}
              />
            </div>
          </div>
        </motion.div>
      )}

      {/* View Tabs */}
      <div className="flex items-center gap-2">
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
          Large Files
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-cyan-500 animate-spin" />
        </div>
      ) : analysis ? (
        view === 'overview' ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* File Type Breakdown */}
            <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800">
              <h3 className="text-sm font-bold text-slate-200 mb-4 flex items-center gap-2">
                <PieChart className="w-4 h-4 text-cyan-400" /> File Type Breakdown
              </h3>
              <div className="space-y-3">
                {analysis.breakdown.map((ft) => (
                  <div key={ft.type} className="flex items-center gap-3">
                    <div
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: ft.color }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-300">{ft.label}</span>
                        <span className="text-slate-400 font-mono">
                          {formatBytes(ft.totalBytes)} ({ft.percentage}%)
                        </span>
                      </div>
                      <div className="w-full bg-slate-800 h-1.5 rounded-full mt-1 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${ft.percentage}%`, backgroundColor: ft.color }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Folder Tree */}
            <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800">
              <h3 className="text-sm font-bold text-slate-200 mb-4 flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-cyan-400" /> Top-Level Folders
              </h3>
              <div className="space-y-1">
                {analysis.folderTree.children?.slice(0, 8).map((folder) => (
                  <button
                    key={folder.path}
                    onClick={() => navigateToFolder(folder.path)}
                    className="w-full flex items-center justify-between p-2.5 rounded-lg hover:bg-slate-800/60 transition-colors group"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Folder className="w-4 h-4 text-cyan-400/60 shrink-0" />
                      <span className="text-sm text-slate-300 truncate group-hover:text-white">
                        {folder.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs font-mono text-slate-400">
                        {formatBytes(folder.sizeBytes)}
                      </span>
                      <span className="text-[10px] text-slate-500">{folder.fileCount} files</span>
                      <ChevronRight className="w-3 h-3 text-slate-600 group-hover:text-slate-400" />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* Large Files View */
          <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800">
            <h3 className="text-sm font-bold text-slate-200 mb-4 flex items-center gap-2">
              <Search className="w-4 h-4 text-cyan-400" /> Largest Files
            </h3>
            <div className="space-y-1">
              {analysis.largeFiles.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-800/60 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <File className="w-4 h-4 text-slate-400 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm text-slate-200 truncate">{file.name}</p>
                      <p className="text-xs text-slate-500 truncate">{file.path}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 shrink-0 text-xs">
                    <span className="text-slate-400">{file.extension}</span>
                    <span className="font-mono text-cyan-400 font-bold">
                      {formatBytes(file.sizeBytes)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      ) : null}
    </div>
  );
};
