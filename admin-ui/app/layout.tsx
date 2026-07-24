import type { Metadata } from 'next';
import { Shell } from '@/components/Shell';
import './globals.css';

export const metadata: Metadata = {
  title: 'Ross Admin',
  description: 'Ross the Roster Agent — human oversight dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
