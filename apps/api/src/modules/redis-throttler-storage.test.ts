import { describe, expect, it, vi } from 'vitest';
import { RedisThrottlerStorage } from './redis-throttler-storage';

describe('RedisThrottlerStorage', () => {
  it('uses the shared Redis connection for readiness checks', async () => {
    const redis = { ping: vi.fn().mockResolvedValue('PONG'), quit: vi.fn(), status: 'ready' };
    await expect(new RedisThrottlerStorage(redis as any).ping()).resolves.toBe('PONG');
    expect(redis.ping).toHaveBeenCalledOnce();
  });

  it('uses one atomic Redis operation and returns the Nest throttler record', async () => {
    const redis = { eval: vi.fn().mockResolvedValue([4, 5_500, 1, 2_100]), quit: vi.fn(), status: 'ready' };
    const storage = new RedisThrottlerStorage(redis as any);

    await expect(storage.increment('hashed-key', 60_000, 3, 10_000, 'default')).resolves.toEqual({
      totalHits: 4,
      timeToExpire: 6,
      isBlocked: true,
      timeToBlockExpire: 3,
    });
    expect(redis.eval).toHaveBeenCalledWith(expect.stringContaining("redis.call('INCR', counter)"), 2, 'repus:throttle:default:hashed-key', 'repus:throttle:default:hashed-key:blocked', 60_000, 3, 10_000);
  });

  it('closes its Redis connection during application shutdown', async () => {
    const redis = { eval: vi.fn(), quit: vi.fn().mockResolvedValue('OK'), status: 'ready' };
    await new RedisThrottlerStorage(redis as any).onModuleDestroy();
    expect(redis.quit).toHaveBeenCalledOnce();
  });

  it('fails closed with a safe 503 when Redis cannot enforce the limit', async () => {
    const redis = { eval: vi.fn().mockRejectedValue(new Error('private.redis.test')) };
    await expect(new RedisThrottlerStorage(redis as any).increment('key', 60_000, 60, 60_000, 'default'))
      .rejects.toMatchObject({status:503,message:'Request protection is temporarily unavailable. Try again shortly.'});
  });
});
