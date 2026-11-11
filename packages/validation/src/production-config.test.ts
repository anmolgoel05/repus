import {describe,expect,it} from 'vitest';
import {assertProductionEmailConfig,assertProductionInfrastructureConfig,trustedProxyHops} from './production-config';

describe('production email configuration',()=>{
 const valid={NODE_ENV:'production',EMAIL_PROVIDER:'ses',SESSION_SECRET:'s'.repeat(32),EMAIL_FROM_ADDRESS:'hello@example.com',AWS_REGION:'ap-south-1',AWS_SES_CONFIGURATION_SET:'repus-events',AWS_S3_BUCKET:'repus-private',NEXT_PUBLIC_APP_URL:'https://app.example.com',TRACKING_BASE_URL:'https://track.example.com',PUBLIC_MEDIA_URL:'https://api.example.com',DATABASE_URL:'postgresql://repus:secret@db.example.com:5432/repus',REDIS_URL:'rediss://cache.example.com:6380'};
 it('allows a fully configured production runtime',()=>expect(()=>assertProductionEmailConfig(valid)).not.toThrow());
 it('does not impose production settings in local development',()=>expect(()=>assertProductionEmailConfig({NODE_ENV:'development'})).not.toThrow());
 it('fails closed when SES tracking or public HTTPS endpoints are missing',()=>{
  expect(()=>assertProductionEmailConfig({...valid,AWS_SES_CONFIGURATION_SET:''})).toThrow('AWS_SES_CONFIGURATION_SET');
  expect(()=>assertProductionEmailConfig({...valid,TRACKING_BASE_URL:'http://track.example.com'})).toThrow('TRACKING_BASE_URL (HTTPS origin)');
  expect(()=>assertProductionEmailConfig({...valid,NEXT_PUBLIC_APP_URL:'https://localhost'})).toThrow('NEXT_PUBLIC_APP_URL (HTTPS origin)');
  expect(()=>assertProductionEmailConfig({...valid,TRACKING_BASE_URL:'https://127.42.1.2'})).toThrow('TRACKING_BASE_URL (HTTPS origin)');
  expect(()=>assertProductionEmailConfig({...valid,PUBLIC_MEDIA_URL:'https://preview.localhost'})).toThrow('PUBLIC_MEDIA_URL (HTTPS origin)');
  expect(()=>assertProductionEmailConfig({...valid,PUBLIC_MEDIA_URL:'https://user:pass@api.example.com'})).toThrow('PUBLIC_MEDIA_URL (HTTPS origin)');
  expect(()=>assertProductionEmailConfig({...valid,SESSION_SECRET:'short'})).toThrow('SESSION_SECRET');
 });
});

describe('trusted reverse proxy configuration',()=>{
 it('defaults to no proxy trust in development and requires an explicit production hop count',()=>{
  expect(trustedProxyHops({NODE_ENV:'development'})).toBe(0);
  expect(()=>trustedProxyHops({NODE_ENV:'production'})).toThrow('TRUST_PROXY_HOPS');
  expect(trustedProxyHops({NODE_ENV:'production',TRUST_PROXY_HOPS:'1'})).toBe(1);
 });
 it('rejects malformed or excessive proxy hop counts',()=>{
  for(const value of ['-1','1.5','5','trusted',''])expect(()=>trustedProxyHops({NODE_ENV:'production',TRUST_PROXY_HOPS:value})).toThrow('TRUST_PROXY_HOPS');
 });
});

describe('production infrastructure configuration',()=>{
 it('requires non-loopback PostgreSQL and Redis endpoints only in production',()=>{
  const valid={NODE_ENV:'production',DATABASE_URL:'postgresql://repus:secret@db.example.com:5432/repus',REDIS_URL:'rediss://cache.example.com:6380'};
  expect(()=>assertProductionInfrastructureConfig(valid)).not.toThrow();
  expect(()=>assertProductionInfrastructureConfig({NODE_ENV:'development'})).not.toThrow();
  expect(()=>assertProductionInfrastructureConfig({...valid,DATABASE_URL:'postgresql://localhost/repus'})).toThrow('DATABASE_URL (remote PostgreSQL connection)');
  expect(()=>assertProductionInfrastructureConfig({...valid,REDIS_URL:'redis://127.0.0.1:6379'})).toThrow('REDIS_URL (remote Redis connection)');
  expect(()=>assertProductionInfrastructureConfig({...valid,REDIS_URL:'http://cache.example.com'})).toThrow('REDIS_URL (remote Redis connection)');
  expect(()=>assertProductionInfrastructureConfig({...valid,PLATFORM_TIMEZONE:'Mars/Olympus'})).toThrow('PLATFORM_TIMEZONE (valid IANA timezone)');
 });
});
