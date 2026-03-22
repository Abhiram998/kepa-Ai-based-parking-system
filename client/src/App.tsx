import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ParkingProvider } from "@/lib/parking-context";
import ThemeWrapper from "@/components/shared/ThemeWrapper";
import Layout from "@/components/layout/Layout";
import { lazy, Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";

// Lazy Load Pages
const Home = lazy(() => import("@/pages/Home"));
const Admin = lazy(() => import("@/pages/Admin"));
const Report = lazy(() => import("@/pages/Report"));
const Backup = lazy(() => import("@/pages/Backup"));
const AdminLogin = lazy(() => import("@/pages/AdminLogin"));
const AdminProfile = lazy(() => import("@/pages/AdminProfile"));
const AreaDetails = lazy(() => import("@/pages/AreaDetails"));
const Predictions = lazy(() => import("@/pages/Predictions"));
const Ticket = lazy(() => import("@/pages/Ticket"));
const QRCode = lazy(() => import("@/pages/QRCode"));
const NotFound = lazy(() => import("@/pages/not-found"));

const PageLoading = () => (
  <div className="p-8 space-y-4">
    <Skeleton className="h-12 w-3/4" />
    <Skeleton className="h-64 w-full" />
    <div className="grid grid-cols-3 gap-4">
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  </div>
);

function Router() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/report" component={Report} />
        <Route path="/backup" component={Backup} />
        <Route path="/admin" component={Admin} />
        <Route path="/admin/login" component={AdminLogin} />
        <Route path="/admin/profile" component={AdminProfile} />
        <Route path="/zone/:id" component={AreaDetails} />
        <Route path="/predictions" component={Predictions} />
        <Route path="/ticket" component={Ticket} />
        <Route path="/qr-code" component={QRCode} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ParkingProvider>
          <Toaster />
          <ThemeWrapper>
            <Layout>
              <Router />
            </Layout>
          </ThemeWrapper>
        </ParkingProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;