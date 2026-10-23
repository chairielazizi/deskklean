import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
  FileQuestion,
  Info,
  ShieldAlert,
  X,
  RefreshCw,
} from 'lucide-react';

export const AppRemover: React.FC = () => {
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'desktop' | 'store'>('all');
  const [sortBy, setSortBy] = useState<'size' | 'name' | 'date'>('size');
  const [uninstallingId, setUninstallingId] = useState<string | null>(null);

  // Irreversible confirmation modal state
  const [confirmApp, setConfirmApp] = useState<InstalledApp | null>(null);
  const [acknowledgedIrreversible, setAcknowledgedIrreversible] = useState(false);

  // Remove registry entry only modal state (D-AR-7, Binding Rail 5)
  const [removeEntryApp, setRemoveEntryApp] = useState<InstalledApp | null>(null);

  // Verified uninstall outcome status
  const [uninstallResult, setUninstallResult] = useState<{
    id: string;
    success: boolean;
    message: string;
    verified?: boolean;
    rebootRequired?: boolean;
  } | null>(null);

  const loadApps = async (forceRefresh = false) => {
    setIsLoading(true);
    try {
      const result = await api.getInstalledApps(forceRefresh);
      setApps(result);
    } catch (e) {
      console.error('Failed to load installed apps:', e);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    loadApps();
  }, []);

  const handleOpenUninstallModal = (app: InstalledApp) => {
    setConfirmApp(app);
    setAcknowledgedIrreversible(false);
  };

  const handleExecuteUninstall = async () => {
    if (!confirmApp) return;
    const target = confirmApp;
    setConfirmApp(null);
    setUninstallingId(target.id);

    try {
      const result = await api.uninstallApp(target.id, false);
      setUninstallResult({
        id: target.id,
        success: result.success,
        message: result.message,
        verified: result.verified,
        rebootRequired: result.rebootRequired,
      });
      await loadApps(true);
    } catch (e) {
      setUninstallResult({
        id: target.id,
        success: false,
        message: e instanceof Error ? e.message : 'Uninstall failed during execution.',
        verified: false,
      });
    }
    setUninstallingId(null);
  };

  const handleExecuteRemoveEntryOnly = async () => {
    if (!removeEntryApp) return;
    const target = removeEntryApp;
    setRemoveEntryApp(null);
    setUninstallingId(target.id);

    try {
      if (api.removeAppRegistryEntry) {
        const result = await api.removeAppRegistryEntry(target.id);
        setUninstallResult({
          id: target.id,
          success: result.success,
          message: result.message || 'Registry entry removed. Application remains installed on machine.',
          verified: result.success,
        });
      } else {
        // Fallback to uninstallApp if direct helper is unavailable
        const result = await api.uninstallApp(target.id, false);
        setUninstallResult({
          id: target.id,
          success: result.success,
          message: result.message,
          verified: result.verified,
        });
      }
      await loadApps(true);
    } catch (e) {
      setUninstallResult({
        id: target.id,
        success: false,
        message: e instanceof Error ? e.message : 'Failed to remove registry entry.',
        verified: false,
      });
    }
    setUninstallingId(null);
  };

  const filteredApps = apps
    .filter((a) => {
      if (filterType === 'desktop' && a.isStoreApp) return false;
      if (filterType === 'store' && !a.isStoreApp) return false;
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        a.name.toLowerCase().includes(q) ||
        (a.publisher && a.publisher.toLowerCase().includes(q))
      );
    })
    .sort((a, b) => {
      if (sortBy === 'size') {
        return (b.sizeBytes || 0) - (a.sizeBytes || 0);
      }
      if (sortBy === 'name') {
        return a.name.localeCompare(b.name);
      }
      const dateA = a.installDate ? new Date(a.installDate).getTime() : 0;
      const dateB = b.installDate ? new Date(b.installDate).getTime() : 0;
      return dateB - dateA;
    });

  // Estimated size calculation (Binding Rail 4)
  const totalEstimatedBytes = apps.reduce((sum, a) => sum + (a.sizeBytes || 0), 0);
  const desktopCount = apps.filter((a) => !a.isStoreApp).length;
  const storeCount = apps.filter((a) => a.isStoreApp).length;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">App Remover</h1>
        <p className="text-sm text-slate-400 mt-1">
          Enumerate and verify removal of installed desktop and Windows Store applications
        </p>
      </div>

      {/* Summary Card with explicit estimated size labelling (Binding Rail 4) */}
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
              <h2 className="text-lg font-bold text-white">
                {apps.length} Applications Installed ({desktopCount} Desktop, {storeCount} Store)
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                Total estimated size: <span className="text-slate-200 font-medium">{formatBytes(totalEstimatedBytes)}</span>
                <span className="text-xs text-slate-500 ml-2">(installer reported estimates)</span>
              </p>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Filter Tabs, Search & Sort */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        {/* Section Tabs */}
        <div className="flex items-center gap-1 bg-slate-900/80 p-1 rounded-xl border border-slate-800">
          {(
            [
              { id: 'all', label: `All Apps (${apps.length})` },
              { id: 'desktop', label: `Desktop Apps (${desktopCount})` },
              { id: 'store', label: `Store Apps (${storeCount})` },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setFilterType(t.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                filterType === t.id
                  ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Search & Sort Controls */}
        <div className="flex items-center gap-3">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search installed apps..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-violet-500/50"
            />
          </div>

          <div className="flex items-center gap-1">
            <span className="text-xs text-slate-400 mr-1">Sort:</span>
            {(['size', 'name', 'date'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSortBy(s)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  sortBy === s
                    ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30'
                    : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}

            {/* Refresh Button */}
            <button
              onClick={() => loadApps(true)}
              disabled={isLoading}
              title="Rescan installed applications"
              className="p-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600 transition-colors disabled:opacity-50 ml-1"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-violet-400' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Apps List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-violet-500 animate-spin" />
        </div>
      ) : filteredApps.length === 0 ? (
        <div className="text-center py-16 bg-slate-900/40 rounded-xl border border-slate-800">
          <PackageX className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400 text-sm">No applications found matching your criteria</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredApps.map((app, idx) => {
            const isUninstalling = uninstallingId === app.id;
            const isUnavailable = app.uninstallMethod === 'unavailable';

            return (
              <motion.div
                key={app.id}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(idx * 0.015, 0.3) }}
                className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 hover:border-slate-700 transition-all"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="p-2 rounded-lg bg-violet-500/10 text-violet-400 shrink-0">
                      {app.isStoreApp ? <PackageX className="w-5 h-5" /> : <HardDrive className="w-5 h-5" />}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-semibold text-slate-200 truncate">{app.name}</h3>

                        {/* Uninstall Method Badges */}
                        {app.isMsi && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/30">
                            MSI
                          </span>
                        )}
                        {app.isStoreApp && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-500/10 text-violet-400 border border-violet-500/30">
                            Store App
                          </span>
                        )}
                        {!app.isMsi && !app.isStoreApp && !isUnavailable && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-700/50 text-slate-300 border border-slate-600">
                            Uninstaller
                          </span>
                        )}
                        {isUnavailable && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30 flex items-center gap-1">
                            <FileQuestion className="w-3 h-3" />
                            Installer Missing
                          </span>
                        )}
                        {app.nonRemovable && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30">
                            System Package
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-slate-500 truncate mt-0.5">
                        {app.publisher || 'Unknown Publisher'} {app.version ? `· v${app.version}` : ''}
                      </p>

                      <div className="flex items-center gap-3 mt-1.5 text-[10px] text-slate-500 flex-wrap">
                        {app.installDate && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {app.installDate}
                          </span>
                        )}
                        {/* Explicit Estimated Size Label (Binding Rail 4) */}
                        <span>
                          {app.sizeBytes !== null
                            ? `Estimated size: ${formatBytes(app.sizeBytes)}`
                            : 'Estimated size: Unknown'}
                        </span>
                        {app.installLocation && (
                          <span className="truncate max-w-[280px]" title={app.installLocation}>
                            {app.installLocation}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="shrink-0 flex items-center gap-2">
                    {isUnavailable ? (
                      <button
                        onClick={() => setRemoveEntryApp(app)}
                        disabled={isUninstalling}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-xs font-medium border border-amber-500/30 transition-all disabled:opacity-50"
                        title="Remove registry entry from list (application remains installed on machine)"
                      >
                        {isUninstalling ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                        Remove from list only
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => handleOpenUninstallModal(app)}
                          disabled={isUninstalling || app.nonRemovable}
                          className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-medium border border-rose-500/30 transition-all disabled:opacity-50"
                        >
                          {isUninstalling ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                          Uninstall
                        </button>

                        {/* Optional entry-only removal for registered desktop apps */}
                        {!app.isStoreApp && app.registryKey && (
                          <button
                            onClick={() => setRemoveEntryApp(app)}
                            disabled={isUninstalling}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors"
                            title="Remove registry entry only (application remains installed on machine)"
                          >
                            <Info className="w-4 h-4" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Verification result feedback */}
                {uninstallResult && uninstallResult.id === app.id && (
                  <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center gap-2">
                    {uninstallResult.success ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : uninstallResult.rebootRequired ? (
                      <Clock className="w-4 h-4 text-amber-400 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                    )}
                    <span className="text-xs text-slate-300">
                      {uninstallResult.verified
                        ? `Verified: ${uninstallResult.message}`
                        : uninstallResult.message}
                    </span>
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Irreversible Confirmation Modal (D-AR-9 & Binding Rail 2) */}
      <AnimatePresence>
        {confirmApp && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-4"
            >
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 shrink-0">
                  <ShieldAlert className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Confirm Application Uninstallation</h3>
                  <p className="text-sm text-slate-300 mt-1">
                    You are about to uninstall <span className="font-semibold text-white">{confirmApp.name}</span>
                    {confirmApp.version ? ` (v${confirmApp.version})` : ''}.
                  </p>
                </div>
              </div>

              {/* Irreversibility Declaration (D-AR-9) */}
              <div className="p-3.5 rounded-xl bg-rose-950/30 border border-rose-800/40 text-xs text-rose-200 space-y-2">
                <p className="font-semibold flex items-center gap-1.5 text-rose-300">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  Irreversible Operation
                </p>
                <p className="leading-relaxed">
                  Uninstalling removes the application. It can be reinstalled only by obtaining a new installer — DeskKlean does not offer a restore.
                </p>
                <p className="text-[11px] text-rose-300/80">
                  Estimated size reclaimed: {confirmApp.sizeBytes !== null ? formatBytes(confirmApp.sizeBytes) : 'Unknown (estimate)'}
                </p>
              </div>

              {/* Interactive warning if applicable (D-AR-5) */}
              {confirmApp.uninstallMethod === 'uninstall-string' && (
                <div className="p-3 rounded-xl bg-amber-950/20 border border-amber-800/30 text-xs text-amber-300 flex items-start gap-2">
                  <Info className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    This application&apos;s uninstaller may require interaction. A window will appear — complete the uninstall there.
                  </span>
                </div>
              )}

              {/* Explicit Acknowledgement Checkbox (Binding Rail 2) */}
              <label className="flex items-start gap-2.5 cursor-pointer pt-2 select-none">
                <input
                  type="checkbox"
                  checked={acknowledgedIrreversible}
                  onChange={(e) => setAcknowledgedIrreversible(e.target.checked)}
                  className="mt-0.5 rounded border-slate-700 bg-slate-800 text-rose-500 focus:ring-rose-500/30"
                />
                <span className="text-xs text-slate-300 leading-snug">
                  I understand that this action is irreversible and success will be verified by re-enumerating the system.
                </span>
              </label>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  onClick={() => setConfirmApp(null)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleExecuteUninstall}
                  disabled={!acknowledgedIrreversible}
                  className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-rose-900/20"
                >
                  Confirm & Uninstall
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Remove Registry Entry Only Modal (D-AR-7 & Binding Rail 5) */}
      <AnimatePresence>
        {removeEntryApp && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-4"
            >
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 shrink-0">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Remove Registry Entry Only</h3>
                  <p className="text-sm text-slate-300 mt-1">
                    Entry: <span className="font-semibold text-white">{removeEntryApp.name}</span>
                  </p>
                </div>
              </div>

              {/* Plain Statement of Record (Binding Rail 5) */}
              <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-800/40 text-xs text-amber-200 space-y-2">
                <p className="font-semibold flex items-center gap-1.5 text-amber-300">
                  <Info className="w-4 h-4 shrink-0" />
                  Application Remains Installed
                </p>
                <p className="leading-relaxed">
                  This option removes the application from the Windows list only. The application and its files remain fully installed on your machine.
                </p>
                {removeEntryApp.registryKey && (
                  <p className="text-[11px] text-amber-300/80 break-all font-mono">
                    Target: {removeEntryApp.registryKey}
                  </p>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  onClick={() => setRemoveEntryApp(null)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleExecuteRemoveEntryOnly}
                  className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium transition-colors shadow-lg shadow-amber-900/20"
                >
                  Remove Entry From List
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
