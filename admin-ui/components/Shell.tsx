'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const links = [
  { href: '/', label: 'Dashboard' },
  { href: '/planner', label: 'Planner' },
  { href: '/gaps', label: 'Gaps' },
  { href: '/confirms', label: 'Confirms' },
  { href: '/swaps', label: 'Swaps' },
  { href: '/config', label: 'Config' },
  { href: '/audit', label: 'Audit' },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [pending, setPending] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch('/api/proposals');
        const json = await res.json();
        if (alive && res.ok) setPending(json.pendingCount ?? 0);
      } catch {
        /* ignore badge failures */
      }
    };
    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [pathname]);

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
            const showBadge = link.href === '/' && pending > 0;
            return (
              <Link key={link.href} href={link.href} className={active ? 'active' : ''}>
                <span>{link.label}</span>
                {showBadge ? <span className="nav-badge">{pending}</span> : null}
              </Link>
            );
          })}
        </nav>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
