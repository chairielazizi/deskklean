import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { api } from '../apiClient';
import { AppSettings } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/constants';
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
} from 'lucide-react';

export const Settings: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ success: boolean; message: string } | null>(null);

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

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const result = await api.saveSettings(settings);
      setSaveResult({
        success: result.success,
        message: result.success ? 'Settings saved successfully' : 'Failed to save settings',
      });
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
    const newRule = {
      id: `rule-${Date.now()}`,
      name: 'New Rule',
      directoryPath: 'C:\\',
      filePattern: '*.tmp',
      recursive: true,
      enabled: true,
    };
    setSettings((prev) => ({
      ...prev,
      customRules: [...prev.customRules, newRule],
    }));
  };

  const removeCustomRule = (id: string) => {
    setSettings((prev) => ({
      ...prev,
      customRules: prev.customRules.filter((r) => r.id !== id),
    }));
  };

  useEffect(() => {
    loadSettings();
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
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm text-slate-200">Enable scheduled cleaning</p>
            <p className="text-xs text-slate-500">Automatically clean junk files on a schedule</p>
          </div>
          <button
            onClick={() => updateSetting('scheduledCleanEnabled', !settings.scheduledCleanEnabled)}
            className={`w-10 h-6 rounded-full transition-all relative ${
              settings.scheduledCleanEnabled ? 'bg-emerald-500' : 'bg-slate-700'
            }`}
          >
            <div
              className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
                settings.scheduledCleanEnabled ? 'left-5' : 'left-1'
              }`}
            />
          </button>
        </div>
        {settings.scheduledCleanEnabled && (
          <div>
            <label className="text-xs text-slate-400 block mb-2">Frequency</label>
            <select
              value={settings.scheduledCleanFrequency}
              onChange={(e) => updateSetting('scheduledCleanFrequency', e.target.value as AppSettings['scheduledCleanFrequency'])}
              className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-200 focus:outline-none focus:border-amber-500/50"
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
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
          <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-emerald-400" /> Custom Clean Rules
          </h3>
          <button
            onClick={addCustomRule}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-xs font-medium border border-emerald-500/30 transition-colors"
          >
            <Plus className="w-3 h-3" /> Add Rule
          </button>
        </div>
        {settings.customRules.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-4">No custom rules configured</p>
        ) : (
          <div className="space-y-2">
            {settings.customRules.map((rule) => (
              <div
                key={rule.id}
                className="flex items-center justify-between p-3 rounded-lg bg-slate-800/50 border border-slate-700"
              >
                <div>
                  <p className="text-sm text-slate-200">{rule.name}</p>
                  <p className="text-xs text-slate-500 font-mono">{rule.directoryPath} &middot; {rule.filePattern}</p>
                </div>
                <button
                  onClick={() => removeCustomRule(rule.id)}
                  className="p-1.5 rounded-lg hover:bg-rose-500/10 text-slate-400 hover:text-rose-400 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
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
