export type OnCacheMiss = (key: string) => Promise<Cacheable>

export type Cacheable = string | number | boolean | object

export interface LeprechaunCache {
  get: (key: string, ttl: number, onMiss: OnCacheMiss) => Promise<Cacheable>;
  clear: (key: string) => Promise<boolean>;
}

interface CacheItem {
  data: Cacheable;
  expiresAt: number;
}

export interface CacheStore {
  get: (key: string) => Promise<CacheItem | null>;
  set: (key: string, data: CacheItem, ttl: number) => Promise<boolean>;
  delete: (key: string) => Promise<boolean>;
  lock: (key: string, ttl: number) => Promise<boolean>;
  unlock: (key: string) => Promise<boolean>;
}