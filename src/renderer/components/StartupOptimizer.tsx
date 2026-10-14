import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { api } from '../apiClient';
import { StartupItem } from '../../shared/types';
import {
  Zap,
  Loader2,
  Clock,
  ToggleLeft,
  ToggleRight,
  AlertTriangle,
  Rocket,
  HardDrive,
} from 'lucide-react';

const IMPACT_COLORS: Record<string, { bg: string; text: string; bar: string }> = {
  high: { bg: 'bg-rose-500/10', text: 'text-rose-400', bar: 'bg-rose-500' },
  medium: { bg: 'bg-amber-500/10', text: 'text-amber-400', bar: 'bg-amber-500' },
  low: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', bar: 'bg-emerald-500' },
  none: { bg: 'bg-slate-500/10', text: 'text-slate-400', bar: 'bg-slate-500' },
};

export const StartupOptimizer: React.FC = () => {
  const [items, setItems] = useState<StartupItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const loadItems = async () => {
    setIsLoading(true);
    try {
      const result = await api.getStartupItems();
      setItems(result);
    } catch (e) {
      console.error('Failed to load startup items:', e);
    }
    setIsLoading(false);
  };

  const toggleItem = async (id: string, enabled: boolean) => {
    setTogglingId(id);
    try {
      await api.toggleStartupItem(id, enabled);
      setItems((prev) =>
        prev.map((i) => (i.id === id ? { ...i, enabled } : i))
      );
    } catch (e) {
      console.error('Toggle failed:', e);
    }
    setTogglingId(null);
  };

  useEffect(() => {
    loadItems();
  }, []);

  const enabledCount = items.filter((i) => i.enabled).length;
  const highImpactCount = items.filter((i) => i.impact === 'high' && i.enabled).length;
  const totalBootImpact = items
    .filter((i) => i.enabled)
    .reduce((sum, i) => sum + i.estimatedBootImpactMs, 0);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Startup Optimizer</h1>
        <p className="text-sm text-slate-400 mt-1">
          Manage programs that launch at startup to speed up boot time
        </p>
      </div>

      {/* Summary */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800/80 p-6"
      >
        <div className="absolute top-0 right-0 w-64 h-64 bg-rose-500/10 rounded-full blur-3xl pointer-events-none -mr-12 -mt-12" />
        <div className="relative z-10 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30">
              <Rocket className="w-6 h-6 text-rose-400" />
            </div>
            <div>
              <p className="text-2xl font-black text-white font-mono">{enabledCount}</p>
              <p className="text-xs text-slate-400">Active startup items</p>
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
        </div>
      </motion.div>

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
                        {item.publisher} &middot; {item.location} &middot; +{item.estimatedBootImpactMs}ms
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
  );
};
