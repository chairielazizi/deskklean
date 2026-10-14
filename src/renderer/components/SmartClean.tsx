import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { api } from '../apiClient';
import { SmartCleanScanResult, SmartCleanResult, CleanItemCategory } from '../../shared/types';
import { formatBytes } from '../utils/format';
import {
  Sparkles,
  Trash2,
  RefreshCw,
  CheckCircle2,
  Loader2,
  Monitor,
  Globe,
  HardDrive,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

const CATEGORY_META: Record<CleanItemCategory, { label: string; icon: React.ReactNode; color: string }> = {
  windows: { label: 'Windows System', icon: <Monitor className="w-4 h-4" />, color: 'text-blue-400' },
  browser: { label: 'Web Browsers', icon: <Globe className="w-4 h-4" />, color: 'text-emerald-400' },
  application: { label: 'Applications', icon: <HardDrive className="w-4 h-4" />, color: 'text-violet-400' },
};

export const SmartClean: React.FC = () => {
  const [scanResult, setScanResult] = useState<SmartCleanScanResult | null>(null);
  const [cleanResult, setCleanResult] = useState<SmartCleanResult | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['windows', 'browser', 'application']));

  const runScan = async () => {
    setIsScanning(true);
    setCleanResult(null);
    try {
      const result = await api.scanSmartClean(['windows', 'browser', 'application']);
      setScanResult(result);
    } catch (e) {
      console.error('Smart clean scan failed:', e);
    }
    setIsScanning(false);
  };

  const handleClean = async () => {
    if (!scanResult) return;
    const selected = scanResult.items.filter((i) => i.enabled).map((i) => i.id);
    if (selected.length === 0) return;

    setIsCleaning(true);
    try {
      const result = await api.executeSmartClean(selected);
      setCleanResult(result);
      await runScan();
    } catch (e) {
      console.error('Clean failed:', e);
    }
    setIsCleaning(false);
  };

  useEffect(() => {
    runScan();
  }, []);

  const toggleCategory = (cat: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const toggleItem = (id: string) => {
    if (!scanResult) return;
    setScanResult({
      ...scanResult,
      items: scanResult.items.map((i) => (i.id === id ? { ...i, enabled: !i.enabled } : i)),
    });
  };

  const groupedItems = scanResult?.items.reduce(
    (acc, item) => {
      if (!acc[item.category]) acc[item.category] = [];
      acc[item.category].push(item);
      return acc;
    },
    {} as Record<string, typeof scanResult.items>
  ) || {};

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Smart Clean</h1>
          <p className="text-sm text-slate-400 mt-1">
            Clean junk files, browser caches, and application leftovers
          </p>
        </div>
        <button
          onClick={runScan}
          disabled={isScanning}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium border border-slate-700 transition-all disabled:opacity-50"
        >
          {isScanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {isScanning ? 'Scanning...' : 'Scan Again'}
        </button>
      </div>

      {/* Summary Banner */}
      {scanResult && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800/80 p-6"
        >
          <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none -mr-12 -mt-12" />
          <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div>
              <h2 className="text-lg font-bold text-white">
                {formatBytes(scanResult.totalSizeBytes)} of junk files found
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                {scanResult.totalItemCount} items across {scanResult.items.length} categories
              </p>
            </div>
            <button
              onClick={handleClean}
              disabled={isCleaning || !scanResult.items.some((i) => i.enabled)}
              className="flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-slate-950 font-bold text-sm shadow-lg shadow-emerald-950/40 transition-all disabled:opacity-50"
            >
              {isCleaning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              {isCleaning ? 'Cleaning...' : 'Clean All'}
            </button>
          </div>
          {cleanResult && (
            <div className="mt-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span className="text-sm text-emerald-300">
                Cleaned {formatBytes(cleanResult.cleanedSizeBytes)} ({cleanResult.cleanedItemCount} files)
              </span>
            </div>
          )}
        </motion.div>
      )}

      {/* Category Groups */}
      {isScanning && !scanResult ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(groupedItems).map(([category, items]) => {
            const meta = CATEGORY_META[category as CleanItemCategory];
            const isExpanded = expandedCategories.has(category);
            const catTotal = items.reduce((sum, i) => sum + i.sizeBytes, 0);
            return (
              <motion.div
                key={category}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="rounded-xl bg-slate-900/60 border border-slate-800 overflow-hidden"
              >
                <button
                  onClick={() => toggleCategory(category)}
                  className="w-full flex items-center justify-between p-4 hover:bg-slate-800/40 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg bg-slate-800 ${meta.color}`}>{meta.icon}</div>
                    <div className="text-left">
                      <h3 className="text-sm font-semibold text-slate-200">{meta.label}</h3>
                      <p className="text-xs text-slate-400">
                        {items.length} categories &middot; {formatBytes(catTotal)}
                      </p>
                    </div>
                  </div>
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-slate-400" />
                  )}
                </button>
                {isExpanded && (
                  <div className="border-t border-slate-800 divide-y divide-slate-800/60">
                    {items.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between px-4 py-3 hover:bg-slate-800/30 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={item.enabled}
                            onChange={() => toggleItem(item.id)}
                            className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-emerald-500 focus:ring-emerald-500/30"
                          />
                          <div>
                            <h4 className="text-sm font-medium text-slate-200">{item.name}</h4>
                            <p className="text-xs text-slate-500">{item.description}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 text-xs">
                          <span className="text-slate-400">{item.itemCount} files</span>
                          <span className="font-mono text-emerald-400 font-bold">
                            {formatBytes(item.sizeBytes)}
                          </span>
                        </div>
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
