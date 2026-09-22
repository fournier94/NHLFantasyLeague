import { Outlet } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { TopBar } from '@/components/layout/TopBar';

/**
 * Shell shared by every page: permanent left sidebar, contextual top bar,
 * and the current page rendered by <Outlet />.
 */
export function Layout() {
  return (
    // TooltipProvider is required by the sidebar tooltips (collapsed mode).
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className='bg-background'>
          <header className='flex items-center gap-3 border-b border-border px-4 py-3'>
            <SidebarTrigger />
            <TopBar />
          </header>
          <main className='flex-1 p-6'>
            <Outlet />
          </main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
