/* eslint-disable @typescript-eslint/no-unused-expressions */
import { createLeprechaunCache, CacheStore, Cacheable } from '../../src'
import * as chai from 'chai'
import * as sinon from 'sinon'
import * as sinonChai from 'sinon-chai'
import { RedisClient } from 'redis'
import { createRedisCacheStore } from '../../src/storage/redis-cache-store'

chai.use(sinonChai)
const expect = chai.expect
const redisClient = new RedisClient({})
const cacheStore: CacheStore = createRedisCacheStore(redisClient)

function delay(durationMs: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve()
    }, durationMs)
  })
}

describe('Leprechaun Cache (integration)', () => {
  const sandbox = sinon.sandbox.create()

  beforeEach(async () => {
    await new Promise(resolve => {
      redisClient.FLUSHALL(() => {
        resolve()
      })
    })
  })

  afterEach(() => {
    sandbox.restore()
  })

  after(() => {
    redisClient.quit()
  })

  it('should store the data by calling onMiss and then return the data when called again', async () => {
    const data = {
      some: 'data'
    }
    const key = 'key'

    const cache = createLeprechaunCache({
      hardTTL: 10000,
      waitForUnlockMs: 1000,
      spinMs: 50,
      lockTTL: 1000,
      cacheStore,
      returnStale: false
    })
    const onMiss = sandbox.stub().resolves(data)
    const result = await cache.get(key, 100, onMiss)
    expect(result).to.deep.equal(data)

    const result2 = await cache.get(key, 100, onMiss)
    expect(result2).to.deep.equal(data)
    expect(onMiss).calledOnce
  })

  it('should call onMiss a second time and return the new results (when returnStale is false) if the ttl is expired', async () => {
    const data1 = {
      some: 'data'
    }
    const data2 = {
      some: 'new data'
    }

    const key = 'key'

    const cache = createLeprechaunCache({
      hardTTL: 10000,
      waitForUnlockMs: 1000,
      spinMs: 50,
      lockTTL: 1000,
      cacheStore,
      returnStale: false
    })

    const onMiss = sandbox.stub().resolves(data1)
    const result = await cache.get(key, 100, onMiss)
    expect(result).to.deep.equal(data1)

    onMiss.resolves(data2)
    await delay(200) //delay for the ttl
    const result2 = await cache.get(key, 100, onMiss)
    expect(result2).to.deep.equal(data2)
  })

  it('should call onMiss a second time but return the stale results (when returnStale is true) if the ttl is expired', async () => {
    const data1 = {
      some: 'data'
    }
    const data2 = {
      some: 'new data'
    }

    const key = 'key'

    const cache = createLeprechaunCache({
      hardTTL: 10000,
      waitForUnlockMs: 1000,
      spinMs: 50,
      lockTTL: 1000,
      cacheStore,
      returnStale: true
    })

    const onMiss = sandbox.stub().resolves(data1)
    const result = await cache.get(key, 100, onMiss)
    expect(result).to.deep.equal(data1)

    onMiss.resolves(data2)
    await delay(100) //delay for the ttl
    const result2 = await cache.get(key, 100, onMiss)
    expect(result2).to.deep.equal(data1)

    await delay(100) //short delay to allow the async update to process
    expect(onMiss).calledTwice
  })

  it('should spin-lock until the new results are available if the cache is stale and another process is updating it (returnStale false)', async () => {
    const data1 = {
      some: 'data'
    }
    const data2 = {
      some: 'new data'
    }

    const key = 'key'

    const cache = createLeprechaunCache({
      hardTTL: 10000,
      waitForUnlockMs: 1000,
      spinMs: 50,
      lockTTL: 1000,
      cacheStore,
      returnStale: false
    })

    const onMiss = sandbox.stub().resolves(data1)
    await cache.get(key, 100, onMiss)
    await delay(100) //delay for the ttl

    const onMiss2 = sandbox.stub().resolves(data2)
    const onMissDelayed = async (k: string): Promise<Cacheable> => {
      await delay(80)
      return onMiss2(k)
    }

    //call it twice:
    const results = await Promise.all([cache.get(key, 100, onMissDelayed), cache.get(key, 100, onMissDelayed)])

    expect(results[0]).to.deep.equal(data2)
    expect(results[1]).to.deep.equal(data2)
    expect(onMiss2).calledOnce
  })

  it('should return the stale version (with returnStale true) of the data for parallel calls, while the latest version is updating', async () => {
    const data1 = {
      some: 'data'
    }
    const data2 = {
      some: 'new data'
    }
    const onMiss = sandbox.stub().resolves(data1)
    const onMiss2 = sandbox.stub().resolves(data2)
    const onMissDelayed = async (key): Promise<Cacheable> => {
      await delay(40)
      return onMiss2(key)
    }

    const key = 'key'

    const cache = createLeprechaunCache({
      hardTTL: 10000,
      waitForUnlockMs: 1000,
      spinMs: 50,
      lockTTL: 1000,
      cacheStore,
      returnStale: true
    })

    //initial population:
    await cache.get(key, 100, onMiss)
    await delay(100) //delay for the ttl

    //call it twice:
    const results = await Promise.all([cache.get(key, 100, onMissDelayed), cache.get(key, 100, onMissDelayed)])

    //we expect both results to be data1, since data2 hasn't updated yet
    expect(results[0]).to.deep.equal(data1)
    expect(results[1]).to.deep.equal(data1)

    //wait for the update to resolve:
    await delay(100) //delay for the ttl

    //now it should be updated:
    const results2 = await cache.get(key, 100, onMissDelayed)
    expect(results2).to.deep.equal(data2)
    expect(onMiss2).calledOnce
  })
})
