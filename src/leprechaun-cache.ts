import { CacheStore, Cacheable, OnCacheMiss, LeprechaunCacheOptions } from './types'

interface LockResult {
  lockId: string | false
  didSpin: boolean
}

function delay(durationMs: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve()
    }, durationMs)
  })
}

export class LeprechaunCache<T extends Cacheable = Cacheable> {
  private hardTTL: number
  private lockTTL: number
  private returnStale: boolean
  private spinWaitCount: number
  private cacheStore: CacheStore<T>
  private spinMs: number
  private inProgress = new Map<string, Promise<T>>()
  private onMiss: OnCacheMiss<T>

  public constructor({
    hardTTL,
    lockTTL,
    waitForUnlockMs,
    cacheStore,
    spinMs,
    returnStale,
    onMiss
  }: LeprechaunCacheOptions<T>) {
    this.hardTTL = hardTTL
    this.lockTTL = lockTTL
    this.spinWaitCount = Math.ceil(waitForUnlockMs / spinMs)
    this.spinMs = spinMs
    this.cacheStore = cacheStore
    this.returnStale = returnStale
    this.onMiss = onMiss
  }

  public async clear(key: string): Promise<boolean> {
    const result = await this.cacheStore.del(key)
    this.inProgress.delete(key)
    return result
  }

  public async get(key: string, ttlInMilliseconds: number): Promise<T> {
    let promise = this.inProgress.get(key)
    if (promise === undefined) {
      try {
        promise = this.doGet(key, ttlInMilliseconds)
        this.inProgress.set(key, promise)
        return await promise
      } finally {
        this.inProgress.delete(key)
      }
    }
    return promise
  }

  private async doGet(key: string, ttl: number): Promise<T> {
    const result = await this.cacheStore.get(key)
    if (!result) {
      return this.updateCache(key, ttl, true)
    }
    if (result.expiresAt < Date.now()) {
      const update = this.updateCache(key, ttl, !this.returnStale)
      if (this.returnStale) {
        //since we'll be returning the stale data
        //ignore any errors (most likely couldn't get the lock - another process is updating
        update.catch(() => {})
      } else {
        return update
      }
    }
    return result.data
  }

  private async spinLock(key: string): Promise<LockResult> {
    const lock: LockResult = {
      lockId: '',
      didSpin: false
    }
    let i = 0
    do {
      lock.lockId = await this.cacheStore.lock(key, this.lockTTL)
      if (lock.lockId) {
        break
      }
      await delay(this.spinMs)
      lock.didSpin = true
    } while (i++ <= this.spinWaitCount)
    return lock
  }

  private async getLock(key: string, doSpinLock: boolean): Promise<LockResult> {
    return doSpinLock
      ? this.spinLock(key)
      : {
          lockId: await this.cacheStore.lock(key, this.lockTTL),
          didSpin: false
        }
  }

  private async updateCache(key: string, ttl: number, doSpinLock: boolean): Promise<T> {
    const lock = await this.getLock(key, doSpinLock)

    if (!lock.lockId) {
      throw new Error('unable to acquire lock and no data in cache')
    }
    if (lock.didSpin) {
      //If we spun while getting the lock, then get the updated version (hopefully updated by another process)
      const result = await this.cacheStore.get(key)
      if (result && result.data) {
        await this.cacheStore.unlock(key, lock.lockId)
        return result.data
      }
    }

    try {
      const data = await this.onMiss(key)

      this.cacheStore.set(
        key,
        {
          data,
          expiresAt: Date.now() + ttl
        },
        this.hardTTL
      )

      return data
    } finally {
      this.cacheStore.unlock(key, lock.lockId)
    }
  }
}
