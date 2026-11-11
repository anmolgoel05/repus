import {describe,expect,it} from 'vitest';
import {BadRequestException,NotFoundException,ServiceUnavailableException} from '@nestjs/common';
import {apiServerErrorMetricEvent,formatApiError} from './api-exception.filter';

describe('API error contract',()=>{
 it('preserves safe client messages and validation details in the documented shape',()=>{
  expect(formatApiError(new BadRequestException({message:['email must be an email'],error:'Bad Request',statusCode:400}),'req-123')).toEqual({statusCode:400,code:'BAD_REQUEST',message:['email must be an email'],requestId:'req-123'});
  expect(formatApiError(new NotFoundException('Campaign not found.'),'req-456')).toEqual({statusCode:404,code:'NOT_FOUND',message:'Campaign not found.',requestId:'req-456'});
 });
 it('never exposes internal exception text to API callers',()=>{
  expect(formatApiError(new Error('password hash query failed for private@example.com'),'req-789')).toEqual({statusCode:500,code:'INTERNAL_SERVER_ERROR',message:'An unexpected error occurred.',requestId:'req-789'});
 });
 it('provides retry guidance for service outages without exposing dependency details',()=>{
  expect(formatApiError(new ServiceUnavailableException('private.redis.test'),'req-503')).toEqual({statusCode:503,code:'SERVICE_UNAVAILABLE',message:'Service is temporarily unavailable. Try again shortly.',requestId:'req-503'});
 });
 it('emits a low-cardinality aggregate 5xx metric without request or tenant data',()=>{
  const metric=apiServerErrorMetricEvent(1234);
  expect(metric).toMatchObject({ServerErrors:1,_aws:{Timestamp:1234,CloudWatchMetrics:[{Namespace:'Repus/API',Dimensions:[[]]}]}});
  expect(JSON.stringify(metric)).not.toMatch(/tenant|email|request/i);
 });
});
