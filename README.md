# leprechaun-cache

Caching library supporting locked updates and stale return.

Currently only supports redis (via node_redis) as a backend store

Usage:

```js
function getMyObjectFromDB(id) {
  return db.expensiveQuery(id)
}

const cacheStore = new RedisCacheStore(
  new RedisClient({}) //node_redis client
)

const myObjectCache = new LeprechaunCache({
  keyPrefix: 'MyObject', //optional
  cacheStore,
  onMiss: getMyObjectFromDb, //function that will be called if the cache misses - should return a promise that resolves to the real object
  hardTTL: 60 * 1000 * 1000, //how long to keep it in redis (or the underlying store)
  waitForUnlockMs: 3000, //if the update is locked (i.e. Another process is calling the onMiss), how long to wait for it to unlock before failing
  lockTTL: 6000, //how long to keep the update locked (should be considerably longer than you expect the onMiss function to take)
  spinMs: 50, //how long to delay before attempting to get the lock again, if an update is locked
  returnStale: true //if this is true, when the value is expired (by the soft-ttl, set per-key), the library will return the stale result from the cache,
  //while updating the cache in the background. The next attempt to get, after this update has resolved, will then return the new version
})

const myObject = myObjectCache.get('object-id', 1000) //get the object with key 'object-id'. If it doesn't exist, onMiss will be called, and the data will be stored in the cache with a soft TTL of 1000ms
```
