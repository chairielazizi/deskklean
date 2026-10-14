import React, { useState, useEffect } from 'react';
import { api } from '../apiClient';
import { Minus, Square, Copy, X, ShieldCheck, Sparkles, Terminal } from 'lucide-react';
import { APP_NAME, APP_VERSION } from '../../shared/constants';

interface HeaderProps {
  systemScore?: number;
}

export const Header: React.FC<HeaderProps> = ({ systemScore = 84 }) => {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const checkMaximized = async () => {
      try {
        const max = await api.isMaximized();
        setIsMaximized(max);
      } catch (e) {
        // browser dev fallback
      }
    };
    checkMaximized();
  }, []);

  const handleMinimize = async () => {
    try {
      await api.minimizeWindow();
    } catch (e) {
      console.log('Minimize window');
    }
  };

  const handleMaximize = async () => {
    try {
      await api.maximizeWindow();
      setIsMaximized(!isMaximized);
    } catch (e) {
      console.log('Maximize window');
    }
  };

  const handleClose = async () => {
    try {
      await api.closeWindow();
    } catch (e) {
      console.log('Close window');
    }
  };

  return (
    <header className="drag-region h-11 bg-[#0A0D14] border-b border-slate-800/80 flex items-center justify-between px-4 select-none shrink-0 z-50">
      {/* Left: Branding & Status */}
      <div className="flex items-center gap-3 no-drag">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-950/40">
            <Sparkles className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="font-semibold text-sm tracking-wide text-slate-100 flex items-center gap-1.5">
            {APP_NAME}
            <span className="text-[10px] uppercase font-mono font-bold tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Pro v{APP_VERSION}
            </span>
          </span>
        </div>

        <div className="h-4 w-px bg-slate-800 mx-1" />

        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-900 border border-slate-800 text-[11px] text-slate-300">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-slate-400">Status:</span>
          <span className="font-medium text-emerald-400">Protected</span>
        </div>
      </div>

      {/* Center: Subtle Title / Info */}
      <div className="hidden md:flex items-center gap-2 text-xs text-slate-400 font-medium">
        <span className="text-slate-500">System Optimizer & Cleaner</span>
        <span className="text-slate-700">•</span>
        <span className="text-slate-400">Health: <span className="text-emerald-400 font-semibold">{systemScore}%</span></span>
      </div>

      {/* Right: Window Controls */}
      <div className="flex items-center gap-1 no-drag">
        <button
          onClick={handleMinimize}
          className="w-8 h-8 rounded flex items-center justify-center text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 transition-colors"
          title="Minimize"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={handleMaximize}
          className="w-8 h-8 rounded flex items-center justify-center text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 transition-colors"
          title={isMaximized ? "Restore" : "Maximize"}
        >
          {isMaximized ? (
            <Copy className="w-3.5 h-3.5" />
          ) : (
            <Square className="w-3.5 h-3.5" />
          )}
        </button>

        <button
          onClick={handleClose}
          className="w-8 h-8 rounded flex items-center justify-center text-slate-400 hover:text-rose-100 hover:bg-rose-600 transition-colors"
          title="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
