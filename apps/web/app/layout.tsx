import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'Repus — Email marketing, made simple.', description: 'Build thoughtful email campaigns and grow your audience with Repus.' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
