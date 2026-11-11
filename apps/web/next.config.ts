import type { NextConfig } from 'next';
const config: NextConfig = {
  env: {
    NEXT_PUBLIC_API_URL: (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, ''),
  },
  async headers() {
    const sensitive = ['verify-email', 'reset-password', 'accept-invitation', 'confirm-subscription/:path*', 'dashboard/:path*'];
    return [{
      source: '/:path*',
      headers: [
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
      ],
    }, ...sensitive.map((route) => ({
      source: `/${route}`,
      headers: [
        { key: 'Cache-Control', value: 'private, no-store, no-cache, must-revalidate' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
      ],
    }))];
  },
};
export default config;
