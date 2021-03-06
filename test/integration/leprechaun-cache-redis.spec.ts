/* eslint-disable @typescript-eslint/no-unused-expressions */
import { RedisCacheStore, LeprechaunCache } from '../../src'
import * as chai from 'chai'
import * as sinon from 'sinon'
import sinonChai from 'sinon-chai'
import { RedisClient } from 'redis'

chai.use(sinonChai)
const expect = chai.expect
const redisClient = new RedisClient({})
const cacheStore = new RedisCacheStore(redisClient)

function delay(durationMs: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve()
    }, durationMs).unref()
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

    const onMiss = sandbox.stub().resolves(data)
    const cache = new LeprechaunCache({
      softTtlMs: 80,
      hardTtlMs: 10000,
      waitForUnlockMs: 1000,
      spinMs: 50,
      lockTtlMs: 1000,
      cacheStore,
      returnStale: false,
      onMiss
    })
    const result = await cache.get(key)
    expect(result).to.deep.equal(data)

    const result2 = await cache.get(key)
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
      softTtlMs: 80,
      hardTtlMs: 10000,
      waitForUnlockMs: 1000,
      spinMs: 50,
      lockTtlMs: 1000,
      cacheStore,
      returnStale: false,
      onMiss
    })

    const result = await cache.get(key)
    expect(result).to.deep.equal(data1)

    onMiss.resolves(data2)
    await delay(100) //delay for the ttl
    const result2 = await cache.get(key)
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
      softTtlMs: 80,
      hardTtlMs: 10000,
      waitForUnlockMs: 1000,
      spinMs: 50,
      lockTtlMs: 1000,
      cacheStore,
      returnStale: true,
      onMiss
    })

    const result = await cache.get(key)
    expect(result).to.deep.equal(data1)

    onMiss.resolves(data2)
    await delay(100) //delay for the ttl
    const result2 = await cache.get(key)
    expect(result2).to.deep.equal(data1)

    await delay(100) //short delay to allow the async update to process
    expect(onMiss).calledTwice
  })

  it('will return the update if it takes less time than the waitTimeMs handler to resolve', async () => {
    const data1 = {
      some: 'data'
    }
    const data2 = {
      some: 'new data'
    }

    const key = 'key'
    const onMiss = sandbox.stub().resolves(data1)

    const cache = new LeprechaunCache({
      softTtlMs: 80,
      hardTtlMs: 10000,
      waitForUnlockMs: 1000,
      spinMs: 50,
      lockTtlMs: 1000,
      cacheStore,
      returnStale: true,
      waitTimeMs: 50,
      onMiss
    })

    const result = await cache.get(key)
    expect(result).to.deep.equal(data1)
    await delay(100) //delay for the ttl

    onMiss.resolves(data2)

    const result2 = await cache.get(key)
    expect(result2).to.deep.equal(data2)
  })

  it('will return the stale data if it takes longer time than the waitTimeMs handler to resolve', async () => {
    const data1 = {
      some: 'data'
    }
    const data2 = {
      some: 'new data'
    }

    const key = 'key'
    const onMiss = sandbox.stub().resolves(data1)

    const cache = new LeprechaunCache({
      softTtlMs: 80,
      hardTtlMs: 10000,
      waitForUnlockMs: 1000,
      spinMs: 50,
      lockTtlMs: 1000,
      cacheStore,
      returnStale: true,
      waitTimeMs: 50,
      onMiss
    })

    const result = await cache.get(key)
    expect(result).to.deep.equal(data1)
    await delay(100) //delay for the ttl

    onMiss.returns(new Promise(resolve => setTimeout(resolve, 100, data2)))

    const result2 = await cache.get(key)
    expect(result2).to.deep.equal(data1)
    await delay(100) //short delay to allow the background update to finish
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
      softTtlMs: 80,
      hardTtlMs: 10000,
      waitForUnlockMs: 1000,
      spinMs: 50,
      lockTtlMs: 1000,
      cacheStore,
      returnStale: false,
      onMiss
    })

    await cache.get(key)
    await delay(100) //delay for the ttl
    delayMs = 80
    onMissStub.reset()
    onMissStub.resolves(data2)

    //call it twice:
    const results = await Promise.all([cache.get(key), cache.get(key)])

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
      softTtlMs: 80,
      hardTtlMs: 10000,
      waitForUnlockMs: 1000,
      spinMs: 50,
      lockTtlMs: 1000,
      cacheStore,
      returnStale: true,
      onMiss
    })

    //initial population:
    await cache.get(key)
    await delay(100) //delay for the ttl
    delayMs = 80
    onMissStub.reset()
    onMissStub.resolves(data2)

    //call it twice:
    const results = await Promise.all([cache.get(key), cache.get(key)])

    //we expect both results to be data1, since data2 hasn't updated yet
    expect(results[0]).to.deep.equal(data1)
    expect(results[1]).to.deep.equal(data1)

    //wait for the update to resolve:
    await delay(100) //delay for the ttl
    expect(onMissStub).calledOnce

    //now it should be updated:
    const results2 = await cache.get(key)
    expect(results2).to.deep.equal(data2)
  })

  it('should save and return undefined and null and false correctly', async () => {
    const onMissStub = sandbox.stub()
    onMissStub.withArgs('key-undefined').resolves(undefined)
    onMissStub.withArgs('key-null').resolves(null)
    onMissStub.withArgs('key-false').resolves(false)
    onMissStub.withArgs('key-empty-string').resolves('')
    onMissStub.withArgs('key-zero').resolves(0)

    const cache = new LeprechaunCache({
      softTtlMs: 80,
      hardTtlMs: 10000,
      waitForUnlockMs: 1000,
      spinMs: 50,
      lockTtlMs: 1000,
      cacheStore,
      returnStale: true,
      onMiss: onMissStub
    })

    const result1 = await cache.get('key-undefined')
    expect(result1).to.equal(undefined)
    expect(await cache.get('key-undefined')).to.equal(undefined)

    const result2 = await cache.get('key-null')
    expect(result2).to.equal(null)
    expect(await cache.get('key-null')).to.equal(null)

    const result3 = await cache.get('key-false')
    expect(result3).to.equal(false)
    expect(await cache.get('key-false')).to.equal(false)

    const result4 = await cache.get('key-empty-string')
    expect(result4).to.equal('')
    expect(await cache.get('key-empty-string')).to.equal('')

    const result5 = await cache.get('key-zero')
    expect(result5).to.equal(0)
    expect(await cache.get('key-zero')).to.equal(0)
  })

  it('should refresh the cache when refresh is called when not yet expired', async () => {
    const onMissStub = sandbox.stub()
    const res1 = { res: 1 }
    const res2 = { res: 2 }
    onMissStub.onCall(0).resolves(res1)
    onMissStub.onCall(1).resolves(res2)

    const cache = new LeprechaunCache({
      softTtlMs: 10000,
      hardTtlMs: 10000,
      waitForUnlockMs: 1000,
      spinMs: 50,
      lockTtlMs: 1000,
      cacheStore,
      returnStale: true,
      onMiss: onMissStub
    })

    const result1 = await cache.get('key')
    expect(result1).to.deep.equal(res1)
    await delay(10)

    await cache.refresh('key')
    const result2 = await cache.get('key')
    expect(result2).to.deep.equal(res2)
  })
})
