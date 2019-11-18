import { CacheStore, CacheItem } from '../types'
import { RedisClient } from 'redis'
import { v4 as uuidV4 } from 'uuid'

function lockKey(key: string): string {
  return `LOCK-${key}`
}

export class RedisCacheStore<T> implements CacheStore<T> {
  public constructor(private redisClient: RedisClient) {}

  public get(key: string): Promise<CacheItem<T>> {
    return new Promise<CacheItem<T>>((resolve, reject) => {
      this.redisClient.get(key, (error, result) => {
        if (error) {
          reject(error)
        }
        if (!result) {
          resolve(null)
        }
        resolve(JSON.parse(result))
      })
    })
  }

  public set(key: string, data: CacheItem<T>, ttl: number): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      this.redisClient.set(key, JSON.stringify(data), 'PX', ttl, (error, result) => {
        if (error) {
          reject(error)
        }
        if (result === 'OK') {
          resolve(true)
        }
        resolve(false)
      })
    })
  }

  public del(key: string): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      this.redisClient.del(key, (error, res) => {
        if (error) {
          reject(error)
        }
        resolve(res > 0)
      })
    })
  }

  public lock(key: string, ttl: number): Promise<string | false> {
    const lockId = uuidV4()
    return new Promise<string | false>((resolve, reject) => {
      this.redisClient.set(lockKey(key), lockId, 'PX', ttl, 'NX', (error, result) => {
        if (error) {
          reject(error)
        }
        if (result === 'OK') {
          resolve(lockId)
        }
        resolve(false)
      })
    })
  }

  public unlock(key: string, lockId: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      this.redisClient.get(lockKey(key), (error, result) => {
        if (!error && result && result === lockId) {
          this.redisClient.del(lockKey(key), err => {
            if (err) {
              reject(err)
            }
            resolve(true)
          })
        } else {
          resolve(false)
        }
      })
    })
  }
}
