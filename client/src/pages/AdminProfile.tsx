import { useParking } from "@/lib/parking-context";
import { apiPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { LogOut, Shield, Phone, User, BadgeCheck, Mail, MapPin, UserPlus } from "lucide-react";
import { useLocation } from "wouter";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

export default function AdminProfile() {
  const { logoutAdmin, isAdmin, adminUser } = useParking();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [newAdminOpen, setNewAdminOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    policeId: "",
    email: "",
    password: ""
  });

  if (!isAdmin) {
    setLocation("/admin/login");
    return null;
  }

  // Get user initials for avatar fallback
  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const handleLogout = () => {
    logoutAdmin();
    setLocation("/");
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      await apiPost("/api/admin/officers", {
        name: formData.name,
        policeId: formData.policeId,
        email: formData.email,
        password: formData.password,
      });

      toast({
        title: "Officer Registered",
        description: `${formData.name} has been added successfully.`,
      });

      setNewAdminOpen(false);
      setFormData({
        name: "",
        policeId: "",
        email: "",
        password: "",
      });
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Registration Failed",
        description: err.message || "Unable to register officer",
      });
    }
  };


  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Admin Profile</h1>
        <div className="flex gap-2">
          <Dialog open={newAdminOpen} onOpenChange={setNewAdminOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2">
                <UserPlus className="w-4 h-4" />
                Register Officer
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Register New Officer</DialogTitle>
                <DialogDescription>
                  Create a new access profile for an authorized officer.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleRegister} className="grid gap-4 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="name" className="text-right">
                    Name
                  </Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="col-span-3"
                    required
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="policeId" className="text-right">
                    Police ID
                  </Label>
                  <Input
                    id="policeId"
                    value={formData.policeId}
                    onChange={(e) => setFormData({ ...formData, policeId: e.target.value })}
                    className="col-span-3"
                    required
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="email" className="text-right">
                    Email
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="col-span-3"
                    required
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="password" className="text-right">
                    Password
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="col-span-3"
                    required
                  />
                </div>
                <DialogFooter>
                  <Button type="submit">Register Officer</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          <Badge variant="outline" className="gap-1 px-3 py-1 border-primary/50 text-primary bg-primary/10">
            <Shield className="w-3 h-3 fill-current" />
            Official Access
          </Badge>
        </div>
      </div>

      <Card className="border-primary/20 shadow-lg overflow-hidden">
        <div className="h-32 bg-gradient-to-r from-primary/20 to-blue-600/20 relative">
          <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1508898578281-774ac4893c0c?auto=format&fit=crop&w=1200&q=80')] bg-cover bg-center opacity-10 mix-blend-overlay"></div>
        </div>

        <div className="px-8 pb-8 relative">
          <div className="flex flex-col sm:flex-row items-start sm:items-end -mt-12 mb-6 gap-4">
            <Avatar className="w-24 h-24 border-4 border-background shadow-xl">
              <AvatarImage src="https://github.com/shadcn.png" />
              <AvatarFallback className="text-2xl bg-primary text-primary-foreground">
                {adminUser ? getInitials(adminUser.name) : 'AD'}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 pt-2">
              <h2 className="text-2xl font-bold">{adminUser?.name || 'Admin User'}</h2>
              <p className="text-muted-foreground">{adminUser?.role || 'Parking Coordinator'}</p>
            </div>
            <Button variant="destructive" onClick={handleLogout} className="gap-2 shadow-sm">
              <LogOut className="w-4 h-4" />
              Logout
            </Button>
          </div>

          <div className="grid gap-6">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1 p-4 rounded-lg bg-muted/50 border border-border/50">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <BadgeCheck className="w-4 h-4 text-primary" />
                  Police ID
                </div>
                <div className="text-lg font-mono font-semibold tracking-wide">{adminUser?.policeId || 'N/A'}</div>
              </div>

              <div className="space-y-1 p-4 rounded-lg bg-muted/50 border border-border/50">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <User className="w-4 h-4 text-primary" />
                  User ID
                </div>
                <div className="text-lg font-mono font-semibold tracking-wide">#{adminUser?.id || 'N/A'}</div>
              </div>

              <div className="space-y-1 p-4 rounded-lg bg-muted/50 border border-border/50">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Mail className="w-4 h-4 text-primary" />
                  Official Email
                </div>
                <div className="text-lg font-semibold">{adminUser?.email || 'N/A'}</div>
              </div>

              <div className="space-y-1 p-4 rounded-lg bg-muted/50 border border-border/50">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <MapPin className="w-4 h-4 text-primary" />
                  Station Base
                </div>
                <div className="text-lg font-semibold">Nilakkal Base Camp</div>
              </div>
            </div>

            <div className="rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900 p-4">
              <h3 className="font-semibold text-blue-800 dark:text-blue-300 mb-2 flex items-center gap-2">
                <Shield className="w-4 h-4" />
                Administrative Privileges
              </h3>
              <ul className="list-disc list-inside text-sm text-blue-700 dark:text-blue-400 space-y-1 ml-1">
                <li>Full access to real-time parking dashboard</li>
                <li>Authority to update zone capacities and status</li>
                <li>Access to vehicle search and tracking system</li>
                <li>Emergency override controls for traffic management</li>
              </ul>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}