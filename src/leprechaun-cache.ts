import { CacheStore, Cacheable, OnCacheMiss } from './types'

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

export class LeprechaunCache<T = Cacheable> {
  private hardTTL: number
  private lockTTL: number
  private returnStale: boolean
  private spinWaitCount: number
  private cacheStore: CacheStore<T>
  private spinMs: number

  public constructor({
    hardTTL,
    lockTTL,
    waitForUnlockMs,
    cacheStore,
    spinMs,
    returnStale
  }: {
    hardTTL: number
    lockTTL: number
    waitForUnlockMs: number
    cacheStore: CacheStore<T>
    spinMs: number
    returnStale: boolean
  }) {
    this.hardTTL = hardTTL
    this.lockTTL = lockTTL
    this.spinWaitCount = Math.ceil(waitForUnlockMs / spinMs)
    this.spinMs = spinMs
    this.cacheStore = cacheStore
    this.returnStale = returnStale
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

  private async updateCache(key: string, onMiss: OnCacheMiss<T>, ttl: number, doSpinLock: boolean): Promise<T> {
    const lock = await this.getLock(key, doSpinLock)

    if (!lock.lockId) {
      throw new Error('unable to acquire lock and no data in cache')
    }
    if (lock.didSpin) {
      //If we spun while getting the lock, then get the updated version (hopefully updated by another process)
      const result = await this.cacheStore.get(key)
      if (result && result.data) {
        this.cacheStore.unlock(key, lock.lockId)
        return result.data
      }
    }

    const data = await onMiss(key)
    this.cacheStore.set(
      key,
      {
        data,
        expiresAt: Date.now() + ttl
      },
      this.hardTTL
    )
    this.cacheStore.unlock(key, lock.lockId)
    return data
  }

  public async get(key: string, ttl: number, onMiss: OnCacheMiss<T>): Promise<T> {
    const result = await this.cacheStore.get(key)
    if (!result) {
      return this.updateCache(key, onMiss, ttl, true)
    }
    if (result.expiresAt < Date.now()) {
      const update = this.updateCache(key, onMiss, ttl, !this.returnStale)
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

  public async clear(key: string): Promise<boolean> {
    return this.cacheStore.del(key)
  }
}
