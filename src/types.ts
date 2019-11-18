export type Cacheable = string | number | boolean | object

export type OnCacheMiss<T = Cacheable> = (key: string) => Promise<T>

export interface CacheItem<T = Cacheable> {
  data: T
  expiresAt: number
}

export interface LeprechaunCacheGetResult<T = Cacheable> {
  error: Error | null
  isStale: boolean
  data: T
}

export interface CacheStore<T = Cacheable> {
  get: (key: string) => Promise<CacheItem<T> | null>
  set: (key: string, data: CacheItem<T>, ttl: number) => Promise<boolean>
  del: (key: string) => Promise<boolean>
  lock: (key: string, ttl: number) => Promise<string | false>
  unlock: (key: string, lockId: string) => Promise<boolean>
}
