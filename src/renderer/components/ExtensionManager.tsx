import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { api } from '../apiClient';
import { ExtensionItem, BrowserId, ExtensionScanResult } from '../../shared/types';
import {
  Puzzle,
  Loader2,
  Globe,
  RefreshCw,
  ExternalLink,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  AlertTriangle,
  Info,
  Clock,
} from 'lucide-react';

const BROWSER_TABS: { id: BrowserId; label: string }[] = [
  { id: 'chrome', label: 'Chrome' },
  { id: 'edge', label: 'Edge' },
  { id: 'brave', label: 'Brave' },
  { id: 'firefox', label: 'Firefox' },
];

const RISK_ICONS: Record<string, React.ReactNode> = {
  safe: <ShieldCheck className="w-4 h-4 text-emerald-400" />,
  moderate: <ShieldQuestion className="w-4 h-4 text-amber-400" />,
  high: <ShieldAlert className="w-4 h-4 text-rose-400" />,
};

export const ExtensionManager: React.FC = () => {
  const [scanResult, setScanResult] = useState<ExtensionScanResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRescanning, setIsRescanning] = useState(false);
  const [isOpeningPage, setIsOpeningPage] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<BrowserId>('chrome');

  const loadExtensions = async (forceRescan = false) => {
    if (forceRescan) {
      setIsRescanning(true);
    } else {
      setIsLoading(true);
    }
    setOpenError(null);

    try {
      const result = forceRescan
        ? await api.rescanExtensions()
        : await api.getBrowserExtensions();
      setScanResult(result);
    } catch (e) {
      console.error('Failed to load extensions:', e);
    } finally {
      setIsLoading(false);
      setIsRescanning(false);
    }
  };

  useEffect(() => {
    loadExtensions(false);
  }, []);

  const handleOpenPage = async (browser: BrowserId) => {
    setIsOpeningPage(true);
    setOpenError(null);
    try {
      const result = await api.openExtensionPage(browser);
      if (!result.success) {
        setOpenError(result.reason || `Failed to open ${browser} extensions page`);
      }
    } catch (err: any) {
      setOpenError(err?.message || String(err));
    } finally {
      setIsOpeningPage(false);
    }
  };

  const allExtensions = scanResult?.extensions || [];
  const activeBrowserStatus = scanResult?.browsers[activeTab];
  const activeExtensions = allExtensions.filter((e) => e.browser === activeTab);

  const enabledCount = activeExtensions.filter((e) => e.enabled === true).length;
  const disabledCount = activeExtensions.filter((e) => e.enabled === false).length;
  const unknownCount = activeExtensions.filter((e) => e.enabled === null).length;
  const highRiskCount = activeExtensions.filter((e) => e.riskLevel === 'high').length;

  const scannedAtDate = scanResult?.scannedAt ? new Date(scanResult.scannedAt) : null;
  const isStale = scannedAtDate ? Date.now() - scannedAtDate.getTime() > 120_000 : false;

  const formatInstallDate = (dateStr: string | null) => {
    if (!dateStr) return 'Date unknown';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return 'Date unknown';
      return d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return 'Date unknown';
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Extension Manager</h1>
          <p className="text-sm text-slate-400 mt-1">
            Read-only extension audit across installed web browsers
          </p>
        </div>

        <div className="flex items-center gap-3">
          {scannedAtDate && (
            <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-900/60 px-3 py-1.5 rounded-lg border border-slate-800">
              <Clock className="w-3.5 h-3.5 text-slate-500" />
              <span>
                Last scanned: {scannedAtDate.toLocaleTimeString()}
                {isStale && (
                  <span className="ml-1.5 text-amber-400 font-semibold">(Cached)</span>
                )}
              </span>
            </div>
          )}

          <button
            onClick={() => loadExtensions(true)}
            disabled={isLoading || isRescanning}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-blue-500/20 text-blue-300 border border-blue-500/40 hover:bg-blue-500/30 transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRescanning ? 'animate-spin' : ''}`} />
            {isRescanning ? 'Rescanning...' : 'Re-scan'}
          </button>
        </div>
      </div>

      {/* Security & Integrity Architecture Banner */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-slate-900/40 border border-slate-800/80 text-xs text-slate-400">
        <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
        <p>
          <strong className="text-slate-300">Read-Only Integrity:</strong> DeskKlean does not modify or remove extensions directly.
          External edits tamper with HMAC-signed Preferences in Chromium and trigger rebuilds in Firefox.
          To toggle or remove an extension safely, click <span className="text-blue-300">"Manage in Browser"</span> to use the browser's native manager.
        </p>
      </div>

      {/* Summary Banner */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800/80 p-6"
      >
        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl pointer-events-none -mr-12 -mt-12" />
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-5">
          <div className="flex items-center gap-5">
            <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/30">
              <Puzzle className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">
                {activeExtensions.length} Extensions in {BROWSER_TABS.find((t) => t.id === activeTab)?.label}
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                {enabledCount} enabled &middot; {disabledCount} disabled
                {unknownCount > 0 && ` \u00b7 ${unknownCount} unknown`}
                {highRiskCount > 0 && (
                  <span className="text-rose-400 font-medium">
                    {' '}&middot; {highRiskCount} high risk
                  </span>
                )}
              </p>
            </div>
          </div>

          {activeBrowserStatus?.installed && activeBrowserStatus?.available && (
            <button
              onClick={() => handleOpenPage(activeTab)}
              disabled={isOpeningPage}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/20 transition-all disabled:opacity-50 shrink-0"
            >
              {isOpeningPage ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ExternalLink className="w-4 h-4" />
              )}
              Manage in {BROWSER_TABS.find((t) => t.id === activeTab)?.label}
            </button>
          )}
        </div>
      </motion.div>

      {/* Browser Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {BROWSER_TABS.map((tab) => {
          const status = scanResult?.browsers[tab.id];
          const isInstalled = status?.installed;
          const count = allExtensions.filter((e) => e.browser === tab.id).length;

          return (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                setOpenError(null);
              }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700'
              }`}
            >
              <Globe className="w-4 h-4" />
              <span>{tab.label}</span>
              {isInstalled ? (
                <span className="px-1.5 py-0.2 rounded text-[11px] bg-slate-900/70 text-slate-300 border border-slate-700/50">
                  {count}
                </span>
              ) : (
                <span className="text-[10px] text-slate-500 italic">
                  (Not installed)
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Deep Link Launch Error Notice */}
      {openError && (
        <div className="flex items-center justify-between p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <span>{openError}</span>
          </div>
          <button
            onClick={() => setOpenError(null)}
            className="text-xs text-rose-400 hover:text-rose-200 underline ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Content Area */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          <p className="text-xs text-slate-400">Scanning browser profiles and preferences...</p>
        </div>
      ) : !activeBrowserStatus?.installed ? (
        /* Browser Not Installed */
        <div className="p-12 text-center rounded-2xl border border-slate-800/60 bg-slate-900/30 space-y-3">
          <Globe className="w-10 h-10 text-slate-600 mx-auto" />
          <h3 className="text-base font-semibold text-slate-300">
            {BROWSER_TABS.find((t) => t.id === activeTab)?.label} is not installed
          </h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            No profile directory found for this browser on your machine.
          </p>
        </div>
      ) : !activeBrowserStatus?.available ? (
        /* Browser Installed But Unavailable (Honest Reporting) */
        <div className="p-8 rounded-2xl border border-amber-500/30 bg-amber-500/10 space-y-3">
          <div className="flex items-center gap-3 text-amber-300">
            <AlertTriangle className="w-6 h-6 shrink-0" />
            <h3 className="text-base font-semibold">
              {BROWSER_TABS.find((t) => t.id === activeTab)?.label} profiles cannot be read
            </h3>
          </div>
          <p className="text-sm text-slate-300">
            {activeBrowserStatus.reason || 'Failed to read extension preferences from browser profile directory.'}
          </p>
          <p className="text-xs text-slate-400">
            DeskKlean avoids displaying an empty list when files cannot be read. You can still manage extensions directly in the browser:
          </p>
          <div className="pt-2">
            <button
              onClick={() => handleOpenPage(activeTab)}
              disabled={isOpeningPage}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-amber-500/20 text-amber-200 border border-amber-500/40 hover:bg-amber-500/30 transition-all"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open {BROWSER_TABS.find((t) => t.id === activeTab)?.label} Settings
            </button>
          </div>
        </div>
      ) : activeExtensions.length === 0 ? (
        /* Installed and Available, But No Extensions */
        <div className="p-12 text-center rounded-2xl border border-slate-800/60 bg-slate-900/30 space-y-3">
          <Puzzle className="w-10 h-10 text-slate-600 mx-auto" />
          <h3 className="text-base font-semibold text-slate-300">
            No extensions installed in {BROWSER_TABS.find((t) => t.id === activeTab)?.label}
          </h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            No active or installed extensions were found in the scanned profile(s).
          </p>
        </div>
      ) : (
        /* Extensions List */
        <div className="space-y-2.5">
          {activeExtensions.map((ext, idx) => (
            <motion.div
              key={`${ext.browser}-${ext.id}-${ext.profilePath}`}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: Math.min(idx * 0.02, 0.4) }}
              className={`p-4 rounded-xl border transition-all ${
                ext.enabled === true
                  ? 'bg-slate-900/60 border-slate-800'
                  : ext.enabled === false
                  ? 'bg-slate-900/30 border-slate-800/50 opacity-75'
                  : 'bg-slate-900/40 border-slate-800/60'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-4 min-w-0">
                  <div className="p-2.5 rounded-lg bg-blue-500/10 text-blue-400 shrink-0 mt-0.5">
                    <Puzzle className="w-5 h-5" />
                  </div>
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold text-slate-200 truncate">
                        {ext.name}
                      </h3>
                      {ext.riskLevel && RISK_ICONS[ext.riskLevel]}
                      {ext.version && (
                        <span className="text-[10px] text-slate-500">v{ext.version}</span>
                      )}

                      {/* Enabled Status Badge (no toggle switch!) */}
                      {ext.enabled === true ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          Enabled
                        </span>
                      ) : ext.enabled === false ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-800 text-slate-400 border border-slate-700">
                          Disabled
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                          Unknown
                        </span>
                      )}
                    </div>

                    {ext.description && (
                      <p className="text-xs text-slate-400 line-clamp-1">{ext.description}</p>
                    )}

                    <div className="flex items-center gap-3 text-[11px] text-slate-500 flex-wrap pt-0.5">
                      {ext.profilePath && (
                        <span>
                          Profile: <strong className="text-slate-400">{ext.profilePath.split(/[/\\\\]/).pop()}</strong>
                        </span>
                      )}
                      <span>
                        Installed: <strong className="text-slate-400">{formatInstallDate(ext.installDate)}</strong>
                      </span>
                    </div>

                    {/* Permissions */}
                    {ext.permissions && ext.permissions.length > 0 && (
                      <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                        {ext.permissions.slice(0, 3).map((p) => (
                          <span
                            key={p}
                            className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-400"
                          >
                            {p}
                          </span>
                        ))}
                        {ext.permissions.length > 3 && (
                          <span className="text-[10px] text-slate-500">
                            +{ext.permissions.length - 3} more
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Deep-link action button */}
                <div className="shrink-0">
                  <button
                    onClick={() => handleOpenPage(ext.browser)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
                    title={`Manage in ${BROWSER_TABS.find((t) => t.id === ext.browser)?.label}`}
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-blue-400" />
                    <span>Manage</span>
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
};
