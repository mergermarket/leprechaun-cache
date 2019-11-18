import { createLeprechaunCache, CacheStore, Cacheable } from '../src';
import * as chai from 'chai';
import * as sinon from 'sinon';
import * as sinonChai from 'sinon-chai';

chai.use(sinonChai);
const expect = chai.expect;

let mockCacheItems = {};
let mockLocks = {};
const mockCacheStore: CacheStore = {
  get: async (key) => {
    return mockCacheItems[key]
  },
  set: async (key, data) => {
    mockCacheItems[key] = data
    return true
  },
  del: async (key) => {
    delete mockCacheItems[key];
    return true;
  },
  lock: async (key) => {
    const keyId = `${Math.floor(Math.random() * 1000)}`;
    if (!mockLocks[key]) {
      mockLocks[key] = keyId;
      return keyId;
    }
    return false;
  },
  unlock: async (key, keyId) => {
    if (!mockLocks[key] || mockLocks[key] !== keyId) return false;
    delete mockLocks[key];
    return true;
  }
};

function delay(durationMs: number): Promise<void> {
  return new Promise(function (resolve) {
    setTimeout(function () {
      resolve();
    }, durationMs);
  });
};

describe('Leprechaun Cache', () => {
  const sandbox = sinon.sandbox.create();

  afterEach(() => {
    sandbox.restore();
    mockCacheItems = {};
    mockLocks = {};
  });

  it('should store the data by calling onMiss and then return the data when called again', async () => {
    const data = {
      'some': 'data'
    };
    const key = 'key';

    const cache = createLeprechaunCache({
      hardTTL: 1000, 
      waitForUnlockMs: 1000,
      spinMs: 50,
      lockTTL: 1000,
      cacheStore: mockCacheStore,
      returnStale: false
    });
    const onMiss = sandbox.stub().resolves(data);
    const result = await cache.get(key, 100, onMiss);
    expect(result).to.equal(data);

    const result2 = await cache.get(key, 100, onMiss);
    expect(result2).to.equal(data);
    expect(onMiss).calledOnce;
  });

  it('should call onMiss a second time and return the new results (when returnStale is false) if the ttl is expired', async () => {
    const data1 = {
      'some': 'data'
    };
    const data2 = {
      'some': 'new data'
    }

    const key = 'key';
  
    const cache = createLeprechaunCache({
      hardTTL: 1000, 
      waitForUnlockMs: 1000,
      spinMs: 50,
      lockTTL: 1000,
      cacheStore: mockCacheStore,
      returnStale: false
    });

    const onMiss = sandbox.stub().resolves(data1);
    const result = await cache.get(key, 100, onMiss);
    expect(result).to.equal(data1);

    onMiss.resolves(data2);
    await delay(100); //delay for the ttl
    const result2 = await cache.get(key, 100, onMiss);
    expect(result2).to.equal(data2);
  });


  it('should call onMiss a second time but return the stale results (when returnStale is true) if the ttl is expired', async () => {
    const data1 = {
      'some': 'data'
    };
    const data2 = {
      'some': 'new data'
    }

    const key = 'key';
  
    const cache = createLeprechaunCache({
      hardTTL: 1000, 
      waitForUnlockMs: 1000,
      spinMs: 50,
      lockTTL: 1000,
      cacheStore: mockCacheStore,
      returnStale: true
    });

    const onMiss = sandbox.stub().resolves(data1);
    const result = await cache.get(key, 100, onMiss);
    expect(result).to.equal(data1);

    onMiss.resolves(data2);
    await delay(100); //delay for the ttl
    const result2 = await cache.get(key, 100, onMiss);
    expect(result2).to.equal(data1);

    await delay(1); //short delay to allow the async update to process
    expect(onMiss).calledTwice;
  });

  it('should spin-lock until the new results are available if the cache is stale and another process is updating it (returnStale false)', async () => {
    const data1 = {
      'some': 'data'
    };
    const data2 = {
      'some': 'new data'
    }
  
    const key = 'key';
    
    const cache = createLeprechaunCache({
      hardTTL: 1000, 
      waitForUnlockMs: 1000,
      spinMs: 50,
      lockTTL: 1000,
      cacheStore: mockCacheStore,
      returnStale: false
    });

    const onMiss = sandbox.stub().resolves(data1);
    await cache.get(key, 100, onMiss);
    await delay(100); //delay for the ttl

    const onMiss2 = sandbox.stub().resolves(data2);
    const onMissDelayed = async (key): Promise<Cacheable>  => { await delay(80); return await onMiss2(key) }

    //call it twice:
    const results = await Promise.all([
      cache.get(key, 100, onMissDelayed),
      cache.get(key, 100, onMissDelayed)
    ]);

    expect(results[0]).to.equal(data2);
    expect(results[1]).to.equal(data2);
    expect(onMiss2).calledOnce;
  });

  it('should return the stale version (with returnStale true) of the data for parallel calls, while the latest version is updating', async () => {
    const data1 = {
      'some': 'data'
    };
    const data2 = {
      'some': 'new data'
    }
    const onMiss = sandbox.stub().resolves(data1);
    const onMiss2 = sandbox.stub().resolves(data2);
    const onMissDelayed = async (key): Promise<Cacheable> => { await delay(40); return await onMiss2(key) }

    const key = 'key';
    
    const cache = createLeprechaunCache({
      hardTTL: 1000, 
      waitForUnlockMs: 1000,
      spinMs: 50,
      lockTTL: 1000,
      cacheStore: mockCacheStore,
      returnStale: true
    });

    //initial population:
    await cache.get(key, 100, onMiss);
    await delay(100); //delay for the ttl

    //call it twice:
    const results = await Promise.all([
      cache.get(key, 100, onMissDelayed),
      cache.get(key, 100, onMissDelayed)
    ]);

    //we expect both results to be data1, since data2 hasn't updated yet
    expect(results[0]).to.equal(data1);
    expect(results[1]).to.equal(data1);

    //wait for the update to resolve:
    await delay(100); //delay for the ttl

    //now it should be updated:
    const results2 = await cache.get(key, 100, onMissDelayed);
    expect(results2).to.equal(data2);
    expect(onMiss2).calledOnce
  });
});