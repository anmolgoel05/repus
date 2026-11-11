import { BadRequestException, ConflictException, Controller, Delete, ForbiddenException, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { diskStorage } from 'multer';
import { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { promises as fs } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { AuthService } from './auth';
import { prisma, withImageToken } from '@repus/database';
import { deletePrivateImage, getPrivateImageStream, putPrivateImage } from '@repus/import-storage';
import { createOpaqueToken, decryptToken, encryptToken, tokenHash } from '@repus/token-security';
import { detectImage, publicMediaBaseUrl } from './image-validation';
import { canStoreImage } from './image-storage-quota';

const IMAGE_LIMIT = 5 * 1024 * 1024;
const imageUpload = FileInterceptor('file', {
  storage: diskStorage({ destination: tmpdir(), filename: (_req, _file, callback) => callback(null, `${randomUUID()}.upload`) }),
  limits: { fileSize: IMAGE_LIMIT, files: 1 },
  fileFilter: (_req, file, callback) => callback(['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype) ? null : new BadRequestException('Choose a PNG, JPEG, or WebP image.'), ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)),
});

@Injectable()
export class ImageAssetsService {
  constructor(private auth: AuthService) {}

  async upload(req: Request, file?: Express.Multer.File) {
    if (!file?.path) throw new BadRequestException('Choose an image to upload.');
    try {
      const user = await this.auth.authenticate(req.cookies?.repus_session as string | undefined);
      if (user.role === 'VIEWER') throw new ForbiddenException('You have read-only access to this workspace.');
      const bytes = await fs.readFile(file.path);
      const image = detectImage(bytes);
      if (!image || image.contentType !== file.mimetype || bytes.length > IMAGE_LIMIT) throw new BadRequestException('The image file is invalid or does not match its file type. Use PNG, JPEG, or WebP up to 5 MB.');
      const mediaBase = publicMediaBaseUrl();
      const id = randomUUID();
      const objectKey = `${user.tenantId}/${id}.${image.extension}`;
      const rawToken = createOpaqueToken();
      let usageAfterBytes = bytes.length;
      let usageLimitBytes = 104857600;
      try {
        await prisma.$transaction(async tx => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${user.tenantId}, 781239))`;
          const [limits, usage] = await Promise.all([
            tx.tenantSendingLimit.findUnique({ where: { tenantId: user.tenantId }, select: { mediaStorageLimitBytes: true } }),
            tx.imageAsset.aggregate({ where: { tenantId: user.tenantId }, _sum: { byteSize: true } }),
          ]);
          const usedBytes = usage._sum.byteSize ?? 0;
          const limitBytes = limits?.mediaStorageLimitBytes ?? 104857600;
          if (!canStoreImage(usedBytes, bytes.length, limitBytes)) throw new ForbiddenException('Your image storage limit has been reached. Delete unused images or contact Repus support to increase the limit.');
          usageAfterBytes = usedBytes + bytes.length;
          usageLimitBytes = limitBytes;
          await putPrivateImage(file.path, objectKey, image.contentType);
          await tx.imageAsset.create({ data: { id, tenantId: user.tenantId, objectKey, contentType: image.contentType, byteSize: bytes.length, tokenHash: tokenHash(rawToken), tokenEncrypted: encryptToken(rawToken, process.env.SESSION_SECRET ?? '') } });
        }, { maxWait: 5000, timeout: 30000 });
      } catch (error) {
        await deletePrivateImage(objectKey).catch(() => {});
        throw error;
      }
      return { id, url: `${mediaBase}/media/assets/${rawToken}`, contentType: image.contentType, byteSize: bytes.length, usage: { usedBytes: usageAfterBytes, limitBytes: usageLimitBytes } };
    } finally {
      await fs.rm(file.path, { force: true }).catch(() => {});
    }
  }

  async serve(token: string, response: Response) {
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) throw new NotFoundException('Image not found.');
    const asset = await withImageToken(tokenHash(token), async value => value);
    if (!asset) throw new NotFoundException('Image not found.');
    response.setHeader('Content-Type', asset.contentType);
    response.setHeader('Content-Length', String(asset.byteSize));
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    await pipeline(await getPrivateImageStream(asset.objectKey), response);
  }

  async list(req: Request) {
    const user = await this.auth.authenticate(req.cookies?.repus_session as string | undefined);
    const assets = await prisma.imageAsset.findMany({ where: { tenantId: user.tenantId }, orderBy: { createdAt: 'desc' }, take: 200, select: { id: true, contentType: true, byteSize: true, tokenEncrypted: true, createdAt: true } });
    const mediaBase = publicMediaBaseUrl();
    const [usage, limits] = await Promise.all([
      prisma.imageAsset.aggregate({ where: { tenantId: user.tenantId }, _sum: { byteSize: true } }),
      prisma.tenantSendingLimit.findUnique({ where: { tenantId: user.tenantId }, select: { mediaStorageLimitBytes: true } }),
    ]);
    return { assets: assets.map(asset => ({ id: asset.id, contentType: asset.contentType, byteSize: asset.byteSize, createdAt: asset.createdAt, url: `${mediaBase}/media/assets/${decryptToken(asset.tokenEncrypted, process.env.SESSION_SECRET ?? '')}` })), usage: { usedBytes: usage._sum.byteSize ?? 0, limitBytes: limits?.mediaStorageLimitBytes ?? 104857600 } };
  }

  async remove(req: Request, id: string) {
    const user = await this.auth.authenticate(req.cookies?.repus_session as string | undefined);
    if (user.role === 'VIEWER') throw new ForbiddenException('You have read-only access to this workspace.');
    const removed = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${user.tenantId}, 781239))`;
      const asset = await tx.imageAsset.findFirst({ where: { id, tenantId: user.tenantId } });
      if (!asset) throw new NotFoundException('Image not found.');
      const token = decryptToken(asset.tokenEncrypted, process.env.SESSION_SECRET ?? '');
      const url = `${publicMediaBaseUrl()}/media/assets/${token}`;
      const [campaign, templates] = await Promise.all([
        tx.campaign.findFirst({ where: { tenantId: user.tenantId, htmlContent: { contains: url } }, select: { id: true, name: true } }),
        tx.template.findMany({ where: { tenantId: user.tenantId }, select: { id: true, name: true, htmlContent: true, editorJson: true } }),
      ]);
      const template = templates.find(item => item.htmlContent.includes(url) || JSON.stringify(item.editorJson ?? {})!.includes(url));
      if (campaign || template) throw new ConflictException('This image is still used in a saved campaign or template. Remove it there before deleting the image.');
      await tx.imageAsset.delete({ where: { id: asset.id } });
      const [usage, limits] = await Promise.all([
        tx.imageAsset.aggregate({ where: { tenantId: user.tenantId }, _sum: { byteSize: true } }),
        tx.tenantSendingLimit.findUnique({ where: { tenantId: user.tenantId }, select: { mediaStorageLimitBytes: true } }),
      ]);
      return { objectKey: asset.objectKey, usage: { usedBytes: usage._sum.byteSize ?? 0, limitBytes: limits?.mediaStorageLimitBytes ?? 104857600 } };
    }, { maxWait: 5000, timeout: 30000 });
    await deletePrivateImage(removed.objectKey);
    return { success: true, usage: removed.usage };
  }
}

@ApiTags('media')
@Controller()
export class ImageAssetsController {
  constructor(private service: ImageAssetsService) {}

  @Post('media/images')
  @Throttle({ default: { limit: 30, ttl: 60 * 60 * 1000 } })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] } })
  @UseInterceptors(imageUpload)
  async upload(@Req() req: Request, @UploadedFile() file: Express.Multer.File) { return { data: await this.service.upload(req, file) }; }

  @Get('media/images')
  async list(@Req() req: Request) { return { data: await this.service.list(req) }; }

  @ApiExcludeEndpoint()
  @Get('media/assets/:token')
  async serve(@Req() req: Request, @Res() response: Response) { const token=req.params.token; if(typeof token!=='string')throw new NotFoundException('Image not found.'); return this.service.serve(token, response); }

  @Delete('media/images/:id')
  async remove(@Req() req: Request, @Param('id', new ParseUUIDPipe()) id: string) { return { data: await this.service.remove(req, id) }; }
}
