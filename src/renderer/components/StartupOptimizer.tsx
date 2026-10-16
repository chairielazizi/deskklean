import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../apiClient';
import {
  StartupItem,
  StartupDelayState,
  StartupBackup,
  OperationPlan,
} from '../../shared/types';
import { dataCache } from '../utils/dataCache';
import {
  Zap,
  Loader2,
  Clock,
  ToggleLeft,
  ToggleRight,
  AlertTriangle,
  Rocket,
  Info,
  RefreshCw,
  RotateCcw,
  CheckCircle2,
  Sliders,
  Archive,
  History,
  ShieldAlert,
  ShieldCheck,
  X,
  FileText,
} from 'lucide-react';

const IMPACT_COLORS: Record<string, { bg: string; text: string; bar: string }> = {
  high: { bg: 'bg-rose-500/10', text: 'text-rose-400', bar: 'bg-rose-500' },
  medium: { bg: 'bg-amber-500/10', text: 'text-amber-400', bar: 'bg-amber-500' },
  low: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', bar: 'bg-emerald-500' },
  none: { bg: 'bg-slate-500/10', text: 'text-slate-400', bar: 'bg-slate-500' },
};

export const StartupOptimizer: React.FC = () => {
  const cached = dataCache.getStartupItems();
  const [items, setItems] = useState<StartupItem[]>(() => cached ?? []);
  const [isLoading, setIsLoading] = useState(() => !cached);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [isElevated, setIsElevated] = useState(true);
  const [isRelaunching, setIsRelaunching] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [relaunchMessage, setRelaunchMessage] = useState<string | null>(null);

  // Active view tab: 'items' or 'backups'
  const [activeTab, setActiveTab] = useState<'items' | 'backups'>('items');

  // Step 7: Global Startup Delay Control State
  const [delayState, setDelayState] = useState<StartupDelayState | null>(null);
  const [delayPreset, setDelayPreset] = useState<'default' | '0' | '5000' | 'custom'>('default');
  const [customDelaySec, setCustomDelaySec] = useState<number>(10);
  const [waitForIdle, setWaitForIdle] = useState<boolean>(true);
  const [isSavingDelay, setIsSavingDelay] = useState(false);
  const [delayMessage, setDelayMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Step 8: Backup & Restore State (Phase 3 Framework)
  const [backups, setBackups] = useState<StartupBackup[]>([]);
  const [isLoadingBackups, setIsLoadingBackups] = useState(false);
  const [activePlan, setActivePlan] = useState<OperationPlan | null>(null);
  const [isPlanningRestore, setIsPlanningRestore] = useState<string | null>(null);
  const [isExecutingRestore, setIsExecutingRestore] = useState(false);
  const [restoreModalError, setRestoreModalError] = useState<string | null>(null);
  const [restoreFeedback, setRestoreFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const loadItems = async (force = false) => {
    const existing = dataCache.getStartupItems();
    if (!force && existing && !dataCache.isStartupItemsStale()) {
      setItems(existing);
      return;
    }

    if (!existing) {
      setIsLoading(true);
    } else {
      setIsRefreshing(true);
    }

    try {
      const result = await api.getStartupItems();
      dataCache.setStartupItems(result);
      setItems(result);
    } catch (e) {
      console.error('Failed to load startup items:', e);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const loadDelay = async () => {
    try {
      const res = await api.getStartupDelay();
      setDelayState(res);
      if (res.delayMs === null) {
        setDelayPreset('default');
      } else if (res.delayMs === 0) {
        setDelayPreset('0');
      } else if (res.delayMs === 5000) {
        setDelayPreset('5000');
      } else {
        setDelayPreset('custom');
        setCustomDelaySec(Math.round(res.delayMs / 1000));
      }
      setWaitForIdle(res.waitForIdle ?? true);
    } catch (e) {
      console.error('Failed to load startup delay:', e);
    }
  };

  const loadBackups = async () => {
    setIsLoadingBackups(true);
    try {
      const list = await api.getStartupBackups();
      setBackups(list);
    } catch (e) {
      console.error('Failed to load startup backups:', e);
    } finally {
      setIsLoadingBackups(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([loadItems(true), loadDelay(), loadBackups()]);
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const handleRelaunch = async () => {
    setIsRelaunching(true);
    setToggleError(null);
    setRelaunchMessage(null);
    try {
      const res = await api.relaunchElevated();
      if (!res.success) {
        if (res.message) {
          setToggleError(res.message);
        }
        setIsRelaunching(false);
      } else if (res.message) {
        setRelaunchMessage(res.message);
        setIsRelaunching(false);
      }
    } catch (err) {
      setToggleError(err instanceof Error ? err.message : String(err));
      setIsRelaunching(false);
    }
  };

  const toggleItem = async (id: string, enabled: boolean) => {
    setTogglingId(id);
    setToggleError(null);
    try {
      const res = await api.toggleStartupItem(id, enabled);
      if (res.success) {
        dataCache.updateStartupItem(id, enabled);
        setItems((prev) =>
          prev.map((i) => (i.id === id ? { ...i, enabled } : i))
        );
        // Reload backups so new backup appears immediately in the backups list
        loadBackups();
      } else if (res.message) {
        setToggleError(res.message);
      }
    } catch (e) {
      console.error('Toggle failed:', e);
      setToggleError('Failed to toggle startup item');
    } finally {
      setTogglingId(null);
    }
  };

  const handleApplyDelay = async () => {
    setIsSavingDelay(true);
    setDelayMessage(null);

    let targetMs: number | null = null;
    if (delayPreset === '0') {
      targetMs = 0;
    } else if (delayPreset === '5000') {
      targetMs = 5000;
    } else if (delayPreset === 'custom') {
      targetMs = Math.max(0, customDelaySec * 1000);
    } else {
      targetMs = null; // Windows default
    }

    try {
      const res = await api.setStartupDelay(targetMs, waitForIdle);
      if (res.success) {
        await loadDelay();
        setDelayMessage({
          text:
            targetMs === null
              ? 'Startup delay reset to Windows default (~10s). Takes effect after reboot.'
              : `Startup delay set to ${targetMs === 0 ? '0 ms (instant)' : `${targetMs} ms`}. Takes effect after reboot.`,
          type: 'success',
        });
      } else {
        setDelayMessage({
          text: res.message || 'Failed to update startup delay in registry.',
          type: 'error',
        });
      }
    } catch (e) {
      setDelayMessage({
        text: e instanceof Error ? e.message : 'Error setting startup delay',
        type: 'error',
      });
    } finally {
      setIsSavingDelay(false);
    }
  };

  const handleResetDelay = async () => {
    setIsSavingDelay(true);
    setDelayMessage(null);
    try {
      const res = await api.setStartupDelay(null, true);
      if (res.success) {
        await loadDelay();
        setDelayMessage({
          text: 'Startup delay reset to Windows default (~10s). Takes effect after reboot.',
          type: 'success',
        });
      } else {
        setDelayMessage({
          text: res.message || 'Failed to reset startup delay.',
          type: 'error',
        });
      }
    } catch (e) {
      setDelayMessage({
        text: e instanceof Error ? e.message : 'Error resetting startup delay',
        type: 'error',
      });
    } finally {
      setIsSavingDelay(false);
    }
  };

  // Phase 3 Framework: Step 1 (Plan)
  const handleInitiateRestore = async (backupId: string) => {
    setIsPlanningRestore(backupId);
    setRestoreModalError(null);
    setRestoreFeedback(null);
    try {
      const plan = await api.planStartupRestore(backupId);
      setActivePlan(plan);
    } catch (e) {
      setRestoreFeedback({
        text: e instanceof Error ? e.message : 'Failed to create restore plan',
        type: 'error',
      });
    } finally {
      setIsPlanningRestore(null);
    }
  };

  // Phase 3 Framework: Step 3, 4, 5 (Execute -> Verify -> Record)
  const handleConfirmExecuteRestore = async () => {
    if (!activePlan) return;
    setIsExecutingRestore(true);
    setRestoreModalError(null);
    try {
      const result = await api.executeOperationPlan(activePlan.id);
      if (result.success) {
        setActivePlan(null);
        setRestoreFeedback({
          text: result.message || 'Startup item restored and verified successfully.',
          type: 'success',
        });
        await Promise.all([loadItems(true), loadBackups()]);
      } else {
        setRestoreModalError(
          result.message ||
            (result.failures && result.failures[0]?.error) ||
            'Restore failed.'
        );
      }
    } catch (e) {
      setRestoreModalError(e instanceof Error ? e.message : 'Execution failed.');
    } finally {
      setIsExecutingRestore(false);
    }
  };

  useEffect(() => {
    loadItems();
    loadDelay();
    loadBackups();
    api.isElevated()
      .then((elevated) => setIsElevated(elevated))
      .catch(() => setIsElevated(false));
  }, []);

  const enabledCount = items.filter((i) => i.enabled).length;
  const highImpactCount = items.filter((i) => i.impact === 'high' && i.enabled).length;
  const totalBootImpact = items
    .filter((i) => i.enabled)
    .reduce((sum, i) => sum + (i.estimatedBootImpactMs ?? 0), 0);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Startup Optimizer</h1>
          <p className="text-sm text-slate-400 mt-1">
            Manage startup applications and global launch delay to speed up boot time
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing || isLoading}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium border border-slate-700 transition-all disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Summary KPI Cards */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800/80 p-6"
      >
        <div className="absolute top-0 right-0 w-64 h-64 bg-rose-500/10 rounded-full blur-3xl pointer-events-none -mr-12 -mt-12" />
        <div className="relative z-10 grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30">
              <Rocket className="w-6 h-6 text-rose-400" />
            </div>
            <div>
              <p className="text-2xl font-black text-white font-mono">{enabledCount}</p>
              <p className="text-xs text-slate-400">Active startup apps</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30">
              <AlertTriangle className="w-6 h-6 text-amber-400" />
            </div>
            <div>
              <p className="text-2xl font-black text-white font-mono">{highImpactCount}</p>
              <p className="text-xs text-slate-400">High impact items</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
              <Clock className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <p className="text-2xl font-black text-white font-mono">
                {(totalBootImpact / 1000).toFixed(1)}s
              </p>
              <p className="text-xs text-slate-400">Boot time impact</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/30">
              <Sliders className="w-6 h-6 text-cyan-400" />
            </div>
            <div>
              <p className="text-base font-bold text-white font-mono">
                {delayState?.delayMs === null
                  ? 'Default (~10s)'
                  : delayState?.delayMs === 0
                  ? '0 ms (Instant)'
                  : `${delayState?.delayMs} ms`}
              </p>
              <p className="text-xs text-slate-400">
                {delayState?.waitForIdle ? 'CPU idle wait on' : 'No CPU idle wait'}
              </p>
            </div>
          </div>
        </div>
      </motion.div>

      {/* UAC Elevation Banner */}
      {!isElevated && (
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200"
        >
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
            <p className="text-sm">
              Administrator rights are required to change or restore HKLM startup items.
            </p>
          </div>
          <button
            type="button"
            onClick={handleRelaunch}
            disabled={isRelaunching}
            className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 transition-colors shrink-0 disabled:opacity-50"
          >
            {isRelaunching ? 'Restarting...' : 'Restart as administrator'}
          </button>
        </motion.div>
      )}

      {/* Relaunch Informational Note */}
      {relaunchMessage && (
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between gap-3 p-3 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-300 text-sm"
        >
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-blue-400 shrink-0" />
            <span>{relaunchMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setRelaunchMessage(null)}
            className="text-xs text-blue-400 hover:text-white px-2 py-0.5"
          >
            Dismiss
          </button>
        </motion.div>
      )}

      {/* Error or Feedback Notifications */}
      {toggleError && (
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between gap-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm"
        >
          <span>{toggleError}</span>
          <button
            type="button"
            onClick={() => setToggleError(null)}
            className="text-xs text-rose-400 hover:text-white px-2 py-0.5"
          >
            Dismiss
          </button>
        </motion.div>
      )}

      {restoreFeedback && (
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className={`flex items-center justify-between gap-3 p-3 rounded-xl text-sm border ${
            restoreFeedback.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {restoreFeedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span>{restoreFeedback.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setRestoreFeedback(null)}
            className="text-xs opacity-75 hover:opacity-100 px-2 py-0.5"
          >
            Dismiss
          </button>
        </motion.div>
      )}

      {/* Tabs navigation: Items vs Backups */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
        <button
          onClick={() => setActiveTab('items')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
            activeTab === 'items'
              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <Zap className="w-4 h-4" />
          Startup Programs
          <span className="ml-1.5 px-2 py-0.5 text-xs rounded-full bg-slate-800 text-slate-300 border border-slate-700">
            {items.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('backups')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
            activeTab === 'backups'
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <Archive className="w-4 h-4" />
          Backups & Rollback
          <span className="ml-1.5 px-2 py-0.5 text-xs rounded-full bg-slate-800 text-slate-300 border border-slate-700">
            {backups.length}
          </span>
        </button>
      </div>

      {/* TAB 1: Startup Items + Global Delay Control */}
      {activeTab === 'items' && (
        <div className="space-y-6">
          {/* STEP 7: Global Startup Delay Control Card */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  <Sliders className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-200">
                    Global Windows Startup Delay
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Windows delays launch by ~10s and waits for CPU idle. Configured in HKCU (no admin required).
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono bg-slate-800 text-slate-300 border border-slate-700">
                  Current: {delayState?.delayMs === null
                    ? 'Default (~10s)'
                    : delayState?.delayMs === 0
                    ? '0 ms (Instant)'
                    : `${delayState?.delayMs} ms`}
                </span>
              </div>
            </div>

            {/* Presets and options */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDelayPreset('0')}
                className={`p-3 rounded-lg border text-left transition-all ${
                  delayPreset === '0'
                    ? 'bg-cyan-500/15 border-cyan-500/50 text-white'
                    : 'bg-slate-800/40 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/70'
                }`}
              >
                <p className="text-xs font-bold text-cyan-300">No Delay (0 ms)</p>
                <p className="text-[11px] text-slate-400 mt-1">
                  Instant launch (best for SSDs)
                </p>
              </button>

              <button
                type="button"
                onClick={() => setDelayPreset('5000')}
                className={`p-3 rounded-lg border text-left transition-all ${
                  delayPreset === '5000'
                    ? 'bg-cyan-500/15 border-cyan-500/50 text-white'
                    : 'bg-slate-800/40 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/70'
                }`}
              >
                <p className="text-xs font-bold text-cyan-300">Short Delay (5 s)</p>
                <p className="text-[11px] text-slate-400 mt-1">
                  Balanced startup pace
                </p>
              </button>

              <button
                type="button"
                onClick={() => setDelayPreset('default')}
                className={`p-3 rounded-lg border text-left transition-all ${
                  delayPreset === 'default'
                    ? 'bg-cyan-500/15 border-cyan-500/50 text-white'
                    : 'bg-slate-800/40 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/70'
                }`}
              >
                <p className="text-xs font-bold text-slate-300">Windows Default</p>
                <p className="text-[11px] text-slate-400 mt-1">
                  ~10 s default delay
                </p>
              </button>

              <div
                onClick={() => setDelayPreset('custom')}
                className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
                  delayPreset === 'custom'
                    ? 'bg-cyan-500/15 border-cyan-500/50 text-white'
                    : 'bg-slate-800/40 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <p className="text-xs font-bold text-cyan-300">Custom Delay</p>
                <div className="flex items-center gap-1.5 mt-1" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="number"
                    min={0}
                    max={60}
                    value={customDelaySec}
                    onChange={(e) => {
                      setDelayPreset('custom');
                      setCustomDelaySec(Math.max(0, parseInt(e.target.value, 10) || 0));
                    }}
                    className="w-16 px-1.5 py-0.5 text-xs bg-slate-900 border border-slate-700 rounded text-slate-200 focus:outline-none focus:border-cyan-500"
                  />
                  <span className="text-[11px] text-slate-400">seconds</span>
                </div>
              </div>
            </div>

            {/* Wait for CPU Idle Checkbox */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
              <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={waitForIdle}
                  onChange={(e) => setWaitForIdle(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-700 bg-slate-800 text-cyan-500 focus:ring-cyan-500/30"
                />
                <span>Also wait for CPU to become idle before launching startup apps</span>
              </label>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleResetDelay}
                  disabled={isSavingDelay}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition-colors disabled:opacity-50"
                >
                  Reset Default
                </button>
                <button
                  type="button"
                  onClick={handleApplyDelay}
                  disabled={isSavingDelay}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold shadow transition-all disabled:opacity-50"
                >
                  {isSavingDelay ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  Apply Delay
                </button>
              </div>
            </div>

            {delayMessage && (
              <p
                className={`text-xs flex items-center gap-1.5 ${
                  delayMessage.type === 'success' ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {delayMessage.type === 'success' ? (
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                )}
                <span>{delayMessage.text}</span>
              </p>
            )}
          </div>

          {/* Items List */}
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 text-rose-500 animate-spin" />
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((item, idx) => {
                const colors = IMPACT_COLORS[item.impact];
                const isToggling = togglingId === item.id;
                return (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.03 }}
                    className={`p-4 rounded-xl border transition-all ${
                      item.enabled
                        ? 'bg-slate-900/60 border-slate-800'
                        : 'bg-slate-900/30 border-slate-800/50 opacity-60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-4 min-w-0">
                        <div className={`p-2 rounded-lg ${colors.bg}`}>
                          <Zap className={`w-4 h-4 ${colors.text}`} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-semibold text-slate-200 truncate">{item.name}</h3>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${colors.bg} ${colors.text}`}>
                              {item.impact}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 truncate">{item.command}</p>
                          <p className="text-[10px] text-slate-600 mt-0.5">
                            {item.publisher} &middot; {item.location} &middot;{' '}
                            {item.estimatedBootImpactMs !== null
                              ? `+${item.estimatedBootImpactMs}ms`
                              : 'Unavailable'}
                          </p>
                        </div>
                      </div>
                      <div className="shrink-0">
                        {isToggling ? (
                          <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
                        ) : item.enabled ? (
                          <ToggleRight
                            className="w-8 h-8 text-emerald-400 cursor-pointer hover:text-emerald-300 transition-colors"
                            onClick={() => toggleItem(item.id, false)}
                          />
                        ) : (
                          <ToggleLeft
                            className="w-8 h-8 text-slate-600 cursor-pointer hover:text-slate-400 transition-colors"
                            onClick={() => toggleItem(item.id, true)}
                          />
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: STEP 8 — Backups & Rollback UI */}
      {activeTab === 'backups' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-white">Startup Registry Backups</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Every toggle automatically creates a minimal single-value .reg backup. You can restore any item to its exact prior state.
              </p>
            </div>
            <button
              onClick={loadBackups}
              disabled={isLoadingBackups}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingBackups ? 'animate-spin' : ''}`} />
              Reload Backups
            </button>
          </div>

          {isLoadingBackups ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 text-cyan-500 animate-spin" />
            </div>
          ) : backups.length === 0 ? (
            <div className="p-8 text-center rounded-xl border border-slate-800 bg-slate-900/40 space-y-2">
              <History className="w-10 h-10 text-slate-600 mx-auto" />
              <p className="text-sm font-semibold text-slate-300">No startup backups found</p>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Backups are automatically created before modifying registry keys when you disable or enable items.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {backups.map((b) => {
                const isPlanningThis = isPlanningRestore === b.id;
                return (
                  <div
                    key={b.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl bg-slate-900/60 border border-slate-800 gap-4 hover:border-slate-700 transition-all"
                  >
                    <div className="flex items-start gap-3.5 min-w-0">
                      <div className="p-2.5 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shrink-0">
                        <FileText className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-bold text-slate-200 truncate">{b.itemName}</h3>
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-semibold bg-slate-800 text-cyan-300 border border-slate-700">
                            {b.hive}
                          </span>
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-mono text-slate-400 bg-slate-800/80">
                            {b.location}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-1 truncate">{b.changeSummary}</p>
                        <p className="text-[11px] text-slate-500 mt-0.5 font-mono truncate">
                          {new Date(b.timestamp).toLocaleString()} &middot; {Math.round(b.sizeBytes / 1024 * 10) / 10} KB &middot; {b.filePath}
                        </p>
                      </div>
                    </div>

                    <div className="shrink-0 self-end sm:self-center">
                      <button
                        type="button"
                        onClick={() => handleInitiateRestore(b.id)}
                        disabled={isPlanningThis || isExecutingRestore}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 hover:text-white text-slate-200 text-xs font-semibold border border-slate-700 transition-colors disabled:opacity-50"
                      >
                        {isPlanningThis ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <RotateCcw className="w-3.5 h-3.5 text-cyan-400" />
                        )}
                        Restore
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Phase 3 Destructive Framework: Step 2 Confirm Modal */}
      <AnimatePresence>
        {activePlan && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-5"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                    <RotateCcw className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-white">Confirm Registry Restore</h2>
                    <p className="text-xs text-slate-400">Phase 3 Destructive Operation Plan</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActivePlan(null)}
                  disabled={isExecutingRestore}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Planned changes summary */}
              <div className="space-y-3 rounded-xl bg-slate-950/60 border border-slate-800/80 p-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">Reversibility:</span>
                  <span className="font-semibold text-emerald-400 flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5" /> Reversible (atomic registry restore)
                  </span>
                </div>

                {activePlan.actions.map((act) => (
                  <div key={act.id} className="pt-2 border-t border-slate-800/80 space-y-1">
                    <p className="text-xs font-semibold text-slate-200">{act.description}</p>
                    {Boolean(act.metadata?.backupFilePath) && (
                      <p className="text-[10px] font-mono text-slate-500 truncate">
                        Source: {String(act.metadata?.backupFilePath)}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              {/* Elevation Notice */}
              {activePlan.requiresElevation && !isElevated && (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-center gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>
                    This backup modifies HKLM and requires administrator rights. Please restart DeskKlean as administrator.
                  </span>
                </div>
              )}

              {/* Safety notice */}
              <p className="text-xs text-slate-400">
                A safety snapshot of the current registry state will be created automatically before importing.
              </p>

              {restoreModalError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
                  {restoreModalError}
                </div>
              )}

              {/* Modal Buttons */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setActivePlan(null)}
                  disabled={isExecutingRestore}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>

                {activePlan.requiresElevation && !isElevated ? (
                  <button
                    type="button"
                    onClick={handleRelaunch}
                    disabled={isRelaunching}
                    className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-colors disabled:opacity-50"
                  >
                    {isRelaunching ? 'Restarting...' : 'Restart as Administrator'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleConfirmExecuteRestore}
                    disabled={isExecutingRestore}
                    className="flex items-center gap-2 px-5 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition-all shadow-lg disabled:opacity-50"
                  >
                    {isExecutingRestore ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                    Confirm & Restore
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
