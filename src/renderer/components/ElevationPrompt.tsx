import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '../apiClient';
import { ShieldAlert, AlertTriangle, Info, Loader2 } from 'lucide-react';

interface ElevationPromptProps {
  onClose: () => void;
}

export const ElevationPrompt: React.FC<ElevationPromptProps> = ({ onClose }): React.JSX.Element => {
  const [isRelaunching, setIsRelaunching] = useState<boolean>(false);
  const [isDismissing, setIsDismissing] = useState<boolean>(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [inlineMessage, setInlineMessage] = useState<string | null>(null);

  const handleRestart = async (): Promise<void> => {
    setIsRelaunching(true);
    setInlineError(null);
    setInlineMessage(null);
    try {
      const res = await api.relaunchElevated();
      if (!res.success) {
        setInlineError(res.message || 'Failed to restart with administrator rights.');
      } else if (res.message) {
        setInlineMessage(res.message);
      }
    } catch (err) {
      setInlineError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRelaunching(false);
    }
  };

  const handleContinue = async (): Promise<void> => {
    setIsDismissing(true);
    try {
      await api.saveSettings({ elevationPromptDismissed: true });
    } catch (err) {
      console.error('Failed to save settings:', err);
    } finally {
      setIsDismissing(false);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2 }}
        className="relative w-full max-w-lg rounded-2xl bg-gradient-to-b from-[#161B22] to-[#0D1117] border border-slate-700/80 p-6 shadow-2xl space-y-5 text-slate-200"
      >
        {/* Title and Icon */}
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 shrink-0 mt-0.5">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Administrator rights recommended</h2>
            <p className="text-xs text-amber-400/90 font-medium mt-0.5">
              Recommended for full system cleanup & optimization
            </p>
          </div>
        </div>

        {/* Body Content */}
        <div className="space-y-3 text-sm text-slate-300 leading-relaxed bg-slate-900/60 rounded-xl p-4 border border-slate-800">
          <p>
            Without admin you can browse System Info, scan disks and read the startup list.
          </p>
          <p>
            Cleaning system locations, writing to HKLM registry keys and toggling startup entries need administrator rights.
          </p>
        </div>

        {/* Inline Feedback Messages */}
        {inlineMessage && (
          <div className="p-3.5 rounded-xl bg-sky-500/10 border border-sky-500/30 text-sky-200 text-sm flex items-start gap-3">
            <Info className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
            <p>{inlineMessage}</p>
          </div>
        )}

        {inlineError && (
          <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-sm flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <p>{inlineError}</p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={handleContinue}
            disabled={isRelaunching || isDismissing}
            className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 hover:text-white font-medium text-sm transition-colors border border-slate-700/80 flex items-center justify-center gap-2 cursor-pointer"
          >
            {isDismissing && <Loader2 className="w-4 h-4 animate-spin" />}
            Continue without administrator
          </button>
          <button
            type="button"
            onClick={handleRestart}
            disabled={isRelaunching || isDismissing}
            className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-semibold text-sm transition-colors flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 cursor-pointer"
          >
            {isRelaunching && <Loader2 className="w-4 h-4 animate-spin" />}
            Restart as administrator
          </button>
        </div>
      </motion.div>
    </div>
  );
};
