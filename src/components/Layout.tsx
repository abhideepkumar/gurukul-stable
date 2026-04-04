import { Link, Outlet, useLocation } from 'react-router-dom';
import { LayoutDashboard, Users, Receipt, CreditCard, FileText, School, LogOut } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { useAuth } from '@/src/lib/auth';
import { useState } from 'react';

const navItems = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Classes', href: '/classes', icon: School },
  { name: 'Students', href: '/students', icon: Users },
  { name: 'Fee Structures', href: '/fees', icon: Receipt },
  { name: 'Payments', href: '/payments', icon: CreditCard },
  { name: 'Reports', href: '/reports', icon: FileText },
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
    <div className="flex min-h-screen bg-slate-50">
      {/* Sidebar */}
      <div className="w-64 flex-shrink-0 border-r border-slate-200 bg-white flex flex-col">
        <div className="flex h-16 items-center border-b border-slate-200 px-6">
          <h1 className="text-lg font-bold text-slate-900">School Ledger</h1>
        </div>
        <nav className="space-y-1 p-4 flex-1" aria-label="Main navigation">
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
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-slate-100 text-slate-900'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                )}
              >
                <item.icon className="h-5 w-5" />
                {item.name}
              </Link>
            );
          })}
        </nav>

        {/* User Footer */}
        <div className="border-t border-slate-200 p-4">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-700">
                {user?.email ?? 'User'}
              </p>
              <p className="text-xs text-slate-400">Admin</p>
            </div>
            <button
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="ml-2 rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-red-600 disabled:opacity-50"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
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
