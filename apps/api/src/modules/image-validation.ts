export function detectImage(bytes: Buffer): { extension: string; contentType: string } | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { extension: 'png', contentType: 'image/png' };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { extension: 'jpg', contentType: 'image/jpeg' };
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return { extension: 'webp', contentType: 'image/webp' };
  return null;
}

export function publicMediaBaseUrl() {
  const configured = process.env.PUBLIC_MEDIA_URL ?? (process.env.NODE_ENV === 'production' ? '' : process.env.API_URL ?? 'http://localhost:4000');
  let url: URL;
  try { url = new URL(configured); } catch { throw new Error('PUBLIC_MEDIA_URL must be configured as the public media origin.'); }
  if ((process.env.NODE_ENV === 'production' && url.protocol !== 'https:') || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('PUBLIC_MEDIA_URL must be a clean public HTTP(S) origin (HTTPS in production).');
  return url.origin;
}
