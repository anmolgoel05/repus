import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

type ErrorBody={statusCode:number;code:string;message:string|string[];requestId:string};

export function formatApiError(exception:unknown,requestId:string):ErrorBody{
 const statusCode=exception instanceof HttpException?exception.getStatus():500;
 if(statusCode===503)return {statusCode,code:'SERVICE_UNAVAILABLE',message:'Service is temporarily unavailable. Try again shortly.',requestId};
 const code=statusCode>=500?'INTERNAL_SERVER_ERROR':({400:'BAD_REQUEST',401:'UNAUTHORIZED',403:'FORBIDDEN',404:'NOT_FOUND',409:'CONFLICT',413:'PAYLOAD_TOO_LARGE',429:'RATE_LIMITED'} as Record<number,string>)[statusCode]??`HTTP_${statusCode}`;
 if(statusCode>=500)return {statusCode,code,message:'An unexpected error occurred.',requestId};
 const response=exception instanceof HttpException?exception.getResponse():undefined;
 const raw=typeof response==='string'?response:(response&&typeof response==='object'?'message' in response?(response as {message?:unknown}).message:undefined:undefined);
 const message=typeof raw==='string'?raw:Array.isArray(raw)&&raw.every(item=>typeof item==='string')?raw:'Request failed.';
 return {statusCode,code,message,requestId};
}

export function apiServerErrorMetricEvent(timestamp=Date.now()):Record<string,unknown>{
 return {_aws:{Timestamp:timestamp,CloudWatchMetrics:[{Namespace:'Repus/API',Dimensions:[[]],Metrics:[{Name:'ServerErrors',Unit:'Count'}]}]},ServerErrors:1};
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
 private readonly logger=new Logger(ApiExceptionFilter.name);
 catch(exception:unknown,host:ArgumentsHost){
  const http=host.switchToHttp(),request=http.getRequest<Request&{requestId?:string}>(),response=http.getResponse<Response>();
  const requestId=request.requestId??randomUUID(),body=formatApiError(exception,requestId);
  if(body.statusCode>=500){this.logger.error(`Unhandled API exception requestId=${requestId} type=${exception instanceof Error?exception.name:'unknown'}`);if(process.env.NODE_ENV==='production')console.info(JSON.stringify(apiServerErrorMetricEvent()));}
  if(response.headersSent||response.destroyed)return;
  response.setHeader('x-request-id',requestId);response.setHeader('Cache-Control','no-store');response.status(body.statusCode).json(body);
 }
}
