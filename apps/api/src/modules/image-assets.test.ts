import { describe, expect, it } from 'vitest';
import { detectImage, publicMediaBaseUrl } from './image-validation';

describe('uploaded image signature detection', () => {
  it('accepts PNG, JPEG, and WebP magic bytes', () => {
    expect(detectImage(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toEqual({ extension: 'png', contentType: 'image/png' });
    expect(detectImage(Buffer.from([255, 216, 255, 0]))).toEqual({ extension: 'jpg', contentType: 'image/jpeg' });
    expect(detectImage(Buffer.from('RIFF1234WEBP'))).toEqual({ extension: 'webp', contentType: 'image/webp' });
  });

  it('rejects MIME-only disguises and unsupported formats', () => {
    expect(detectImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(detectImage(Buffer.from([137, 80, 78]))).toBeNull();
  });

  it('requires an HTTPS public media origin in production', () => {
    const prior = { env: process.env.NODE_ENV, publicUrl: process.env.PUBLIC_MEDIA_URL, apiUrl: process.env.API_URL };
    try {
      process.env.NODE_ENV = 'production';
      process.env.PUBLIC_MEDIA_URL = 'http://media.example.com';
      expect(() => publicMediaBaseUrl()).toThrow('HTTPS in production');
      process.env.PUBLIC_MEDIA_URL = 'https://media.example.com';
      expect(publicMediaBaseUrl()).toBe('https://media.example.com');
    } finally {
      if (prior.env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prior.env;
      if (prior.publicUrl === undefined) delete process.env.PUBLIC_MEDIA_URL; else process.env.PUBLIC_MEDIA_URL = prior.publicUrl;
      if (prior.apiUrl === undefined) delete process.env.API_URL; else process.env.API_URL = prior.apiUrl;
    }
  });
});
