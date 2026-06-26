import { Link, Outlet, useLocation } from 'react-router-dom';
import { cn } from '@/src/lib/utils';
import { useAuth } from '@/src/lib/auth';
import { useState } from 'react';

const navItems = [
  { name: 'Dashboard', href: '/', icon: 'dashboard' },
  { name: 'Classes', href: '/classes', icon: 'school' },
  { name: 'Students', href: '/students', icon: 'group' },
  { name: 'Fee Structures', href: '/fees', icon: 'receipt_long' },
  { name: 'Discounts', href: '/discounts', icon: 'sell' },
  { name: 'Late Fees', href: '/late-fees', icon: 'schedule' },
  { name: 'Payments', href: '/payments', icon: 'credit_card' },
  { name: 'Reports', href: '/reports', icon: 'description' },
];

export function Layout() {
  const location = useLocation();
  const { user, signOut } = useAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    if (!confirm('Are you sure you want to sign out?')) return;
    setIsLoggingOut(true);
    await signOut();
  };

  return (
    <div className="flex min-h-screen bg-surface font-body text-primary">
      {/* Sidebar */}
      <div className="w-72 m-4 rounded-[2rem] bg-white/70 backdrop-blur-xl border border-primary/5 editorial-shadow flex flex-col flex-shrink-0 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-white/40 to-transparent pointer-events-none" />
        <div className="relative flex h-24 items-center px-8 border-b border-primary/5">
          <h1 className="text-2xl font-headline font-semibold text-primary">School Ledger</h1>
        </div>
        <nav className="relative space-y-2 p-6 flex-1" aria-label="Main navigation">
          {navItems.map((item) => {
            const isActive =
              item.href === '/'
                ? location.pathname === '/'
                : location.pathname.startsWith(item.href);
            return (
              <Link
                key={item.name}
                to={item.href}
                className={cn(
                  'flex items-center gap-4 rounded-full px-5 py-3.5 text-sm font-medium transition-all duration-300',
                  isActive
                    ? 'bg-primary/10 text-primary font-bold editorial-shadow'
                    : 'text-primary/70 hover:bg-primary/5 hover:text-primary'
                )}
              >
                <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
                {item.name}
              </Link>
            );
          })}
        </nav>

        {/* User Footer */}
        <div className="relative border-t border-primary/5 p-6 bg-primary/5 rounded-b-[2rem]">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-primary">
                {user?.email ?? 'User'}
              </p>
              <p className="text-xs text-primary/60">Admin</p>
            </div>
            <button
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="ml-2 rounded-full p-2.5 text-primary/60 transition-colors hover:bg-error/10 hover:text-error disabled:opacity-50"
              title="Sign out"
              aria-label="Sign out"
            >
              <span className="material-symbols-outlined text-[20px]">logout</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto" id="main-content">
        <div className="p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
