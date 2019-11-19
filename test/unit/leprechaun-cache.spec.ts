/* eslint-disable @typescript-eslint/no-unused-expressions */
import { CacheStore, LeprechaunCache } from '../../src'
import * as chai from 'chai'
import * as sinon from 'sinon'
import sinonChai from 'sinon-chai'

chai.use(sinonChai)
const expect = chai.expect

let mockCacheItems = {}
let mockLocks = {}
const mockCacheStore: CacheStore = {
  get: async key => {
    return mockCacheItems[key]
  },
  set: async (key, data) => {
    mockCacheItems[key] = data
    return true
  },
  del: async key => {
    delete mockCacheItems[key]
    return true
  },
  lock: async key => {
    const keyId = `${Math.floor(Math.random() * 1000)}`
    if (!mockLocks[key]) {
      mockLocks[key] = keyId
      return keyId
    }
    return false
  },
  unlock: async (key, keyId) => {
    if (!mockLocks[key] || mockLocks[key] !== keyId) {
      return false
    }
    delete mockLocks[key]
    return true
  }
}

function delay(durationMs: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve()
    }, durationMs).unref()
  })
}

describe('Leprechaun Cache', () => {
  const sandbox = sinon.sandbox.create()

  afterEach(() => {
    sandbox.restore()
    mockCacheItems = {}
    mockLocks = {}
  })

  it('should store the data by calling onMiss and then return the data when called again', async () => {
    const data = {
      some: 'data'
    }
    const key = 'key'

    const onMiss = sandbox.stub().resolves(data)
    const cache = new LeprechaunCache({
      hardTTL: 10000,
      waitForUnlockMs: 1000,
      spinMs: 50,
      lockTTL: 1000,
      cacheStore: mockCacheStore,
      returnStale: false,
      onMiss
    })
    const result = await cache.get(key, 80)
    expect(result).to.deep.equal(data)

    const result2 = await cache.get(key, 80)
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

    const onMiss = sandbox.stub().resolves(data1)

    const cache = new LeprechaunCache({
      hardTTL: 10000,
      waitForUnlockMs: 1000,
      spinMs: 50,
      lockTTL: 1000,
      cacheStore: mockCacheStore,
      returnStale: false,
      onMiss
    })

    const result = await cache.get(key, 80)
    expect(result).to.deep.equal(data1)

    onMiss.resolves(data2)
    await delay(100) //delay for the ttl
    const result2 = await cache.get(key, 80)
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
    const onMiss = sandbox.stub().resolves(data1)

    const cache = new LeprechaunCache({
      hardTTL: 10000,
      waitForUnlockMs: 1000,
      spinMs: 50,
      lockTTL: 1000,
      cacheStore: mockCacheStore,
      returnStale: true,
      onMiss
    })

    const result = await cache.get(key, 80)
    expect(result).to.deep.equal(data1)

    onMiss.resolves(data2)
    await delay(100) //delay for the ttl
    const result2 = await cache.get(key, 80)
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
    const onMissStub = sandbox.stub().resolves(data1)
    let delayMs = 0

    const onMiss = async (k: string) => {
      if (delayMs) {
        await delay(delayMs)
      }
      return onMissStub(k)
    }

    const cache = new LeprechaunCache({
      hardTTL: 10000,
      waitForUnlockMs: 1000,
      spinMs: 50,
      lockTTL: 1000,
      cacheStore: mockCacheStore,
      returnStale: false,
      onMiss
    })

    await cache.get(key, 80)
    await delay(100) //delay for the ttl
    delayMs = 80
    onMissStub.reset()
    onMissStub.resolves(data2)

    //call it twice:
    const results = await Promise.all([cache.get(key, 80), cache.get(key, 80)])

    expect(results[0]).to.deep.equal(data2)
    expect(results[1]).to.deep.equal(data2)
    expect(onMissStub).calledOnce
  })

  it('should return the stale version (with returnStale true) of the data for parallel calls, while the latest version is updating', async () => {
    const data1 = {
      some: 'data'
    }
    const data2 = {
      some: 'new data'
    }
    const onMissStub = sandbox.stub().resolves(data1)
    let delayMs = 0

    const onMiss = async (k: string) => {
      if (delayMs) {
        await delay(delayMs)
      }
      return onMissStub(k)
    }

    const key = 'key'

    const cache = new LeprechaunCache({
      hardTTL: 10000,
      waitForUnlockMs: 1000,
      spinMs: 50,
      lockTTL: 1000,
      cacheStore: mockCacheStore,
      returnStale: true,
      onMiss
    })

    //initial population:
    await cache.get(key, 80)
    await delay(100) //delay for the ttl
    delayMs = 80
    onMissStub.reset()
    onMissStub.resolves(data2)

    //call it twice:
    const results = await Promise.all([cache.get(key, 80), cache.get(key, 80)])

    //we expect both results to be data1, since data2 hasn't updated yet
    expect(results[0]).to.deep.equal(data1)
    expect(results[1]).to.deep.equal(data1)

    //wait for the update to resolve:
    await delay(100) //delay for the ttl
    expect(onMissStub).calledOnce

    //now it should be updated:
    const results2 = await cache.get(key, 80)
    expect(results2).to.deep.equal(data2)
  })
})
