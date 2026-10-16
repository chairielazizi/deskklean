import { SystemSpecs, StartupItem, HealthReport, SmartCleanReport } from '../../shared/types';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

// Hardware specifications rarely change during runtime (5 minutes TTL)
const DEFAULT_SPECS_TTL_MS = 5 * 60 * 1000;
// Startup items TTL (2 minutes)
const DEFAULT_STARTUP_TTL_MS = 2 * 60 * 1000;
// Health report TTL (5 minutes)
const DEFAULT_HEALTH_TTL_MS = 5 * 60 * 1000;
// Smart Clean report TTL (3 minutes)
const DEFAULT_SMART_CLEAN_TTL_MS = 3 * 60 * 1000;

class DataCache {
  private specs: CacheEntry<SystemSpecs> | null = null;
  private startupItems: CacheEntry<StartupItem[]> | null = null;
  private healthReport: CacheEntry<HealthReport> | null = null;
  private smartCleanReport: CacheEntry<SmartCleanReport> | null = null;
  private listeners: Set<() => void> = new Set();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch (err) {
        console.error('Error in dataCache listener:', err);
      }
    });
  }

  // --- System Specs ---
  getSystemSpecs(): SystemSpecs | null {
    return this.specs?.data ?? null;
  }

  isSystemSpecsStale(maxAgeMs = DEFAULT_SPECS_TTL_MS): boolean {
    if (!this.specs) return true;
    return Date.now() - this.specs.timestamp > maxAgeMs;
  }

  setSystemSpecs(data: SystemSpecs): void {
    this.specs = { data, timestamp: Date.now() };
    this.notify();
  }

  clearSystemSpecs(): void {
    this.specs = null;
    this.notify();
  }

  // --- Startup Items ---
  getStartupItems(): StartupItem[] | null {
    return this.startupItems?.data ?? null;
  }

  isStartupItemsStale(maxAgeMs = DEFAULT_STARTUP_TTL_MS): boolean {
    if (!this.startupItems) return true;
    return Date.now() - this.startupItems.timestamp > maxAgeMs;
  }

  setStartupItems(data: StartupItem[]): void {
    this.startupItems = { data: [...data], timestamp: Date.now() };
    this.notify();
  }

  updateStartupItem(id: string, enabled: boolean): void {
    if (!this.startupItems) return;
    this.startupItems.data = this.startupItems.data.map((item) =>
      item.id === id ? { ...item, enabled } : item
    );
    this.notify();
  }

  clearStartupItems(): void {
    this.startupItems = null;
    this.notify();
  }

  // --- Health Report ---
  getHealthReport(): HealthReport | null {
    return this.healthReport?.data ?? null;
  }

  isHealthReportStale(maxAgeMs = DEFAULT_HEALTH_TTL_MS): boolean {
    if (!this.healthReport) return true;
    return Date.now() - this.healthReport.timestamp > maxAgeMs;
  }

  setHealthReport(data: HealthReport): void {
    this.healthReport = { data: { ...data }, timestamp: Date.now() };
    this.notify();
  }

  clearHealthReport(): void {
    this.healthReport = null;
    this.notify();
  }

  // --- Smart Clean Report ---
  getSmartCleanReport(): SmartCleanReport | null {
    return this.smartCleanReport?.data ?? null;
  }

  isSmartCleanStale(maxAgeMs = DEFAULT_SMART_CLEAN_TTL_MS): boolean {
    if (!this.smartCleanReport) return true;
    return Date.now() - this.smartCleanReport.timestamp > maxAgeMs;
  }

  setSmartCleanReport(data: SmartCleanReport): void {
    this.smartCleanReport = { data: { ...data }, timestamp: Date.now() };
    this.notify();
  }

  clearSmartCleanReport(): void {
    this.smartCleanReport = null;
    this.notify();
  }

  // --- Global ---
  clearAll(): void {
    this.specs = null;
    this.startupItems = null;
    this.healthReport = null;
    this.smartCleanReport = null;
    this.notify();
  }
}

export const dataCache = new DataCache();
