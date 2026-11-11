import { OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type IORedis from 'ioredis';

type ThrottlerStorageRecord={totalHits:number;timeToExpire:number;isBlocked:boolean;timeToBlockExpire:number};

const incrementScript = `
local counter = KEYS[1]
local blocked = KEYS[2]
local ttl = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local blockDuration = tonumber(ARGV[3])
local blockTtl = redis.call('PTTL', blocked)
if blockTtl > 0 then
  return {tonumber(redis.call('GET', counter) or '0'), redis.call('PTTL', counter), 1, blockTtl}
end
local hits = redis.call('INCR', counter)
local windowTtl = redis.call('PTTL', counter)
if hits == 1 or windowTtl < 0 then
  redis.call('PEXPIRE', counter, ttl)
  windowTtl = ttl
end
if hits > limit then
  redis.call('SET', blocked, '1', 'PX', blockDuration)
  return {hits, windowTtl, 1, blockDuration}
end
return {hits, windowTtl, 0, 0}
`;

/** Shared, atomic rate-limit storage for API replicas using the same Redis. */
export class RedisThrottlerStorage implements ThrottlerStorage, OnModuleDestroy {
  constructor(private readonly redis: IORedis) {}

  ping() { return this.redis.ping(); }

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord> {
    const counterKey = `repus:throttle:${throttlerName}:${key}`;
    const blockedKey = `${counterKey}:blocked`;
    const [totalHits, timeToExpire, isBlocked, timeToBlockExpire] = await this.redis.eval(
      incrementScript,
      2,
      counterKey,
      blockedKey,
      Math.max(1, Math.trunc(ttl)),
      Math.max(0, Math.trunc(limit)),
      Math.max(1, Math.trunc(blockDuration)),
    ).catch(() => {
      throw new ServiceUnavailableException('Request protection is temporarily unavailable. Try again shortly.');
    }) as [number, number, number, number];

    return {
      totalHits: Number(totalHits),
      timeToExpire: Math.max(0, Math.ceil(Number(timeToExpire) / 1000)),
      isBlocked: Number(isBlocked) === 1,
      timeToBlockExpire: Math.max(0, Math.ceil(Number(timeToBlockExpire) / 1000)),
    };
  }

  async onModuleDestroy() {
    if (this.redis.status !== 'end') await this.redis.quit();
  }
}
