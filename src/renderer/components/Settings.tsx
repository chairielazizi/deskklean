import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { api } from '../apiClient';
import { AppSettings, UpdaterStatus, CustomCleanRule, ScheduledCleanState } from '../../shared/types';
import { APP_VERSION, DEFAULT_SETTINGS } from '../../shared/constants';
import {
  Settings2,
  Loader2,
  Save,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Trash2,
  Palette,
  Shield,
  Clock,
  FolderOpen,
  RefreshCw,
  Download,
} from 'lucide-react';

export const Settings: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ success: boolean; message: string } | null>(null);
  const [updaterStatus, setUpdaterStatus] = useState<UpdaterStatus | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isDownloadingUpdate, setIsDownloadingUpdate] = useState(false);
  const [ruleErrors, setRuleErrors] = useState<Record<string, string>>({});
  const [ruleWarnings, setRuleWarnings] = useState<Record<string, string>>({});
  const [scheduledState, setScheduledState] = useState<ScheduledCleanState | null | undefined>(undefined);
  const [isScheduledLoading, setIsScheduledLoading] = useState(false);
  const [scheduledError, setScheduledError] = useState<string | null>(null);
  const [scheduledWarning, setScheduledWarning] = useState<string | null>(null);

  const loadSettings = async () => {
    setIsLoading(true);
    try {
      const result = await api.getSettings();
      setSettings(result);
    } catch (e) {
      console.error('Failed to load settings:', e);
    }
    setIsLoading(false);
  };

  const loadUpdaterStatus = async () => {
    try {
      const status = await api.getUpdaterStatus();
      setUpdaterStatus(status);
    } catch (e) {
      console.error('Failed to load updater status:', e);
    }
  };

  const handleCheckUpdates = async () => {
    setIsCheckingUpdate(true);
    try {
      const status = await api.checkForUpdates();
      setUpdaterStatus(status);
    } catch (e) {
      console.error('Check for updates failed:', e);
    }
    setIsCheckingUpdate(false);
  };

  const handleDownloadUpdate = async () => {
    setIsDownloadingUpdate(true);
    try {
      const status = await api.downloadUpdate();
      setUpdaterStatus(status);
    } catch (e) {
      console.error('Download update failed:', e);
    }
    setIsDownloadingUpdate(false);
  };

  const handleInstallUpdate = async () => {
    try {
      await api.installUpdate();
    } catch (e) {
      console.error('Install update failed:', e);
    }
  };

  const getUpdateStateLine = (status: UpdaterStatus | null): string => {
    if (!status) return 'Not checked yet';
    switch (status.state) {
      case 'idle':
        return 'Not checked yet';
      case 'disabled':
        return 'Automatic checks disabled';
      case 'checking':
        return 'Checking…';
      case 'available':
        return `Update ${status.availableVersion || ''} available`.trim();
      case 'not-available':
        if (status.lastCheckedAt) {
          const time = new Date(status.lastCheckedAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          });
          return `Up to date (checked ${time})`;
        }
        return 'Up to date';
      case 'downloading':
        return `Downloading update${status.availableVersion ? ` ${status.availableVersion}` : ''}…`;
      case 'downloaded':
        return `Update ${status.availableVersion || ''} downloaded — ready to install`.trim();
      case 'error':
        return `Update check failed: ${status.error || 'Unknown error'}`;
      case 'unavailable':
        if (
          status.error?.toLowerCase().includes('portable') ||
          status.message?.toLowerCase().includes('portable')
        ) {
          return 'Portable build — download the new version manually';
        }
        return status.error || status.message || 'Auto-update is unavailable in this build';
      default:
        return 'Not checked yet';
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setRuleErrors({});
    setRuleWarnings({});

    // 1. Validate custom rules before saving (Phase 17 §4: validation on save)
    const newErrors: Record<string, string> = {};
    const newWarnings: Record<string, string> = {};

    for (const rule of settings.customRules) {
      if (!rule.directoryPath.trim()) {
        newErrors[rule.id] = 'Directory path is required';
        continue;
      }
      try {
        const val = await api.validateCustomRule(rule);
        if (!val.ok) {
          newErrors[rule.id] = val.reason || 'Invalid rule configuration';
        } else if (val.warning) {
          newWarnings[rule.id] = val.warning;
        }
      } catch (e: any) {
        newErrors[rule.id] = e?.message || 'Validation error';
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setRuleErrors(newErrors);
      setRuleWarnings(newWarnings);
      setSaveResult({
        success: false,
        message: 'Please fix custom rule errors before saving',
      });
      setIsSaving(false);
      setTimeout(() => setSaveResult(null), 4000);
      return;
    }

    try {
      const result = await api.saveSettings(settings);
      if (!result.success && result.error) {
        setSaveResult({
          success: false,
          message: result.error,
        });
      } else {
        setSaveResult({
          success: result.success,
          message: result.success ? 'Settings saved successfully' : 'Failed to save settings',
        });
      }
    } catch (e) {
      setSaveResult({ success: false, message: 'Failed to save settings' });
    }
    setIsSaving(false);
    setTimeout(() => setSaveResult(null), 3000);
  };

  const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const addCustomRule = () => {
    if (settings.customRules.length >= 50) return;
    const newRule: CustomCleanRule = {
      id: `rule-${Date.now()}`,
      name: 'New Rule',
      directoryPath: '',
      filePattern: '*.tmp',
      recursive: true,
      enabled: true,
    };
    setSettings((prev) => ({
      ...prev,
      customRules: [...prev.customRules, newRule],
    }));
  };

  const updateCustomRule = (id: string, updates: Partial<CustomCleanRule>) => {
    setSettings((prev) => ({
      ...prev,
      customRules: prev.customRules.map((r) => (r.id === id ? { ...r, ...updates } : r)),
    }));
    if (ruleErrors[id]) {
      setRuleErrors((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const removeCustomRule = (id: string) => {
    setSettings((prev) => ({
      ...prev,
      customRules: prev.customRules.filter((r) => r.id !== id),
    }));
    if (ruleErrors[id] || ruleWarnings[id]) {
      setRuleErrors((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setRuleWarnings((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const loadScheduledState = async () => {
    try {
      if (api.getScheduledCleanState) {
        const state = await api.getScheduledCleanState();
        setScheduledState(state);
      }
    } catch (e) {
      console.error('Failed to load scheduled clean state:', e);
      setScheduledState(null);
    }
  };

  const handleToggleScheduled = async () => {
    if (scheduledState?.isPortable || isScheduledLoading) return;
    const targetEnabled = !settings.scheduledCleanEnabled;
    setIsScheduledLoading(true);
    setScheduledError(null);
    setScheduledWarning(null);

    try {
      const res = await api.setScheduledCleanEnabled({
        enabled: targetEnabled,
        frequency: settings.scheduledCleanFrequency,
      });

      if (res.success) {
        setSettings((prev) => ({ ...prev, scheduledCleanEnabled: res.enabled }));
        if (res.reason) {
          setScheduledWarning(res.reason);
        }
        await loadScheduledState();
      } else {
        setScheduledError(res.reason || 'Failed to update scheduled cleaning');
      }
    } catch (err: any) {
      setScheduledError(err?.message || 'Failed to update scheduled cleaning');
    } finally {
      setIsScheduledLoading(false);
    }
  };

  const handleFrequencyChange = async (newFreq: AppSettings['scheduledCleanFrequency']) => {
    if (scheduledState?.isPortable || isScheduledLoading) return;
    setIsScheduledLoading(true);
    setScheduledError(null);
    setScheduledWarning(null);

    try {
      const res = await api.setScheduledCleanEnabled({
        enabled: true,
        frequency: newFreq,
      });

      if (res.success) {
        setSettings((prev) => ({ ...prev, scheduledCleanFrequency: newFreq }));
        if (res.reason) {
          setScheduledWarning(res.reason);
        }
        await loadScheduledState();
      } else {
        setScheduledError(res.reason || 'Failed to update frequency');
      }
    } catch (err: any) {
      setScheduledError(err?.message || 'Failed to update frequency');
    } finally {
      setIsScheduledLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
    loadUpdaterStatus();
    loadScheduledState();

    const unsubscribe = api.onUpdaterStatus?.((status) => {
      setUpdaterStatus(status);
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-slate-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Settings</h1>
          <p className="text-sm text-slate-400 mt-1">
            Configure DeskKlean preferences and behavior
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-slate-950 font-bold text-sm shadow-lg transition-all disabled:opacity-50"
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {isSaving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      {/* Save Result */}
      {saveResult && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`p-4 rounded-xl border flex items-center gap-3 ${
            saveResult.success
              ? 'bg-emerald-500/10 border-emerald-500/30'
              : 'bg-rose-500/10 border-rose-500/30'
          }`}
        >
          {saveResult.success ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-rose-400" />
          )}
          <span className={`text-sm ${saveResult.success ? 'text-emerald-300' : 'text-rose-300'}`}>
            {saveResult.message}
          </span>
        </motion.div>
      )}

      {/* Appearance */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="p-5 rounded-xl bg-slate-900/60 border border-slate-800"
      >
        <h3 className="text-sm font-bold text-slate-200 mb-4 flex items-center gap-2">
          <Palette className="w-4 h-4 text-violet-400" /> Appearance
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="text-xs text-slate-400 block mb-2">Theme</label>
            <select
              value={settings.theme}
              onChange={(e) => updateSetting('theme', e.target.value as AppSettings['theme'])}
              className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-200 focus:outline-none focus:border-violet-500/50"
            >
              <option value="cyber-slate">Cyber Slate</option>
              <option value="deep-oled">Deep OLED</option>
              <option value="midnight-navy">Midnight Navy</option>
              <option value="amethyst">Amethyst</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-2">Accent Color</label>
            <select
              value={settings.accentColor}
              onChange={(e) => updateSetting('accentColor', e.target.value as AppSettings['accentColor'])}
              className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-200 focus:outline-none focus:border-violet-500/50"
            >
              <option value="emerald">Emerald</option>
              <option value="cyan">Cyan</option>
              <option value="violet">Violet</option>
              <option value="blue">Blue</option>
            </select>
          </div>
        </div>
      </motion.div>

      {/* Behavior */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="p-5 rounded-xl bg-slate-900/60 border border-slate-800"
      >
        <h3 className="text-sm font-bold text-slate-200 mb-4 flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-blue-400" /> Behavior
        </h3>
        <div className="space-y-4">
          {[
            { key: 'autoCheckUpdates', label: 'Check for updates automatically', desc: 'Periodically check for new versions' },
            { key: 'minimizeToTray', label: 'Minimize to system tray', desc: 'Keep running in background when minimized' },
            { key: 'closeToTray', label: 'Close to system tray', desc: 'Prevent accidental exit' },
            { key: 'runAtStartup', label: 'Run at Windows startup', desc: 'Launch DeskKlean when Windows starts' },
            { key: 'confirmBeforeDelete', label: 'Confirm before deleting files', desc: 'Show confirmation dialog before any deletion' },
            { key: 'autoRegistryBackup', label: 'Auto-backup registry before changes', desc: 'Create restore point before registry modifications' },
            { key: 'bypassRecycleBinWarning', label: 'Bypass recycle bin warning', desc: 'Skip confirmation when sending files to recycle bin' },
          ].map((item) => (
            <div key={item.key} className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-200">{item.label}</p>
                <p className="text-xs text-slate-500">{item.desc}</p>
              </div>
              <button
                onClick={() => updateSetting(item.key as keyof AppSettings, !settings[item.key as keyof AppSettings])}
                className={`w-10 h-6 rounded-full transition-all relative ${
                  settings[item.key as keyof AppSettings]
                    ? 'bg-emerald-500'
                    : 'bg-slate-700'
                }`}
              >
                <div
                  className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
                    settings[item.key as keyof AppSettings] ? 'left-5' : 'left-1'
                  }`}
                />
              </button>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Updates */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
        className="p-5 rounded-xl bg-slate-900/60 border border-slate-800"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-emerald-400" /> Updates
          </h3>
          <span className="text-xs font-mono text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700/60">
            v{APP_VERSION}
          </span>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-200">{getUpdateStateLine(updaterStatus)}</p>
              <p className="text-xs text-slate-500 mt-0.5">
                Current installed version: {APP_VERSION}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {updaterStatus?.state === 'available' && (
                <button
                  onClick={handleDownloadUpdate}
                  disabled={isDownloadingUpdate}
                  className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-medium transition-colors flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download
                </button>
              )}

              {updaterStatus?.state === 'downloaded' && (
                <button
                  onClick={handleInstallUpdate}
                  className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-medium transition-colors flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Install and restart
                </button>
              )}

              <button
                onClick={handleCheckUpdates}
                disabled={
                  updaterStatus?.state === 'checking' ||
                  updaterStatus?.state === 'downloading' ||
                  isCheckingUpdate
                }
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-medium border border-slate-700 transition-colors flex items-center gap-1.5"
              >
                {updaterStatus?.state === 'checking' || isCheckingUpdate ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-400" />
                    Checking…
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 text-slate-400" />
                    Check now
                  </>
                )}
              </button>
            </div>
          </div>

          {updaterStatus?.progressPercent !== null && updaterStatus?.progressPercent !== undefined && (
            <div className="space-y-1.5 pt-2 border-t border-slate-800/80">
              <div className="flex justify-between text-xs text-slate-400">
                <span>Downloading update…</span>
                <span>{Math.round(updaterStatus.progressPercent)}%</span>
              </div>
              <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all duration-200"
                  style={{ width: `${Math.min(100, Math.max(0, updaterStatus.progressPercent))}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </motion.div>

      {/* Scheduled Cleaning */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="p-5 rounded-xl bg-slate-900/60 border border-slate-800"
      >
        <h3 className="text-sm font-bold text-slate-200 mb-4 flex items-center gap-2">
          <Clock className="w-4 h-4 text-amber-400" /> Scheduled Cleaning
        </h3>
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-sm text-slate-200">Enable scheduled cleaning</p>
            <p className="text-xs text-slate-500">Automatically clean junk files on a schedule</p>
          </div>
          <button
            onClick={handleToggleScheduled}
            disabled={Boolean(scheduledState?.isPortable) || isScheduledLoading}
            className={`w-10 h-6 rounded-full transition-all relative ${
              Boolean(scheduledState?.isPortable)
                ? 'opacity-50 cursor-not-allowed bg-slate-800'
                : isScheduledLoading
                ? 'opacity-70 cursor-wait bg-slate-700'
                : settings.scheduledCleanEnabled
                ? 'bg-emerald-500 hover:bg-emerald-600'
                : 'bg-slate-700 hover:bg-slate-600'
            }`}
            title={
              scheduledState?.isPortable
                ? 'Portable builds cannot be scheduled'
                : settings.scheduledCleanEnabled
                ? 'Disable scheduled cleaning'
                : 'Enable scheduled cleaning'
            }
          >
            <div
              className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
                settings.scheduledCleanEnabled && !scheduledState?.isPortable ? 'left-5' : 'left-1'
              }`}
            />
          </button>
        </div>

        {/* Status Line */}
        <div className="text-xs mt-2">
          {scheduledState === undefined ? (
            <span className="text-slate-500 flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" /> Checking schedule state...
            </span>
          ) : scheduledState === null ? (
            <span className="text-red-400 flex items-center gap-1.5">
              <AlertTriangle className="w-3 h-3" /> Could not read scheduled task state
            </span>
          ) : scheduledState.isPortable ? (
            <span className="text-amber-400">
              Portable builds cannot be scheduled — the executable runs from a temp directory
            </span>
          ) : !scheduledState.registered ? (
            <span className="text-slate-400">Not scheduled</span>
          ) : (
            <span className="text-emerald-400">
              Next run:{' '}
              {scheduledState.nextRun
                ? new Date(scheduledState.nextRun).toLocaleString()
                : 'Pending'}
              {scheduledState.lastRun && (
                <span className="text-slate-400">
                  {' · '}Last run: {new Date(scheduledState.lastRun).toLocaleString()}
                  {scheduledState.lastResult !== null ? ` (code ${scheduledState.lastResult})` : ''}
                </span>
              )}
            </span>
          )}
        </div>

        {/* Inline Error Banner */}
        {scheduledError && (
          <div className="p-3 mt-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400 flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            <span>{scheduledError}</span>
          </div>
        )}

        {/* Inline Warning Banner */}
        {scheduledWarning && (
          <div className="p-3 mt-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-400 flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            <span>{scheduledWarning}</span>
          </div>
        )}

        {/* Frequency Selector */}
        {settings.scheduledCleanEnabled && !scheduledState?.isPortable && (
          <div className="mt-4 pt-4 border-t border-slate-800">
            <label className="text-xs text-slate-400 block mb-2">Frequency</label>
            <select
              value={settings.scheduledCleanFrequency}
              onChange={(e) =>
                handleFrequencyChange(e.target.value as AppSettings['scheduledCleanFrequency'])
              }
              disabled={isScheduledLoading}
              className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-200 focus:outline-none focus:border-amber-500/50 disabled:opacity-50"
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly (Sundays)</option>
              <option value="monthly">Monthly (1st of month)</option>
            </select>
            <p className="text-[11px] text-slate-500 mt-2">
              Runs unattended using Windows Task Scheduler (missed runs start at next opportunity).
            </p>
          </div>
        )}
      </motion.div>

      {/* Custom Clean Rules */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="p-5 rounded-xl bg-slate-900/60 border border-slate-800"
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
              <FolderOpen className="w-4 h-4 text-emerald-400" /> Custom Clean Rules
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Custom rules active: {settings.customRules.filter((r) => r.enabled !== false).length}
            </p>
          </div>
          <button
            onClick={addCustomRule}
            disabled={settings.customRules.length >= 50}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-xs font-medium border border-emerald-500/30 transition-colors disabled:opacity-50"
          >
            <Plus className="w-3 h-3" /> Add Rule
          </button>
        </div>
        {settings.customRules.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-4">No custom rules configured</p>
        ) : (
          <div className="space-y-3">
            {settings.customRules.map((rule) => (
              <div
                key={rule.id}
                className={`p-3.5 rounded-lg border transition-all ${
                  ruleErrors[rule.id]
                    ? 'bg-rose-950/20 border-rose-800/60'
                    : 'bg-slate-800/50 border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-3 mb-2.5">
                  <div className="flex items-center gap-2 flex-wrap flex-1">
                    <input
                      type="text"
                      value={rule.name}
                      onChange={(e) => updateCustomRule(rule.id, { name: e.target.value })}
                      placeholder="Rule Name"
                      className="px-2.5 py-1 rounded bg-slate-900 border border-slate-700 text-xs font-semibold text-slate-200 focus:outline-none focus:border-emerald-500/50 w-44"
                    />
                    <span className="text-[11px] text-amber-400/90 italic bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                      User-defined rule — not vetted by Microsoft
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => updateCustomRule(rule.id, { enabled: !rule.enabled })}
                        className={`w-10 h-6 rounded-full transition-all relative ${
                          rule.enabled ? 'bg-emerald-500' : 'bg-slate-700'
                        }`}
                        title={rule.enabled ? 'Disable rule' : 'Enable rule'}
                      >
                        <div
                          className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
                            rule.enabled ? 'left-5' : 'left-1'
                          }`}
                        />
                      </button>
                      <span className="text-xs text-slate-400 font-medium w-7">
                        {rule.enabled ? 'On' : 'Off'}
                      </span>
                    </div>
                    <button
                      onClick={() => removeCustomRule(rule.id)}
                      className="p-1 rounded-lg hover:bg-rose-500/10 text-slate-400 hover:text-rose-400 transition-colors"
                      title="Delete rule"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Directory Path</label>
                    <input
                      type="text"
                      value={rule.directoryPath}
                      onChange={(e) => updateCustomRule(rule.id, { directoryPath: e.target.value })}
                      placeholder="%LOCALAPPDATA%\DeskKleanRuleTest (required)"
                      className={`w-full px-2.5 py-1.5 rounded bg-slate-900 border text-xs font-mono text-slate-200 focus:outline-none ${
                        !rule.directoryPath.trim() || ruleErrors[rule.id]
                          ? 'border-amber-500/50 focus:border-amber-500'
                          : 'border-slate-700 focus:border-emerald-500/50'
                      }`}
                    />
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="text-[11px] text-slate-400 block mb-1">File Pattern</label>
                      <input
                        type="text"
                        value={rule.filePattern}
                        onChange={(e) => updateCustomRule(rule.id, { filePattern: e.target.value })}
                        placeholder="*.tmp"
                        className="w-full px-2.5 py-1.5 rounded bg-slate-900 border border-slate-700 text-xs font-mono text-slate-200 focus:outline-none focus:border-emerald-500/50"
                      />
                    </div>
                    <div className="flex flex-col justify-end">
                      <label className="flex items-center gap-1.5 py-1.5 cursor-pointer text-slate-300">
                        <input
                          type="checkbox"
                          checked={rule.recursive}
                          onChange={(e) => updateCustomRule(rule.id, { recursive: e.target.checked })}
                          className="rounded border-slate-700 text-emerald-500 focus:ring-0 bg-slate-900"
                        />
                        <span className="text-xs">Recursive</span>
                      </label>
                    </div>
                  </div>
                </div>

                {!rule.directoryPath.trim() && !ruleErrors[rule.id] && (
                  <p className="text-[11px] text-amber-400/80 mt-1.5">Directory path is required</p>
                )}

                {ruleErrors[rule.id] && (
                  <div className="flex items-center gap-1.5 text-xs text-rose-400 mt-2 bg-rose-500/10 px-2.5 py-1.5 rounded border border-rose-500/20">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>{ruleErrors[rule.id]}</span>
                  </div>
                )}

                {ruleWarnings[rule.id] && !ruleErrors[rule.id] && (
                  <div className="flex items-center gap-1.5 text-xs text-amber-400 mt-2 bg-amber-500/10 px-2.5 py-1.5 rounded border border-amber-500/20">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>{ruleWarnings[rule.id]}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </motion.div>

      {/* Security */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="p-5 rounded-xl bg-slate-900/60 border border-slate-800"
      >
        <h3 className="text-sm font-bold text-slate-200 mb-4 flex items-center gap-2">
          <Shield className="w-4 h-4 text-rose-400" /> Security & Privacy
        </h3>
        <div className="space-y-3">
          <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700">
            <p className="text-sm text-slate-200">No telemetry or data collection</p>
            <p className="text-xs text-slate-500">DeskKlean is fully offline. No data is sent to external servers.</p>
          </div>
          <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700">
            <p className="text-sm text-slate-200">Sandboxed scanning</p>
            <p className="text-xs text-slate-500">All scans are read-only. No changes are made without your explicit approval.</p>
          </div>
          <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700">
            <p className="text-sm text-slate-200">UAC elevation only when needed</p>
            <p className="text-xs text-slate-500">Administrator privileges are only requested for registry, startup, and uninstall operations.</p>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
