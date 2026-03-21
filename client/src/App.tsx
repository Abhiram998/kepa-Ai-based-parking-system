import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ParkingProvider, useParking } from "@/lib/parking-context";
import ThemeWrapper from "@/components/shared/ThemeWrapper";
import Layout from "@/components/layout/Layout";
import Home from "@/pages/Home";
import Admin from "@/pages/Admin";
import Report from "@/pages/Report";
import Backup from "@/pages/Backup";
import Login from "@/pages/Login";
import AdminLogin from "@/pages/AdminLogin";
import AdminProfile from "@/pages/AdminProfile";
import AreaDetails from "@/pages/AreaDetails";
import Predictions from "@/pages/Predictions";
import Ticket from "@/pages/Ticket";
import Profile from "@/pages/Profile";
import QRCode from "@/pages/QRCode";
import NotFound from "@/pages/not-found";
import PoliceBackup, { VehicleRecord } from "@/components/PoliceBackup";

function Router() {
  return (
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