import React, { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ModuleId } from '../shared/types';
import { APP_NAME, APP_VERSION } from '../shared/constants';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { Dashboard } from './components/Dashboard';
import { HealthCheck } from './components/HealthCheck';
import { SmartClean } from './components/SmartClean';
import { RegistryFixer } from './components/RegistryFixer';
import { StartupOptimizer } from './components/StartupOptimizer';
import { AppRemover } from './components/AppRemover';
import { ExtensionManager } from './components/ExtensionManager';
import { DiskAnalyzer } from './components/DiskAnalyzer';
import { DuplicateFinder } from './components/DuplicateFinder';
import { SecureErase } from './components/SecureErase';
import { SystemInfo } from './components/SystemInfo';
import { Settings } from './components/Settings';
import { ElevationPrompt } from './components/ElevationPrompt';
import { api } from './apiClient';
import { dataCache } from './utils/dataCache';

const App: React.FC = () => {
  const [currentModule, setCurrentModule] = useState<ModuleId>('dashboard');
  const [isMaximized, setIsMaximized] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showElevationPrompt, setShowElevationPrompt] = useState(false);
  const [, setCacheVersion] = useState(0);

  useEffect(() => {
    return dataCache.subscribe(() => setCacheVersion((v) => v + 1));
  }, []);

  const cachedSmartClean = dataCache.getSmartCleanReport();
  const cachedStartup = dataCache.getStartupItems();

  const slowStartupCount = cachedStartup
    ? cachedStartup.filter(
        (item) => item.enabled && (item.impact === 'High' || (item.bootDegradationSeconds ?? 0) >= 1)
      ).length
    : undefined;

  const quickStats = {
    cleanableBytes: cachedSmartClean?.totalReclaimableBytes,
    startupCount: slowStartupCount,
  };

  useEffect(() => {
    // Check if window is maximized on mount
    if (window.deskKleanAPI) {
      window.deskKleanAPI.isMaximized().then(setIsMaximized);
    }

    // Check if startup elevation prompt should be shown whenever not elevated
    const checkElevationPrompt = async () => {
      try {
        const elevated = await api.isElevated();
        if (elevated === false) {
          setShowElevationPrompt(true);
        }
      } catch (err) {
        console.error('Failed to check elevation on startup:', err);
      }
    };
    checkElevationPrompt();

    // Simulate initial loading
    const timer = setTimeout(() => setIsLoading(false), 800);
    return () => clearTimeout(timer);
  }, []);

  const handleNavigate = (module: ModuleId) => {
    setCurrentModule(module);
  };

  const handleToggleMaximize = async () => {
    if (!window.deskKleanAPI) return;
    if (isMaximized) {
      await window.deskKleanAPI.maximizeWindow(); // toggle back
    } else {
      await window.deskKleanAPI.maximizeWindow();
    }
    const maximized = await window.deskKleanAPI.isMaximized();
    setIsMaximized(maximized);
  };

  const handleMinimize = () => {
    window.deskKleanAPI?.minimizeWindow();
  };

  const handleClose = () => {
    window.deskKleanAPI?.closeWindow();
  };

  const renderModule = () => {
    switch (currentModule) {
      case 'dashboard':
        return <Dashboard onNavigate={handleNavigate} />;
      case 'health-check':
        return <HealthCheck onNavigate={handleNavigate} />;
      case 'smart-clean':
        return <SmartClean />;
      case 'registry-fixer':
        return <RegistryFixer />;
      case 'startup-optimizer':
        return <StartupOptimizer />;
      case 'app-remover':
        return <AppRemover />;
      case 'extension-manager':
        return <ExtensionManager />;
      case 'disk-analyzer':
        return <DiskAnalyzer />;
      case 'duplicate-finder':
        return <DuplicateFinder />;
      case 'secure-erase':
        return <SecureErase />;
      case 'system-info':
        return <SystemInfo />;
      case 'settings':
        return <Settings />;
      default:
        return <Dashboard onNavigate={handleNavigate} />;
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#0B0F17]">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center gap-4"
        >
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-emerald-500/30 border-t-emerald-500" />
          <p className="text-lg font-medium text-slate-400">Loading {APP_NAME}...</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#0B0F17] text-slate-200">
      {/* Header */}
      <Header />

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <Sidebar
          currentModule={currentModule}
          onSelectModule={handleNavigate}
          quickStats={quickStats}
        />

        {/* Module content */}
        <main className="flex-1 overflow-auto bg-[#0D1117]">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentModule}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.2 }}
              className="h-full"
            >
              {renderModule()}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Startup Elevation Prompt Modal */}
      <AnimatePresence>
        {showElevationPrompt && (
          <ElevationPrompt onClose={() => setShowElevationPrompt(false)} />
        )}
      </AnimatePresence>
    </div>
  );
};

export default App;
