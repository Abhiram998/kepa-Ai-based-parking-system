import { Link, useLocation } from "wouter";
import { Car, ShieldCheck, Home, Menu, User, BarChart3, LayoutDashboard, QrCode, FileText } from "lucide-react";
import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useParking } from "@/lib/parking-context";
import { API_BASE_URL } from "@/lib/api";

export default function Layout({ children }: { children: React.ReactNode }) {
  const { isAdmin } = useParking();
  const [location] = useLocation();
  const [isOpen, setIsOpen] = useState(false);

  // Keep backend awake (Render Cold Start Fix)
  useEffect(() => {
    const keepWarm = setInterval(() => {
      fetch(`${API_BASE_URL}/api/health`).catch(() => {});
    }, 4 * 60 * 1000); // Pulse every 4 minutes (Render timeout is ~15-30m of inactivity)
    return () => clearInterval(keepWarm);
  }, []);

  // Don't show layout on login pages
  if (location === '/login' || location === '/admin/login') {
    return <>{children}</>;
  }

  const NavLinks = () => (
    <>
      <Link href="/">
        <div className={`flex items-center gap-2 px-4 py-2 rounded-md transition-colors cursor-pointer ${location === '/' ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:text-primary'}`}>
          <Home className="w-4 h-4" />
          <span>Home</span>
        </div>
      </Link>
      
      {!isAdmin && (
        <Link href="/predictions">
          <div className={`flex items-center gap-2 px-4 py-2 rounded-md transition-colors cursor-pointer ${location === '/predictions' ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:text-primary'}`}>
            <BarChart3 className="w-4 h-4" />
            <span>Forecast</span>
          </div>
        </Link>
      )}

      {isAdmin && (
        <div className="flex items-center gap-1">
          <Link href="/report">
            <div className={`flex items-center gap-2 px-4 py-2 rounded-md transition-colors cursor-pointer ${location === '/report' ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:text-primary'}`}>
              <FileText className="w-4 h-4" />
              <span>Report</span>
            </div>
          </Link>
          <Link href="/backup">
            <div className={`flex items-center gap-2 px-4 py-2 rounded-md transition-colors cursor-pointer ${location === '/backup' ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:text-primary'}`}>
              <ShieldCheck className="w-4 h-4" />
              <span>Backup</span>
            </div>
          </Link>
          <Link href="/admin">
            <div className={`flex items-center gap-2 px-4 py-2 rounded-md transition-colors cursor-pointer ${location === '/admin' ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:text-primary'}`}>
              <LayoutDashboard className="w-4 h-4" />
              <span>Admin</span>
            </div>
          </Link>
          <Link href="/admin/profile">
            <div className={`flex items-center gap-2 px-4 py-2 rounded-md transition-colors cursor-pointer ${location === '/admin/profile' ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:text-primary'}`}>
              <User className="w-4 h-4" />
              <span>Profile</span>
            </div>
          </Link>
        </div>
      )}
    </>
  );

  return (
    <div className="min-h-screen bg-background font-sans">
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/">
              <div className="flex items-center gap-3 cursor-pointer">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center text-white shadow-lg shadow-primary/20">
                  <Car className="w-6 h-6" />
                </div>
                <div>
                  <h1 className="text-lg font-bold leading-tight text-foreground">Nilakkal Parking</h1>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Sabarimala Base Camp</p>
                </div>
              </div>
            </Link>
          </div>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-1">
            <NavLinks />
            {!isAdmin && (
              <Link href="/admin/login">
                <Button variant="ghost" size="sm" className="ml-2 gap-2">
                  <ShieldCheck className="w-4 h-4" />
                  Admin
                </Button>
              </Link>
            )}
          </nav>

          {/* Mobile Nav */}
          <div className="md:hidden">
            <Sheet open={isOpen} onOpenChange={setIsOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Menu className="w-5 h-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-[250px]">
                <div className="flex flex-col gap-2 mt-8">
                  <NavLinks />
                  <div className="mt-auto border-t pt-4">
                    <Link href="/admin/login">
                      <Button variant="outline" className="w-full gap-2">
                        <ShieldCheck className="w-4 h-4" /> Admin Login
                      </Button>
                    </Link>
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 pb-20">
        {children}
      </main>
    </div>
  );
}
