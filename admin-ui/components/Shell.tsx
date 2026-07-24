'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/', label: 'Dashboard' },
  { href: '/gaps', label: 'Gaps' },
  { href: '/audit', label: 'Audit' },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          ROSS <span>Admin</span>
        </div>
        <div className="brand-sub">Digital Rostering Officer</div>
        <nav className="nav">
          {links.map((link) => {
            const active = pathname === link.href;
            return (
              <Link key={link.href} href={link.href} className={active ? 'active' : ''}>
                {link.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
