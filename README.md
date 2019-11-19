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
  keyPrefix: 'MyObject',
  cacheStore,
  onMiss: getMyObjectFromDb,
  hardTTL: 60 * 1000 * 1000,
  waitForUnlockMs: 3000,
  lockTTL: 6000,
  spinMs: 50,
  returnStale: true
  onBackgroundError: e => { console.error(e); }
})

const myObject = myObjectCache.get('object-id', 1000) //get the object with key 'object-id'. If it doesn't exist, onMiss will be called, and the data will be stored in the cache with a soft TTL of 1000ms
```

## Constructor Options

| Option            | type              | Description                                                                                                                                                                                                                                                              |
| ----------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| keyPrefix         | string (optional) | Optional prefix that will be added to all keys in the underlying store                                                                                                                                                                                                   |
| cacheStore        | CacheStore        | the underlying KV store to use. Must implement CacheStore interface. A node_redis implementation is included.                                                                                                                                                            |
| onMiss            | function          | callback function that will be called when a value is either not in the cache, or the soft TTL has expired.                                                                                                                                                              |
| hardTTL           | number (in ms)    | the TTL (in ms) to pass to the cacheStore set method - values should hard-expire after this and should no longer be retrievable from the store                                                                                                                           |
| lockTTL           | number (in ms)    | the TTL (in ms) to pass to the cacheStore lock method. While the onMiss function is called, a lock will be acquired. This defines how long the lock should last. This should be longer than the longest time you expect your onMiss handler to take                      |
| waitForUnlockMs   | number (in ms)    | if the onMiss function is locked, how long should the client wait for it to unlock before giving up. This is relevant when returnStale is false, or when there is no stale data in the cache                                                                             |
| spinMs            | number (in ms)    | How many milliseconds to wait before re-attempting to acquire the lock                                                                                                                                                                                                   |
| returnStale       | boolean           | if this is true, when the value is expired (by the soft-ttl, set per-key), the library will return the stale result from the cache while updating the cache in the background. The next attempt to get, after this update has resolved, will then return the new version |
| onBackgroundError | function          | Called if there is any error while performing background tasks (calling the onMiss if returnStale true, or while setting the cache / unlocking after returning the data)                                                                                                 |
