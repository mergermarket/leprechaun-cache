import { CacheStore, Cacheable, LeprechaunCache, OnCacheMiss } from './types'

interface LockResult {
  locked: boolean;
  didSpin: boolean;
}

function delay(durationMs: number): Promise<void> {
  return new Promise(function (resolve) {
    setTimeout(function () {
      resolve();
    }, durationMs);
  });
};

export function createLeprechaunCache({
  hardTTL,
  waitForUnlockMs,
  lockTTL,
  cacheStore,
  spinMs,
  returnStale,
}: {
  hardTTL: number;
  lockTTL: number;
  waitForUnlockMs: number;
  cacheStore: CacheStore;
  spinMs: number;
  returnStale: boolean;
}): LeprechaunCache {
  const spinWaitCount = waitForUnlockMs / spinMs;

  async function spinLock(key: string): Promise<LockResult> {
    const lock = {
      locked: false,
      didSpin: false
    };
    let i = 0;
    do {
      lock.locked = await cacheStore.lock(key, lockTTL);
      if (lock.locked) {
        break;
      }
      await delay(spinMs);
      lock.didSpin = true;
    } while (i++ <= spinWaitCount)
    return lock;
  }

  async function getLock(key: string, doSpinLock: boolean): Promise<LockResult> {
    return doSpinLock ? await spinLock(key) : {
      locked: await cacheStore.lock(key, lockTTL),
      didSpin: false
    };
  }

  async function updateCache(key: string, onMiss: OnCacheMiss, ttl: number, doSpinLock: boolean): Promise<Cacheable> {
    const lock = await getLock(key, doSpinLock);

    if (!lock.locked)
      throw new Error('unable to acquire lock and no data in cache');
    if (lock.didSpin) {
      //If we spun while getting the lock, then get the updated version (hopefully updated by another process)
      const result = await cacheStore.get(key);
      if (result && result.data) {
        cacheStore.unlock(key);
        return result.data;
      }
    }
    const data = await onMiss(key);
    cacheStore.set(
      key,
      {
        data,
        expiresAt: Date.now() + ttl
      },
      hardTTL
    );
    cacheStore.unlock(key);
    return data;
  }



  async function get(key: string, ttl: number, onMiss: OnCacheMiss): Promise<Cacheable> {
    const result = await cacheStore.get(key);
    if (!result) {
      return await updateCache(key, onMiss, ttl, true);
    }
    if (result.expiresAt < Date.now()) {
      const update = updateCache(key, onMiss, ttl, !returnStale);
      if (returnStale) {
        //since we'll be returning the stale data
        //ignore any errors (most likely couldn't get the lock - another process is updating
        update.catch(() => {})
      } else {
        return update;
      }
    }
    return result.data;
  }

  async function clear(key: string): Promise<boolean> {
    const deleted = await cacheStore.del(key);
    const unlocked = await cacheStore.unlock(key);
    return deleted && unlocked;
  }

  return {
    get,
    clear
  }


}