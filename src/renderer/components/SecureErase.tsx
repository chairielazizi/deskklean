import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../apiClient';
import { ShredResult, WipeResult } from '../../shared/types';
import {
  Flame,
  Loader2,
  ShieldAlert,
  Trash2,
  HardDrive,
  File,
  CheckCircle2,
  AlertTriangle,
  Plus,
  FolderOpen,
  X,
} from 'lucide-react';

interface EraseItem {
  id: string;
  name: string;
  path: string;
}

export const SecureErase: React.FC = () => {
  const [passes, setPasses] = useState<number>(1);
  const [items, setItems] = useState<EraseItem[]>([]);
  const [newPathInput, setNewPathInput] = useState<string>('');
  const [isSsd, setIsSsd] = useState<boolean | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [shredResult, setShredResult] = useState<{
    success: boolean;
    isPartial?: boolean;
    message: string;
    completed?: number;
    failed?: number;
    bytesWritten?: number;
    failures?: { target: string; error: string }[];
  } | null>(null);

  // Distinct confirmation modal state (Binding Rail 7)
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    type: 'shred' | 'wipe';
    acknowledged: boolean;
  }>({
    open: false,
    type: 'shred',
    acknowledged: false,
  });

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let mounted = true;
    async function checkSsdStatus() {
      try {
        if (api.isTargetSsd) {
          const result = await api.isTargetSsd('C:');
          if (mounted) setIsSsd(result);
        } else {
          const specs = await api.getSystemSpecs();
          const cDrive = specs.drives.find((d) => d.mount.startsWith('C') || d.id === 'c');
          const isDriveSsd = cDrive ? cDrive.type.toLowerCase().includes('ssd') : null;
          if (mounted) setIsSsd(isDriveSsd);
        }
      } catch {
        if (mounted) setIsSsd(null); // Indeterminate: defaults to showing SSD notice
      }
    }
    checkSsdStatus();
    return () => {
      mounted = false;
    };
  }, []);

  const addPath = (rawPath: string) => {
    const trimmed = rawPath.trim();
    if (!trimmed) return;
    if (items.some((i) => i.path.toLowerCase() === trimmed.toLowerCase())) return;

    const name = trimmed.split(/[\\/]/).filter(Boolean).pop() || trimmed;
    const newItem: EraseItem = {
      id: `item-${Date.now()}-${items.length + 1}`,
      name,
      path: trimmed,
    };
    setItems((prev) => [...prev, newItem]);
    setNewPathInput('');
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const newItems: EraseItem[] = [];
    for (let idx = 0; idx < e.target.files.length; idx++) {
      const f = e.target.files[idx];
      // In Electron, File objects carry a path property
      const filePath = (f as any).path || f.name;
      if (!items.some((i) => i.path === filePath) && !newItems.some((i) => i.path === filePath)) {
        newItems.push({
          id: `item-${Date.now()}-${idx}`,
          name: f.name,
          path: filePath,
        });
      }
    }
    setItems((prev) => [...prev, ...newItems]);
    e.target.value = '';
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const openShredConfirmation = () => {
    if (items.length === 0) return;
    setConfirmModal({
      open: true,
      type: 'shred',
      acknowledged: false,
    });
  };

  const openWipeConfirmation = () => {
    setConfirmModal({
      open: true,
      type: 'wipe',
      acknowledged: false,
    });
  };

  const executeConfirmedAction = async () => {
    const actionType = confirmModal.type;
    setConfirmModal({ open: false, type: 'shred', acknowledged: false });
    setIsProcessing(true);
    setShredResult(null);

    try {
      if (actionType === 'shred') {
        const targetPaths = items.map((i) => i.path);
        const result: ShredResult = await api.shredItems(targetPaths, passes, { passes, targetPaths });

        const isPartial = !result.success && result.completed > 0;
        setShredResult({
          success: result.success,
          isPartial,
          message: result.message || (result.success
            ? `Successfully shredded ${result.completed} items (${formatBytes(result.bytesWritten ?? 0)} written)`
            : `Shredding incomplete: ${result.completed} completed, ${result.failed} failed`),
          completed: result.completed,
          failed: result.failed,
          bytesWritten: result.bytesWritten,
          failures: result.failures,
        });
        if (result.success) {
          setItems([]);
        }
      } else {
        const result: WipeResult = await api.wipeFreeSpace('C', passes, { volumeRoot: 'C:\\' });
        const bytesWiped = result.bytesWritten ?? result.wipedBytes ?? 0;
        const isPartial = !result.success && bytesWiped > 0;

        setShredResult({
          success: result.success,
          isPartial,
          message: result.message || (bytesWiped > 0
            ? `Wiped ${formatBytes(bytesWiped)} of free space on C: (partial result leaving headroom)`
            : 'Free space wipe completed.'),
          completed: result.completed,
          failed: result.failed,
          bytesWritten: bytesWiped,
          failures: result.failures,
        });
      }
    } catch (e: any) {
      setShredResult({
        success: false,
        message: e?.message || 'Operation failed.',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const formatBytes = (bytes: number): string => {
    if (!bytes || bytes === 0) return '0 B';
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
          Permanently overwrite and destroy files and wipe volume free space beyond recovery
        </p>
      </div>

      {/* Irreversible Warning Banner */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-rose-950/50 to-slate-950 border border-rose-500/30 p-6"
      >
        <div className="absolute top-0 right-0 w-64 h-64 bg-rose-500/10 rounded-full blur-3xl pointer-events-none -mr-12 -mt-12" />
        <div className="relative z-10 flex items-start gap-4">
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 shrink-0">
            <ShieldAlert className="w-6 h-6 text-rose-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-rose-300">Irreversible Action</h2>
            <p className="text-sm text-rose-400/90 mt-1 leading-relaxed">
              Overwriting destroys the original bytes. The file cannot be restored from a backup because no backup is made — the backup would contain the very data the shred is meant to destroy.
            </p>
          </div>
        </div>
      </motion.div>

      {/* SSD Honesty Notice (Step 4 & Binding Rail 5) */}
      {/* Shown BEFORE confirmation, NOT in an expandable section. Defaults to shown if indeterminate. */}
      {isSsd !== false && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-4"
        >
          <div className="p-2.5 rounded-lg bg-amber-500/20 text-amber-300 shrink-0 mt-0.5">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-amber-300">Solid State Drive (SSD) Notice</h3>
            <p className="text-xs text-amber-200/90 mt-1.5 leading-relaxed">
              Overwriting reduces the chance of recovery but does not guarantee it on an SSD. For a guaranteed erase, use your drive's ATA Secure Erase feature.
            </p>
          </div>
        </motion.div>
      )}

      {/* Pass Count Selection (Step 4 & D2) */}
      <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
        <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
          <Flame className="w-4 h-4 text-rose-400" /> Pass Count (1–3 Passes)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            {
              count: 1,
              title: '1 Pass (Default & Recommended)',
              desc: 'Cryptographic random data pass. NIST SP 800-88 Rev. 1 compliant.',
            },
            {
              count: 2,
              title: '2 Passes',
              desc: 'Two passes of cryptographic random data.',
            },
            {
              count: 3,
              title: '3 Passes',
              desc: 'Three passes of cryptographic random data (DoD style).',
            },
          ].map((option) => (
            <button
              key={option.count}
              type="button"
              onClick={() => setPasses(option.count)}
              className={`p-4 rounded-xl border text-left transition-all ${
                passes === option.count
                  ? 'bg-rose-500/10 border-rose-500/50 ring-1 ring-rose-500/30'
                  : 'bg-slate-800/40 border-slate-700/60 hover:border-slate-600'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-bold text-slate-200">{option.title}</span>
                <span className="text-xs font-mono text-rose-400">{option.count} pass{option.count > 1 ? 'es' : ''}</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">{option.desc}</p>
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-400 italic">
          More passes do not increase the guarantee on an SSD. On modern HDDs, 1 pass is sufficient.
        </p>
      </div>

      {/* Items to Shred */}
      <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-200">Files to Shred ({items.length})</h3>
          <div className="flex items-center gap-2">
            <input
              type="file"
              multiple
              ref={fileInputRef}
              onChange={handleFileInputChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition-colors"
            >
              <FolderOpen className="w-3.5 h-3.5" /> Browse Files
            </button>
          </div>
        </div>

        {/* Path Input Form */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newPathInput}
            onChange={(e) => setNewPathInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addPath(newPathInput)}
            placeholder="Type or paste absolute file path (e.g. C:\Users\user\Documents\confidential.txt)..."
            className="flex-1 bg-slate-800/60 border border-slate-700 rounded-lg px-3.5 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-rose-500/50 font-mono"
          />
          <button
            type="button"
            onClick={() => addPath(newPathInput)}
            disabled={!newPathInput.trim()}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition-colors disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" /> Add Path
          </button>
        </div>

        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center border border-dashed border-slate-800 rounded-xl">
            <File className="w-10 h-10 text-slate-600 mb-3" />
            <p className="text-sm text-slate-400">No files selected</p>
            <p className="text-xs text-slate-500 mt-1">Browse files or enter a path above to prepare for shredding</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between p-3 rounded-lg bg-slate-800/40 border border-slate-700/60"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <File className="w-4 h-4 text-rose-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm text-slate-200 truncate">{item.name}</p>
                    <p className="text-xs text-slate-500 truncate font-mono">{item.path}</p>
                  </div>
                </div>
                <button
                  type="button"
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

      {/* Action Buttons */}
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={openShredConfirmation}
          disabled={isProcessing || items.length === 0}
          className="flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-rose-500 to-red-600 hover:from-rose-600 hover:to-red-700 text-white font-bold text-sm shadow-lg shadow-rose-950/40 transition-all disabled:opacity-50"
        >
          {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Flame className="w-4 h-4" />}
          {isProcessing ? 'Processing...' : `Shred ${items.length} File${items.length === 1 ? '' : 's'}`}
        </button>
        <button
          type="button"
          onClick={openWipeConfirmation}
          disabled={isProcessing}
          className="flex items-center gap-2 px-6 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-sm border border-slate-700 transition-all disabled:opacity-50"
        >
          <HardDrive className="w-4 h-4 text-slate-400" />
          Wipe Free Space (C:)
        </button>
      </div>

      {/* Result Display */}
      {shredResult && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`p-5 rounded-xl border space-y-2 ${
            shredResult.success
              ? 'bg-emerald-500/10 border-emerald-500/30'
              : shredResult.isPartial
              ? 'bg-amber-500/10 border-amber-500/30'
              : 'bg-rose-500/10 border-rose-500/30'
          }`}
        >
          <div className="flex items-center gap-3">
            {shredResult.success ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            ) : shredResult.isPartial ? (
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
            )}
            <span
              className={`text-sm font-medium ${
                shredResult.success
                  ? 'text-emerald-300'
                  : shredResult.isPartial
                  ? 'text-amber-300'
                  : 'text-rose-300'
              }`}
            >
              {shredResult.message}
            </span>
          </div>

          {shredResult.failures && shredResult.failures.length > 0 && (
            <div className="pt-2 border-t border-slate-800/80 space-y-1">
              <p className="text-xs font-semibold text-slate-300">Failures / Blocked Items:</p>
              {shredResult.failures.map((f, idx) => (
                <p key={idx} className="text-xs text-rose-400 font-mono">
                  &bull; {f.target}: {f.error}
                </p>
              ))}
            </div>
          )}
        </motion.div>
      )}

      {/* Distinct Irreversible Confirmation Modal (Phase 14 D5 & Binding Rail 7) */}
      <AnimatePresence>
        {confirmModal.open && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-lg rounded-2xl bg-slate-900 border border-rose-500/40 shadow-2xl p-6 space-y-5"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400">
                    <ShieldAlert className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">
                      {confirmModal.type === 'shred'
                        ? 'Confirm Irreversible Shred'
                        : 'Confirm Free Space Wipe'}
                    </h3>
                    <p className="text-xs text-rose-400 font-medium">
                      Permanent Sanitization &middot; {passes} Pass{passes > 1 ? 'es' : ''}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setConfirmModal({ open: false, type: 'shred', acknowledged: false })}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* D5 Reason statement verbatim */}
              <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 text-xs text-slate-300 leading-relaxed space-y-2">
                <p className="font-semibold text-rose-300">Irreversibility Notice:</p>
                <p>
                  Overwriting destroys the original bytes. The file cannot be restored from a backup because no backup is made — the backup would contain the very data the shred is meant to destroy.
                </p>
                {confirmModal.type === 'shred' ? (
                  <p className="text-slate-400 pt-1 border-t border-slate-800">
                    Target: <span className="text-white font-mono">{items.length} selected item{items.length === 1 ? '' : 's'}</span> will be completely overwritten and unlinked.
                  </p>
                ) : (
                  <p className="text-slate-400 pt-1 border-t border-slate-800">
                    Target: <span className="text-white font-mono">Volume C:\ free space</span> will be overwritten with cryptographic random bytes, stopping at headroom floor.
                  </p>
                )}
              </div>

              {/* Explicit acknowledgement requirement */}
              <label className="flex items-start gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={confirmModal.acknowledged}
                  onChange={(e) =>
                    setConfirmModal((prev) => ({ ...prev, acknowledged: e.target.checked }))
                  }
                  className="mt-0.5 rounded border-slate-700 bg-slate-800 text-rose-500 focus:ring-rose-500/30"
                />
                <span className="text-xs text-slate-300 leading-normal">
                  I understand that this operation is <strong className="text-rose-300">irreversible</strong> and will permanently destroy data on disk beyond recovery.
                </span>
              </label>

              {/* Modal Actions */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setConfirmModal({ open: false, type: 'shred', acknowledged: false })}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={executeConfirmedAction}
                  disabled={!confirmModal.acknowledged || isProcessing}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-rose-500 to-red-600 hover:from-rose-600 hover:to-red-700 text-white text-xs font-bold shadow-lg shadow-rose-950/40 transition-all disabled:opacity-40"
                >
                  <Flame className="w-4 h-4" />
                  Permanently Erase
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
