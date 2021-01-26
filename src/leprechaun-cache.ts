import { CacheStore, Cacheable, OnCacheMiss, LeprechaunCacheOptions, CacheItem } from './types'

interface LockResult {
  lockId: string
  didSpin: boolean
}

function delay(durationMs: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve()
    }, durationMs)
  })
}

const defaultBackgroundErrorHandler = (_: Error) => {}

export class LeprechaunCache<T extends Cacheable = Cacheable> {
  private softTtlMs: number
  private hardTtlMs: number
  private lockTtlMs: number
  private waitTimeMs: number
  private returnStale: boolean
  private spinWaitCount: number
  private cacheStore: CacheStore<T>
  private spinMs: number
  private inProgress = new Map<string, Promise<T>>()
  private onMiss: OnCacheMiss<T>
  private keyPrefix: string
  private onBackgroundError: (e: Error) => void

  public constructor({
    keyPrefix = '',
    softTtlMs,
    hardTtlMs,
    lockTtlMs,
    waitTimeMs = 0,
    waitForUnlockMs,
    cacheStore,
    spinMs,
    returnStale,
    onMiss,
    onBackgroundError = defaultBackgroundErrorHandler
  }: LeprechaunCacheOptions<T>) {
    this.hardTtlMs = hardTtlMs
    this.softTtlMs = softTtlMs
    this.lockTtlMs = lockTtlMs
    this.waitTimeMs = waitTimeMs
    this.spinWaitCount = Math.ceil(waitForUnlockMs / spinMs)
    this.spinMs = spinMs
    this.cacheStore = cacheStore
    this.returnStale = returnStale
    this.onMiss = onMiss
    this.keyPrefix = keyPrefix
    this.onBackgroundError = onBackgroundError
  }

  public async clear(key: string): Promise<boolean> {
    const result = await this.cacheStore.del(this.keyPrefix + key)
    this.inProgress.delete(key)
    return result
  }

  public async get(key: string): Promise<T> {
    let promise = this.inProgress.get(key)
    if (promise === undefined) {
      try {
        promise = this.doGet(key, this.softTtlMs)
        this.inProgress.set(key, promise)
        return await promise
      } finally {
        this.inProgress.delete(key)
      }
    }
    return promise
  }

  public async refresh(key: string): Promise<T> {
    return this.updateCache(key, this.softTtlMs)
  }

  private async doGet(key: string, ttl: number): Promise<T> {
    const result = await this.cacheStore.get(this.keyPrefix + key)
    if (!result) {
      return this.updateCache(key, ttl)
    }

    if (result.expiresAt > Date.now()) {
      return result.data
    }

    const update = this.updateCache(key, ttl).catch(e => {
      this.onBackgroundError(e)
      return result.data
    })

    if (!this.returnStale) {
      return update
    }

    return this.race(update, result.data)
  }

  private async race(update: Promise<T>, staleData: T): Promise<T> {
    update.catch(e => {
      this.onBackgroundError(e)
      return staleData
    })

    if (this.waitTimeMs <= 0) {
      return staleData
    }

    const returnStaleAfterWaitTime: Promise<T> = new Promise(resolve => {
      setTimeout(resolve, this.waitTimeMs, staleData)
    })

    return Promise.race([update, returnStaleAfterWaitTime])
  }

  private async spinLock(key: string): Promise<LockResult> {
    const lock: LockResult = {
      lockId: '',
      didSpin: false
    }
    let i = 0
    do {
      lock.lockId = (await this.cacheStore.lock(this.keyPrefix + key, this.lockTtlMs)) || ''
      if (lock.lockId) {
        break
      }
      await delay(this.spinMs)
      lock.didSpin = true
    } while (i++ <= this.spinWaitCount)
    return lock
  }

  private async updateCache(key: string, ttl: number): Promise<T> {
    const lock = await this.spinLock(key)

    if (!lock.lockId) {
      throw new Error('unable to acquire lock and no data in cache')
    }

    if (lock.didSpin) {
      //If we spun while getting the lock, then get the updated version (hopefully updated by another process)
      const result = await this.cacheStore.get(this.keyPrefix + key)
      if (result && result.data) {
        await this.cacheStore.unlock(this.keyPrefix + key, lock.lockId)
        return result.data
      }
    }
    try {
      const data = await this.onMiss(key)
      //Set and unlock asynchronously so we don't delay the response
      this.setAndUnlock(
        key,
        {
          data,
          expiresAt: Date.now() + ttl
        },
        lock
      )

      return data
    } catch (e) {
      this.unlock(key, lock)
      throw e
    }
  }

  private async unlock(key: string, lock: LockResult) {
    try {
      await this.cacheStore.unlock(this.keyPrefix + key, lock.lockId)
    } catch (e) {
      this.onBackgroundError(e)
    }
  }

  private async setAndUnlock(key: string, cacheData: CacheItem<T>, lock: LockResult) {
    try {
      await this.cacheStore.set(this.keyPrefix + key, cacheData, this.hardTtlMs)
    } catch (e) {
      this.onBackgroundError(e)
    }
    await this.unlock(key, lock)
  }
}
