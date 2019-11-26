import { CacheStore, CacheItem, Cacheable } from '../types'

import uuid = require('uuid')

export class MemoryCacheStore<T extends Cacheable = Cacheable> implements CacheStore<T> {
  private items = new Map()
  private locks = new Map()

  public get(key: string): Promise<CacheItem<T> | null> {
    const item = this.items.get(key)
    if (item && item.ttl >= Date.now()) {
      return Promise.resolve(item.data)
    }
    return Promise.resolve(null)
  }

  public set(key: string, data: CacheItem<T>, ttl: number): Promise<boolean> {
    this.items.set(key, {
      data,
      ttl: Date.now() + ttl
    })
    return Promise.resolve(true)
  }

  public del(key: string): Promise<boolean> {
    this.items.delete(key)
    return Promise.resolve(true)
  }

  public lock(key: string, ttl: number): Promise<string | false> {
    const lock = this.locks.get(key)
    if (lock && lock.ttl >= Date.now()) {
      return Promise.resolve(false)
    }
    const lockId = uuid.v4()
    this.locks.set(key, { ttl: Date.now() + ttl, id: lockId })
    return Promise.resolve(lockId)
  }

  public unlock(key: string, lockId: string) {
    const lock = this.locks.get(key)
    if (lock && lock.ttl >= Date.now() && lock.id !== lockId) {
      return Promise.resolve(false)
    }
    this.locks.delete(key)
    return Promise.resolve(true)
  }

  public reset() {
    this.items = new Map()
    this.locks = new Map()
  }
}
