import {CallHandler,ExecutionContext,Injectable,NestInterceptor,UnauthorizedException} from '@nestjs/common';
import {from,lastValueFrom,Observable,of,throwError} from 'rxjs';
import {mergeMap} from 'rxjs/operators';
import {withApiKey,withSessionToken} from '@repus/database';
import {tokenHash} from '@repus/token-security';

@Injectable()
export class TenantContextInterceptor implements NestInterceptor{
 intercept(context:ExecutionContext,next:CallHandler):Observable<unknown>{
  const request=context.switchToHttp().getRequest();const requestPath=String(request.path??'');if(/^\/(?:api\/v1\/)?(?:confirm-subscription|unsubscribe|t|abuse-reports)(?:\/|$)/.test(requestPath)||/^\/(?:api\/v1\/)?auth\/(?:register|login|verify-email|verification\/resend|password-reset\/(?:request|confirm))\/?$/.test(requestPath)||/^\/(?:api\/v1\/)?organizations\/invitations\/accept\/?$/.test(requestPath))return next.handle();if(request.method==='GET'&&/^\/media\/assets\/[A-Za-z0-9_-]+$/.test(requestPath))return next.handle();const authorization=String(request.headers?.authorization??'');const bearer=authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if(bearer?.startsWith('rps_live_')){request.cookies??={};request.cookies.repus_session=bearer;const routePath=String(request.path??'');const timeout=routePath.includes('/contacts/import')?300_000:routePath.includes('/contacts/export')?120_000:15_000;return from(withApiKey(tokenHash(bearer),()=>lastValueFrom(next.handle()),{maxWait:10_000,timeout})).pipe(mergeMap(result=>result.authorized?of(result.value):throwError(()=>new UnauthorizedException('This API key is invalid, expired, or revoked.'))));}
  const token=request.cookies?.repus_session as string|undefined;
  if(!token)return next.handle();
  const routePath=String(request.path??'');
  if(routePath.startsWith('/api/v1/admin')||routePath.startsWith('/admin'))return next.handle();
  const timeout=routePath.includes('/contacts/import')?300_000:routePath.includes('/contacts/export')?120_000:15_000;
  return from(withSessionToken(tokenHash(token),()=>lastValueFrom(next.handle()),{maxWait:10_000,timeout}));
 }
}
