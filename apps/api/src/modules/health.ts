import { Controller, Get, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {Response} from 'express';
import {prisma} from '@repus/database';
import {RedisThrottlerStorage} from './redis-throttler-storage';
import {checkApiReadiness} from './health-readiness';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(private readonly redis:RedisThrottlerStorage){}
  @Get('health') getHealth() { return { status: 'ok', service: 'repus-api', timestamp: new Date().toISOString() }; }
  @Get('health/ready') async ready(@Res() response:Response){const result=await checkApiReadiness({database:()=>prisma.$queryRaw`SELECT 1`,redis:()=>this.redis.ping()});return response.status(result.status==='ok'?200:503).json(result);}
}
