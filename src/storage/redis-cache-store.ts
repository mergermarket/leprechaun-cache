import { CacheStore, CacheItem } from '../types';
import { RedisClient } from 'redis';
import { v4 as uuidV4 } from 'uuid';

export function createRedisCacheStore(redisClient: RedisClient): CacheStore {
  function get(key: string): Promise<CacheItem> {
    return new Promise<CacheItem>((resolve, reject) => {
      redisClient.get(key, (error, result) => {
        if (error) {
          reject(error);
        }
        if (!result) {
          resolve(null);
        }
        resolve(JSON.parse(result));
      });
    })    
  }

  function set(key: string, data: CacheItem, ttl: number): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      redisClient.set(key, JSON.stringify(data), 'PX', ttl, (error, result) => {
        if (error) reject(error);
        if (result === 'OK') {
          resolve(true);
        }
        resolve(false);
    
      });
    });
  }

  function del(key: string): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      redisClient.del(key, (error, res) => {
        if (error) reject(error);
        resolve(res > 0);
      });
    })
  }

  async function lock(key: string, ttl: number): Promise<boolean> {
    const token = uuidV4();
    return new Promise<boolean>((resolve,reject) => {
      redisClient.set(`LOCK-${key}`, token, 'PX', ttl, 'NX', (error, result) => {
        if (error) reject(error);
        if (result === 'OK') {
          resolve(true);
        }
        resolve(false);
      })
    })
  }

  function unlock(key: string): Promise<boolean> {
    return del(`LOCK-${key}`);
  }

  return {
    get,
    set,
    del,
    lock,
    unlock
  }
}