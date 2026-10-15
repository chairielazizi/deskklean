import { SystemSpecs, StartupItem } from '../../shared/types';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

// Hardware specifications rarely change during runtime (5 minutes TTL)
const DEFAULT_SPECS_TTL_MS = 5 * 60 * 1000;
// Startup items TTL (2 minutes)
const DEFAULT_STARTUP_TTL_MS = 2 * 60 * 1000;

class DataCache {
  private specs: CacheEntry<SystemSpecs> | null = null;
  private startupItems: CacheEntry<StartupItem[]> | null = null;

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
  }

  clearSystemSpecs(): void {
    this.specs = null;
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
  }

  updateStartupItem(id: string, enabled: boolean): void {
    if (!this.startupItems) return;
    this.startupItems.data = this.startupItems.data.map((item) =>
      item.id === id ? { ...item, enabled } : item
    );
  }

  clearStartupItems(): void {
    this.startupItems = null;
  }

  // --- Global ---
  clearAll(): void {
    this.specs = null;
    this.startupItems = null;
  }
}

export const dataCache = new DataCache();
