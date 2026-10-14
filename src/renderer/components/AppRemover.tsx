import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { api } from '../apiClient';
import { InstalledApp } from '../../shared/types';
import { formatBytes } from '../utils/format';
import {
  PackageX,
  Loader2,
  Search,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  HardDrive,
  ChevronDown,
} from 'lucide-react';

export const AppRemover: React.FC = () => {
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'date'>('size');
  const [uninstallingId, setUninstallingId] = useState<string | null>(null);
  const [uninstallResult, setUninstallResult] = useState<{ id: string; success: boolean; message: string } | null>(null);

  const loadApps = async () => {
    setIsLoading(true);
    try {
      const result = await api.getInstalledApps();
      setApps(result);
    } catch (e) {
      console.error('Failed to load apps:', e);
    }
    setIsLoading(false);
  };

  const handleUninstall = async (appId: string) => {
    setUninstallingId(appId);
    try {
      const result = await api.uninstallApp(appId, true);
      setUninstallResult({ id: appId, success: result.success, message: result.message });
      await loadApps();
    } catch (e) {
      console.error('Uninstall failed:', e);
    }
    setUninstallingId(null);
  };

  useEffect(() => {
    loadApps();
  }, []);

  const filteredApps = apps
    .filter((a) => a.name.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'size') return b.sizeBytes - a.sizeBytes;
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      return new Date(b.installDate).getTime() - new Date(a.installDate).getTime();
    });

  const totalSize = apps.reduce((sum, a) => sum + a.sizeBytes, 0);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">App Remover</h1>
        <p className="text-sm text-slate-400 mt-1">
          Uninstall programs and clean up leftover files
        </p>
      </div>

      {/* Summary */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800/80 p-6"
      >
        <div className="absolute top-0 right-0 w-64 h-64 bg-violet-500/10 rounded-full blur-3xl pointer-events-none -mr-12 -mt-12" />
        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="flex items-center gap-5">
            <div className="p-3 rounded-xl bg-violet-500/10 border border-violet-500/30">
              <PackageX className="w-6 h-6 text-violet-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">{apps.length} Programs Installed</h2>
              <p className="text-sm text-slate-400 mt-1">
                Total size: {formatBytes(totalSize)}
              </p>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Search & Sort */}
      <div className="flex items-center gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search installed programs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-violet-500/50"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Sort by:</span>
          {(['size', 'name', 'date'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSortBy(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                sortBy === s
                  ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Apps List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-violet-500 animate-spin" />
        </div>
      ) : (
        <div className="space-y-2">
          {filteredApps.map((app, idx) => {
            const isUninstalling = uninstallingId === app.id;
            return (
              <motion.div
                key={app.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.02 }}
                className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 hover:border-slate-700 transition-all"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="p-2 rounded-lg bg-violet-500/10 text-violet-400 shrink-0">
                      <HardDrive className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-slate-200 truncate">{app.name}</h3>
                        {app.isSystemComponent && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
                            System
                          </span>
                        )}
                        {app.leftoversDetected > 0 && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30">
                            {app.leftoversDetected} leftovers
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 truncate">
                        {app.publisher} &middot; v{app.version}
                      </p>
                      <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-600">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(app.installDate).toLocaleDateString()}
                        </span>
                        <span>{formatBytes(app.sizeBytes)}</span>
                        <span className="truncate max-w-[200px]">{app.installLocation}</span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleUninstall(app.id)}
                    disabled={isUninstalling || app.isSystemComponent}
                    className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-medium border border-rose-500/30 transition-all disabled:opacity-50"
                  >
                    {isUninstalling ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Trash2 className="w-3 h-3" />
                    )}
                    Uninstall
                  </button>
                </div>
                {uninstallResult && uninstallResult.id === app.id && (
                  <div className="mt-2 flex items-center gap-2">
                    {uninstallResult.success ? (
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <AlertTriangle className="w-3 h-3 text-rose-400" />
                    )}
                    <span className="text-xs text-slate-400">{uninstallResult.message}</span>
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
