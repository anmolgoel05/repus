import './production-preflight';
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { RequestMethod } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { AppModule } from './module';
import { ApiExceptionFilter } from './api-exception.filter';
import {trustedProxyHops} from '@repus/validation';
import {setSensitiveResponseHeaders} from './modules/sensitive-response';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  app.getHttpAdapter().getInstance().set('trust proxy',trustedProxyHops(process.env));
  app.setGlobalPrefix('api/v1', { exclude: [
    { path: 'unsubscribe/:token', method: RequestMethod.GET },
    { path: 'unsubscribe/:token', method: RequestMethod.POST },
    { path: 't/open/:token', method: RequestMethod.GET },
    { path: 't/click/:token', method: RequestMethod.GET },
    { path: 'media/assets/:token', method: RequestMethod.GET },
  ] });
  app.use(helmet());
  app.use(cookieParser());
  app.use((req:any,res:any,next:any)=>{
    if(/^\/api\/v1(?:\/|$)/.test(String(req.path??'')))setSensitiveResponseHeaders(res);
    next();
  });
  app.use((req:any,res:any,next:any)=>{req.requestId=randomUUID();res.setHeader('x-request-id',req.requestId);next();});
  app.enableCors({ origin: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').origin, credentials: true });
  app.use((req:any,res:any,next:any)=>{
    const token=req.cookies?.repus_session as string|undefined;
    if(!token)return next();
    const origin=req.get('origin');
    if(['POST','PATCH','PUT','DELETE'].includes(req.method)&&!req.path.startsWith('/unsubscribe/')){
      const allowed=new URL(process.env.NEXT_PUBLIC_APP_URL??'http://localhost:3000').origin;
      let requestOrigin='';try{requestOrigin=origin?new URL(origin).origin:''}catch{ /* Invalid origins remain rejected below. */ }
      if(requestOrigin!==allowed)return res.status(403).json({statusCode:403,code:'CSRF_REJECTED',message:'Please refresh the page and try again.',requestId:req.requestId});
    }
    next();
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  app.useGlobalFilters(new ApiExceptionFilter());
  const swagger = new DocumentBuilder().setTitle('Repus API').setDescription('Email marketing API').setVersion('1.0').addCookieAuth('repus_session').addBearerAuth().build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swagger));
  await app.listen(Number(process.env.PORT ?? 4000), '0.0.0.0');
}

void bootstrap();
