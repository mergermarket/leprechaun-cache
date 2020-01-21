# leprechaun-cache

Caching library supporting locked updates and stale return to handle [cache stampede / dog pile](https://en.wikipedia.org/wiki/Cache_stampede) protection.

The locking means that when the cache expires, only one process will handle the miss and call the (potentially expensive) re-generation method.

If `returnStale` is true, then it will call the `onMiss` handler in order to update the cache. If it takes longer then `waitTimeMs` then it will return the stale data

If `returnStale` is false (or there is nothing already in the cache), then all requests for that key will wait until the update is complete, and then return the updated version from the cache

Currently only supports redis (via node_redis) as a backend store and a simple in-memory store for testing, but it is easy to create your own store as long as it is able to support distributed locking

Usage:

```js
function getMyObjectFromDB(id) {
  return db.expensiveQuery(id)
}

const cacheStore = new RedisCacheStore(
  new RedisClient({}) //node_redis client
)

const myObjectCache = new LeprechaunCache({
  keyPrefix: 'MyObject',
  softTtlMs: 1000,
  cacheStore,
  onMiss: getMyObjectFromDb,
  hardTtlMs: 60 * 1000 * 1000,
  waitForUnlockMs: 3000,
  lockTtlMs: 6000,
  spinMs: 50,
  returnStale: true
  waitTimeMs: 500
  onBackgroundError: e => { console.error(e); }
})

const myObject = await myObjectCache.get('object-id') //get the object with key 'object-id'. If it doesn't exist, onMiss will be called, and the data will be stored in the cache with a soft TTL of 1000ms

const myObject = await myObjectCache.refresh('object-id') //Force refresh (calls the onMiss handler and updates the cache) and return the result

await myObjectCache.clear('object-id') //Remove the item from the cache
```

## Constructor Options

| Option            | type        | Description                                                                                                                                                                                                                                         |
| ----------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| keyPrefix         | string?     | Optional prefix that will be added to all keys in the underlying store                                                                                                                                                                              |
| softTtlMs         | number (ms) | Soft TTL (in ms) for storing the items in the cache                                                                                                                                                                                                 |
| cacheStore        | CacheStore  | the underlying KV store to use. Must implement CacheStore interface. A node_redis implementation is included.                                                                                                                                       |
| onMiss            | function    | callback function that will be called when a value is either not in the cache, or the soft TTL has expired.                                                                                                                                         |
| hardTtlMs         | number (ms) | the TTL (in ms) to pass to the cacheStore set method - values should hard-expire after this and should no longer be retrievable from the store                                                                                                      |
| lockTtlMs         | number (ms) | the TTL (in ms) to pass to the cacheStore lock method. While the onMiss function is called, a lock will be acquired. This defines how long the lock should last. This should be longer than the longest time you expect your onMiss handler to take |
| waitForUnlockMs   | number (ms) | if the onMiss function is locked, how long should the client wait for it to unlock before giving up. This is relevant when returnStale is false, or when there is no stale data in the cache                                                        |
| spinMs            | number (ms) | How many milliseconds to wait before re-attempting to acquire the lock                                                                                                                                                                              |
| returnStale       | boolean     | if this is true, when the value is expired (by the soft-ttl, set per-key), the library will return the stale result (after waitTimeMs) from the cache while updating the cache in the background                                                    |
| waitTimeMs        | number (ms) | Optional (default=0) The amount of time to wait for the onMiss handler to resolve before returning the stale data. If 0 then it will always return the stale data if it is expired                                                                  |
| onBackgroundError | function?   | Called if there is any error while performing background tasks (calling the onMiss if returnStale true, or while setting the cache / unlocking after returning the data)                                                                            |
