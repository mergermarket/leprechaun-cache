export type Cacheable = string | number | boolean | object

export type OnCacheMiss<T extends Cacheable = Cacheable> = (key: string) => Promise<T>

export interface CacheItem<T extends Cacheable = Cacheable> {
  data: T
  expiresAt: number
}

export interface CacheStore<T extends Cacheable = Cacheable> {
  get: (key: string) => Promise<CacheItem<T> | null>
  set: (key: string, data: CacheItem<T>, ttl: number) => Promise<boolean>
  del: (key: string) => Promise<boolean>
  lock: (key: string, ttl: number) => Promise<string | false>
  unlock: (key: string, lockId: string) => Promise<boolean>
}

export interface LeprechaunCacheOptions<T extends Cacheable = Cacheable> {
  keyPrefix?: string
  hardTTL: number
  lockTTL: number
  waitForUnlockMs: number
  cacheStore: CacheStore<T>
  spinMs: number
  returnStale: boolean
  onMiss: OnCacheMiss<T>
  onBackgroundError?: (e: Error) => void
}
