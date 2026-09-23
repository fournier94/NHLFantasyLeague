import { Outlet } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';

/**
 * Shell shared by every page: horizontal top navigation and the current
 * page rendered by <Outlet />.
 */
export function Layout() {
  return (
    <div className='flex min-h-screen flex-col bg-background'>
      <header className='flex items-center gap-3 border-b border-border px-4 py-3'>
        <TopBar />
      </header>
      <main className='flex-1 p-6'>
        <Outlet />
      </main>
    </div>
  );
}
