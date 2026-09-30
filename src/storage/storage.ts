/**
 * Persistence layer.
 * - Versioned keys, JSON payloads, safe against corrupted data.
 * - Adapter-injected: localStorage in the browser, in-memory in tests/SSR.
 */

export interface StorageAdapter {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export class MemoryStorage implements StorageAdapter {
  private map = new Map<string, string>();
  get(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  set(key: string, value: string): void {
    this.map.set(key, value);
  }
  remove(key: string): void {
    this.map.delete(key);
  }
}

class SafeLocalStorage implements StorageAdapter {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* quota or privacy mode — fail silently, the game keeps running */
    }
  }
  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

export function defaultAdapter(): StorageAdapter {
  if (typeof localStorage !== 'undefined') return new SafeLocalStorage();
  return new MemoryStorage();
}

export const KEYS = {
  settings: 'umo.settings.v1',
  stats: 'umo.stats.v1',
  solitaireSave: 'umo.solitaire.save.v1',
  traditionalSave: 'umo.traditional.save.v1',
  campaign: 'umo.campaign.v1',
  challenges: 'umo.challenges.v1',
  customLayouts: 'umo.custom-layouts.v1',
} as const;

export class Store {
  constructor(private adapter: StorageAdapter = defaultAdapter()) {}

  read<T>(key: string, fallback: T, validate?: (v: unknown) => boolean): T {
    const raw = this.adapter.get(key);
    if (raw === null) return fallback;
    try {
      const parsed = JSON.parse(raw) as T;
      if (validate && !validate(parsed)) return fallback;
      return parsed;
    } catch {
      return fallback;
    }
  }

  write<T>(key: string, value: T): boolean {
    try {
      this.adapter.set(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  clear(key: string): void {
    this.adapter.remove(key);
  }
}

/** Global store instance (tests can build their own with MemoryStorage). */
export const store = new Store();
