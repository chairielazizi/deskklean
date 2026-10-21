// Phase 3 — Destructive Operation Framework Types
// See docs/PHASE-3-DESTRUCTIVE-FRAMEWORK.md

export type ActionKind =
  | 'delete-file'
  | 'delete-tree'
  | 'overwrite-file'
  | 'registry-value'
  | 'registry-key'
  | 'scheduled-task'
  | 'uninstall';

export type Reversibility = 'reversible' | 'irreversible';

export interface PlannedAction {
  id: string; // stable within the plan, for reporting
  kind: ActionKind;
  target: string; // absolute resolved path, or a registry path
  description: string; // shown verbatim to the user at confirm time
  reclaimableBytes: number | null; // null when genuinely unknown - never estimated
  metadata?: Record<string, unknown>;
}

export interface BlockedAction {
  target: string;
  reason: string; // why the protected list or validation refused it
}

export interface OperationPlan {
  id: string; // unique plan id for tracking and execution
  module: string;
  actions: PlannedAction[];
  blocked: BlockedAction[];
  totalReclaimableBytes: number | null;
  reversibility: Reversibility;
  irreversibilityReason?: string; // REQUIRED when irreversibility === 'irreversible'
  requiresElevation: boolean;
  createdAt: string;
}

export interface ExecuteFailure {
  target: string;
  error: string;
}

export interface ExecuteResult {
  success: boolean; // true only when completed === actions.length && failed === 0
  completed: number;
  failed: number;
  skipped: number;
  reclaimableBytes: number | null;
  failures: ExecuteFailure[];
  backupPath?: string;
  message?: string;
  bytesWritten?: number;
}

export interface BackupMetadata {
  module: string;
  itemName: string;
  hive?: 'HKCU' | 'HKLM';
  location?: string;
  valueName?: string;
  timestamp: string;
  custom?: Record<string, string>;
}

export interface StartupBackup {
  id: string;
  timestamp: string;
  filePath: string;
  itemName: string;
  hive: 'HKCU' | 'HKLM';
  location: string;
  valueName: string;
  changeSummary: string;
  sizeBytes: number;
}

export interface StartupDelayState {
  delayMs: number | null;
  waitForIdle: boolean | null;
  supported: boolean;
}
