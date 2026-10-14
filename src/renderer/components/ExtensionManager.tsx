import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { api } from '../apiClient';
import { BrowserExtension, BrowserType } from '../../shared/types';
import {
  Puzzle,
  Loader2,
  Globe,
  ToggleLeft,
  ToggleRight,
  Trash2,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
} from 'lucide-react';

const BROWSER_TABS: { id: BrowserType; label: string }[] = [
  { id: 'chrome', label: 'Chrome' },
  { id: 'edge', label: 'Edge' },
  { id: 'firefox', label: 'Firefox' },
  { id: 'brave', label: 'Brave' },
];

const RISK_ICONS: Record<string, React.ReactNode> = {
  safe: <ShieldCheck className="w-4 h-4 text-emerald-400" />,
  moderate: <ShieldQuestion className="w-4 h-4 text-amber-400" />,
  high: <ShieldAlert className="w-4 h-4 text-rose-400" />,
};

export const ExtensionManager: React.FC = () => {
  const [extensions, setExtensions] = useState<BrowserExtension[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<BrowserType>('chrome');
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const loadExtensions = async (browser?: BrowserType) => {
    setIsLoading(true);
    try {
      const result = await api.getBrowserExtensions(browser);
      setExtensions(result);
    } catch (e) {
      console.error('Failed to load extensions:', e);
    }
    setIsLoading(false);
  };

  const toggleExtension = async (id: string, enabled: boolean) => {
    setTogglingId(id);
    try {
      await api.toggleExtension(id, enabled);
      setExtensions((prev) =>
        prev.map((e) => (e.id === id ? { ...e, enabled } : e))
      );
    } catch (e) {
      console.error('Toggle failed:', e);
    }
    setTogglingId(null);
  };

  const removeExtension = async (id: string) => {
    try {
      await api.removeExtension(id);
      setExtensions((prev) => prev.filter((e) => e.id !== id));
    } catch (e) {
      console.error('Remove failed:', e);
    }
  };

  useEffect(() => {
    loadExtensions(activeTab);
  }, [activeTab]);

  const enabledCount = extensions.filter((e) => e.enabled).length;
  const highRiskCount = extensions.filter((e) => e.riskLevel === 'high').length;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Extension Manager</h1>
        <p className="text-sm text-slate-400 mt-1">
          Manage browser extensions: enable, disable, or remove
        </p>
      </div>

      {/* Summary */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800/80 p-6"
      >
        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl pointer-events-none -mr-12 -mt-12" />
        <div className="relative z-10 flex items-center gap-5">
          <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/30">
            <Puzzle className="w-6 h-6 text-blue-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">{extensions.length} Extensions</h2>
            <p className="text-sm text-slate-400 mt-1">
              {enabledCount} enabled &middot; {highRiskCount} high risk
            </p>
          </div>
        </div>
      </motion.div>

      {/* Browser Tabs */}
      <div className="flex items-center gap-2">
        {BROWSER_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.id
                ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700'
            }`}
          >
            <Globe className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Extensions List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        </div>
      ) : (
        <div className="space-y-2">
          {extensions.map((ext, idx) => {
            const isToggling = togglingId === ext.id;
            return (
              <motion.div
                key={ext.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.03 }}
                className={`p-4 rounded-xl border transition-all ${
                  ext.enabled
                    ? 'bg-slate-900/60 border-slate-800'
                    : 'bg-slate-900/30 border-slate-800/50 opacity-60'
                }`}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400 shrink-0">
                      <Puzzle className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-slate-200 truncate">{ext.name}</h3>
                        {RISK_ICONS[ext.riskLevel]}
                        <span className="text-[10px] text-slate-500">v{ext.version}</span>
                      </div>
                      <p className="text-xs text-slate-500 truncate">{ext.description}</p>
                      <div className="flex items-center gap-1 mt-1">
                        {ext.permissions.slice(0, 3).map((p) => (
                          <span key={p} className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-400">
                            {p}
                          </span>
                        ))}
                        {ext.permissions.length > 3 && (
                          <span className="text-[10px] text-slate-500">
                            +{ext.permissions.length - 3} more
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {isToggling ? (
                      <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
                    ) : ext.enabled ? (
                      <ToggleRight
                        className="w-8 h-8 text-emerald-400 cursor-pointer hover:text-emerald-300 transition-colors"
                        onClick={() => toggleExtension(ext.id, false)}
                      />
                    ) : (
                      <ToggleLeft
                        className="w-8 h-8 text-slate-600 cursor-pointer hover:text-slate-400 transition-colors"
                        onClick={() => toggleExtension(ext.id, true)}
                      />
                    )}
                    <button
                      onClick={() => removeExtension(ext.id)}
                      className="p-2 rounded-lg hover:bg-rose-500/10 text-slate-400 hover:text-rose-400 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
};
