import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '../apiClient';
import { ShredMethod, ShredMethodId } from '../../shared/types';
import { SHRED_METHODS } from '../../shared/constants';
import {
  Flame,
  Loader2,
  ShieldAlert,
  Trash2,
  HardDrive,
  File,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';

interface EraseItem {
  id: string;
  name: string;
  path: string;
  type: 'file' | 'folder' | 'free-space';
  sizeBytes?: number;
}

export const SecureErase: React.FC = () => {
  const [method, setMethod] = useState<ShredMethodId>('dod_3');
  const [items, setItems] = useState<EraseItem[]>([]);
  const [isShredding, setIsShredding] = useState(false);
  const [shredProgress, setShredProgress] = useState<{
    active: boolean;
    targetPath: string;
    currentPass: number;
    totalPasses: number;
    percent: number;
  }>({ active: false, targetPath: '', currentPass: 0, totalPasses: 0, percent: 0 });
  const [shredResult, setShredResult] = useState<{ success: boolean; message: string } | null>(null);

  const addItem = () => {
    // Simulate adding an item
    const newItem: EraseItem = {
      id: `item-${Date.now()}`,
      name: `file-${items.length + 1}.tmp`,
      path: `C:\\Temp\\file-${items.length + 1}.tmp`,
      type: 'file',
      sizeBytes: Math.floor(Math.random() * 100000000),
    };
    setItems((prev) => [...prev, newItem]);
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const handleShred = async () => {
    if (items.length === 0) return;

    setIsShredding(true);
    setShredProgress({ active: true, targetPath: items[0].path, currentPass: 1, totalPasses: SHRED_METHODS.find((m) => m.id === method)?.passes || 3, percent: 0 });

    try {
      const result = await api.shredItems(items.map((i) => i.path), method);
      setShredResult({
        success: result.success,
        message: `Securely shredded ${result.shreddedCount} items using ${SHRED_METHODS.find((m) => m.id === method)?.name}`,
      });
      setItems([]);
    } catch (e) {
      setShredResult({ success: false, message: 'Shredding failed' });
    }
    setIsShredding(false);
    setShredProgress({ active: false, targetPath: '', currentPass: 0, totalPasses: 0, percent: 0 });
  };

  const handleWipeFreeSpace = async () => {
    setIsShredding(true);
    try {
      const result = await api.wipeFreeSpace('C', method);
      setShredResult({
        success: result.success,
        message: `Wiped ${formatBytes(result.wipedBytes)} of free space on C:`,
      });
    } catch (e) {
      setShredResult({ success: false, message: 'Free space wipe failed' });
    }
    setIsShredding(false);
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Secure Erase</h1>
        <p className="text-sm text-slate-400 mt-1">
          Permanently shred files and wipe free space beyond recovery
        </p>
      </div>

      {/* Warning Banner */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-rose-950/50 to-slate-950 border border-rose-500/30 p-6"
      >
        <div className="absolute top-0 right-0 w-64 h-64 bg-rose-500/10 rounded-full blur-3xl pointer-events-none -mr-12 -mt-12" />
        <div className="relative z-10 flex items-center gap-4">
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30">
            <ShieldAlert className="w-6 h-6 text-rose-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-rose-300">Irreversible Action</h2>
            <p className="text-sm text-rose-400/80 mt-1">
              Shredded files cannot be recovered by any software. Proceed with caution.
            </p>
          </div>
        </div>
      </motion.div>

      {/* Shred Method Selection */}
      <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800">
        <h3 className="text-sm font-bold text-slate-200 mb-4 flex items-center gap-2">
          <Flame className="w-4 h-4 text-rose-400" /> Shred Method
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {SHRED_METHODS.map((m) => (
            <button
              key={m.id}
              onClick={() => setMethod(m.id)}
              className={`p-4 rounded-xl border text-left transition-all ${
                method === m.id
                  ? 'bg-rose-500/10 border-rose-500/40 ring-1 ring-rose-500/30'
                  : 'bg-slate-800/50 border-slate-700 hover:border-slate-600'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-bold text-slate-200">{m.name}</span>
                <span className="text-xs text-slate-400">{m.passes} pass{m.passes > 1 ? 'es' : ''}</span>
              </div>
              <p className="text-xs text-slate-400">{m.description}</p>
              <p className="text-[10px] text-rose-400/60 mt-1">{m.compliance}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Items to Shred */}
      <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-slate-200">Items to Shred</h3>
          <button
            onClick={addItem}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
          >
            <Trash2 className="w-3 h-3" /> Add Item
          </button>
        </div>
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <File className="w-10 h-10 text-slate-600 mb-3" />
            <p className="text-sm text-slate-400">No items added</p>
            <p className="text-xs text-slate-500 mt-1">Click "Add Item" to select files or folders to shred</p>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between p-3 rounded-lg bg-slate-800/50 border border-slate-700"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <File className="w-4 h-4 text-rose-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm text-slate-200 truncate">{item.name}</p>
                    <p className="text-xs text-slate-500 truncate font-mono">{item.path}</p>
                  </div>
                </div>
                <button
                  onClick={() => removeItem(item.id)}
                  className="p-1.5 rounded-lg hover:bg-rose-500/10 text-slate-400 hover:text-rose-400 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleShred}
          disabled={isShredding || items.length === 0}
          className="flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-rose-500 to-red-600 hover:from-rose-600 hover:to-red-700 text-white font-bold text-sm shadow-lg shadow-rose-950/40 transition-all disabled:opacity-50"
        >
          {isShredding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Flame className="w-4 h-4" />}
          {isShredding ? 'Shredding...' : 'Shred Files'}
        </button>
        <button
          onClick={handleWipeFreeSpace}
          disabled={isShredding}
          className="flex items-center gap-2 px-6 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-sm border border-slate-700 transition-all disabled:opacity-50"
        >
          <HardDrive className="w-4 h-4" />
          Wipe Free Space (C:)
        </button>
      </div>

      {/* Progress */}
      {shredProgress.active && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="p-5 rounded-xl bg-rose-500/5 border border-rose-500/30"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-rose-300">Shredding in progress...</span>
            <span className="text-sm font-mono text-rose-400">
              Pass {shredProgress.currentPass}/{shredProgress.totalPasses} &middot; {shredProgress.percent}%
            </span>
          </div>
          <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
            <div
              className="bg-rose-500 h-full transition-all duration-300"
              style={{ width: `${shredProgress.percent}%` }}
            />
          </div>
          <p className="text-xs text-slate-400 mt-2 font-mono truncate">{shredProgress.targetPath}</p>
        </motion.div>
      )}

      {/* Result */}
      {shredResult && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`p-4 rounded-xl border flex items-center gap-3 ${
            shredResult.success
              ? 'bg-emerald-500/10 border-emerald-500/30'
              : 'bg-rose-500/10 border-rose-500/30'
          }`}
        >
          {shredResult.success ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-rose-400" />
          )}
          <span className={`text-sm ${shredResult.success ? 'text-emerald-300' : 'text-rose-300'}`}>
            {shredResult.message}
          </span>
        </motion.div>
      )}
    </div>
  );
};
