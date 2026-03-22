import { VehicleType } from "@/lib/parking-context";
import { ZoneCard } from "@/components/parking/ZoneCard";
import { MapPin, Search, MoreHorizontal, Activity, Ticket, ScanLine } from "lucide-react";
import { PlateScanner } from "@/components/parking/PlateScanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiGet, apiPost } from "@/lib/api";
import { useEffect } from "react";
import { useParking, ParkingZone } from "@/lib/parking-context";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";

interface DashboardSummary {
  zones: ParkingZone[];
  total_capacity: number;
  total_occupied: number;
  total_vacancy: number;
}

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LabelList
} from 'recharts';

import logo from "@/assets/kerala-police-logo.jpg";

// Local Zone type removed in favor of global ParkingZone from context

type VehicleSearchResult = {
  vehicle: string;
  ticketId: string;
  status: "INSIDE" | "EXITED";
  type: string;
  zone: string;
  entryTime?: string;
  exitTime?: string;
  message?: string;
};

// Helper for duration
const getDuration = (start?: string) => {
  if (!start) return "-";
  const diff = new Date().getTime() - new Date(start).getTime();
  if (diff < 0) return "Just now";
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  if (hours > 0) return `${hours}h ${mins % 60}m`;
  return `${mins} mins`;
};

// Helper for time
const formatTime = (ts?: string) => {
  if (!ts) return "-";
  return new Date(ts).toLocaleTimeString("en-US", { hour: '2-digit', minute: '2-digit' });
};


export default function Home() {
  // 🔐 FIXED: Now using the real global state instead of hardcoded true
  const { isAdmin, enterVehicle } = useParking();
  const { toast } = useToast();

  // 🔹 Use React Query for performance & caching
  const { data: dashboardData, isLoading, isError } = useQuery<DashboardSummary>({
    queryKey: ["/api/dashboard-summary"],
    queryFn: () => apiGet<DashboardSummary>("/api/dashboard-summary"),
    refetchInterval: 10000,
  });

  // 🔹 Zones from backend API
  const zones = dashboardData?.zones || [];

  // 🔹 Derived totals from aggregated data
  const totalCapacity = dashboardData?.total_capacity || 0;
  const totalOccupied = dashboardData?.total_occupied || 0;
  const totalVacancy = dashboardData?.total_vacancy || 0;

  // State for interactive graph
  const [hoveredZone, setHoveredZone] = useState<ParkingZone | null>(null);

  // Ticket Generation State
  const [isTicketOpen, setIsTicketOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false); 
  const [ticketData, setTicketData] = useState({
    vehicleNumber: "",
    zoneId: "",
    slot: "",
    type: "light" as VehicleType
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResult, setSearchResult] = useState<VehicleSearchResult | null>(null);

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center h-[70vh]">
        <div className="text-destructive mb-4 text-4xl font-bold">Connection Error</div>
        <p className="text-muted-foreground max-w-md">
          Unable to connect to the parking backup server. Please check your internet or wait for the system to wake up.
        </p>
        <Button onClick={() => window.location.reload()} className="mt-6">Try Again</Button>
      </div>
    );
  }
  const handleGenerateTicket = async () => {
    if (!ticketData.vehicleNumber) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Please enter a vehicle number",
      });
      return;
    }

    const result = await enterVehicle(
      ticketData.vehicleNumber, 
      ticketData.type, 
      ticketData.zoneId || undefined, 
      ticketData.slot || undefined
    );

    if (result.success) {
      toast({
        title: "Ticket Generated",
        description: `Vehicle ${ticketData.vehicleNumber} parked successfully in ${result.ticket?.zoneName || 'assigned zone'}`,
      });

      setIsTicketOpen(false);
      setTicketData({ vehicleNumber: "", zoneId: "", slot: "", type: "light" });
    } else {
      toast({
        variant: "destructive",
        title: "Generation Failed",
        description: result.message || "Could not generate ticket",
      });
    }
  };


  // Chart Data Preparation
  const barChartData = zones
    .filter(zone => zone.occupied > 0) // ✅ HIDE EMPTY ZONES
    .map((zone, index) => {
      let heavyPct = 0;
      let mediumPct = 0;
      let lightPct = 0;

      if (zone.limits) {
        heavyPct = zone.limits.heavy > 0 ? (zone.stats.heavy / zone.limits.heavy) * 100 : 0;
        mediumPct = zone.limits.medium > 0 ? (zone.stats.medium / zone.limits.medium) * 100 : 0;
        lightPct = zone.limits.light > 0 ? (zone.stats.light / zone.limits.light) * 100 : 0;
      } else {
        heavyPct = zone.capacity > 0 ? (zone.stats.heavy / zone.capacity) * 100 : 0;
        mediumPct = zone.capacity > 0 ? (zone.stats.medium / zone.capacity) * 100 : 0;
        lightPct = zone.capacity > 0 ? (zone.stats.light / zone.capacity) * 100 : 0;
      }

      return {
        name: `P${index + 1}`,
        Heavy: heavyPct,
        Medium: mediumPct,
        Light: lightPct,
        occupied: zone.occupied,
        capacity: zone.capacity,
        limits: zone.limits,
        originalZone: zone
      };
    });

  const activeStats = hoveredZone ? hoveredZone.stats : {
    heavy: zones.reduce((acc, z) => acc + z.stats.heavy, 0),
    medium: zones.reduce((acc, z) => acc + z.stats.medium, 0),
    light: zones.reduce((acc, z) => acc + z.stats.light, 0)
  };

  const activeOccupied = hoveredZone ? hoveredZone.occupied : totalOccupied;
  const activeCapacity = hoveredZone ? hoveredZone.capacity : totalCapacity;
  const activeOccupancyRate = activeCapacity > 0 ? Math.round((activeOccupied / activeCapacity) * 100) : 0;

  const pieData = [
    { name: 'Heavy', value: activeStats.heavy, color: '#1e293b' },
    { name: 'Medium', value: activeStats.medium, color: '#f59e0b' },
    { name: 'Light', value: activeStats.light, color: '#3b82f6' },
  ];

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    try {
      const result = await apiGet<any>(
        `/api/search?q=${encodeURIComponent(searchQuery)}`
      );
      setSearchResult(result);
      setIsSearchOpen(true);
    } catch {
      setSearchResult(null);
      toast({
        variant: "destructive",
        title: "Not Found",
        description: "Vehicle not found in live or history",
      });
    }
  };


  const TopCard = ({ title, value, subValue, dark = false, isVacancy = false }: any) => (
    <div className={`rounded-xl p-3 shadow-sm border relative overflow-hidden group hover:shadow-md transition-all ${dark ? 'bg-[#1a233a] text-white border-none' : 'bg-white border-slate-100 text-slate-800'}`}>
      <div className="flex justify-between items-center mb-0">
        <span className={`text-[10px] font-bold uppercase tracking-wider ${dark ? 'text-slate-300' : 'text-slate-500'}`}>{title}</span>
        <div className={`text-xl font-bold ${isVacancy ? 'text-green-500' : ''}`}>
          {value}
        </div>
      </div>
      {subValue && <div className={`text-[10px] ${dark ? 'text-slate-400' : 'text-slate-400'}`}>{subValue}</div>}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Dashboard Parking Zone</h1>
        </div>
        <div className="flex items-center gap-4">
          <img src={logo} alt="Kerala Police Logo" className="h-20 w-auto object-contain" />
          <Button variant="ghost" size="icon" className="md:hidden">
            <MoreHorizontal />
          </Button>
        </div>
      </div>

      {/* Top Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {isLoading ? (
          <>
            <Skeleton className="h-[74px] rounded-xl" />
            <Skeleton className="h-[74px] rounded-xl" />
            <Skeleton className="h-[74px] rounded-xl" />
            <Skeleton className="h-[74px] rounded-xl" />
          </>
        ) : (
          <>
            <TopCard title="Vacancy" value={totalVacancy} dark={true} isVacancy={true} />
            <TopCard title="Occupancy" value={totalOccupied} />
            <TopCard title="Total Capacity" value={totalCapacity} />

            <div className="rounded-xl p-3 shadow-sm border bg-white border-slate-100 h-full flex items-center gap-3">
              <div className="w-[70px] h-[70px] relative flex-shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      innerRadius={25}
                      outerRadius={35}
                      paddingAngle={0}
                      dataKey="value"
                      stroke="none"
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span className="text-xs font-bold text-slate-700">{activeOccupancyRate}%</span>
                </div>
              </div>

              <div className="flex-1 flex flex-col justify-center gap-1">
                <div className="flex justify-between items-center border-b border-slate-50 pb-1 mb-1">
                  <span className="font-medium text-slate-500 text-xs">Composition</span>
                  <span className="text-[10px] font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-full">
                    {hoveredZone ? `P${zones.findIndex(z => z.id === hoveredZone.id) + 1}` : "Total"}
                  </span>
                </div>

                <div className="space-y-0.5">
                  {pieData.map((item, index) => (
                    <div key={index} className="flex items-center justify-between text-[10px]">
                      <div className="flex items-center gap-1">
                        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: item.color }} />
                        <span className="text-slate-500">{item.name}</span>
                      </div>
                      <span className="font-bold text-slate-700">{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 gap-6 h-full mt-2">
        <div className="space-y-6">

          {/* Bar Chart Section */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 min-h-[400px]">
            {isLoading ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-8 w-64" />
                  <Skeleton className="h-8 w-32" />
                </div>
                <Skeleton className="h-[300px] w-full" />
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-4">
                    <h3 className="font-bold text-slate-700">Live Parking Zone Status (Occupancy %)</h3>

                    {/* 🔐 FEATURE GUARD 1: Generate Ticket (Police Only) */}
                    {isAdmin && (
                      <Button size="sm" onClick={() => setIsTicketOpen(true)} className="bg-blue-600 hover:bg-blue-700 text-white gap-2">
                        <Ticket className="w-4 h-4" /> Generate Ticket
                      </Button>
                    )}
                  </div>
                  <div className="hidden md:flex items-center gap-6">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-[#1e293b] rounded-sm"></div>
                      <span className="text-xs text-slate-500">Heavy</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-[#f59e0b] rounded-sm"></div>
                      <span className="text-xs text-slate-500">Medium</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-[#3b82f6] rounded-sm"></div>
                      <span className="text-xs text-slate-500">Light</span>
                    </div>
                  </div>
                </div>

                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={barChartData}
                      barSize={24}
                      margin={{ top: 20, right: 10, left: 0, bottom: 5 }}
                      onMouseMove={(state: any) => {
                        if (state.activePayload) {
                          setHoveredZone(state.activePayload[0].payload.originalZone);
                        }
                      }}
                      onMouseLeave={() => {
                        setHoveredZone(null);
                      }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis
                        dataKey="name"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: '#64748b', fontSize: 13, fontWeight: 500 }}
                        dy={10}
                        interval={0}
                      />
                      <YAxis
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: '#64748b', fontSize: 12 }}
                        unit="%"
                        domain={[0, 100]}
                        allowDataOverflow={true}
                      />
                      <Tooltip
                        cursor={{ fill: '#f8fafc' }}
                        content={({ active, payload, label }) => {
                          if (active && payload && payload.length) {
                            const data = payload[0].payload;
                            const originalZone = data.originalZone;
                            return (
                              <div className="bg-white p-3 border border-slate-100 shadow-xl rounded-lg text-sm">
                                <p className="font-bold text-slate-800 mb-2">{label}</p>
                                <div className="space-y-1">
                                  <div className="flex items-center justify-between gap-4 text-xs">
                                    <span className="flex items-center gap-1.5 text-slate-500">
                                      <div className="w-2 h-2 rounded-full bg-[#1e293b]"></div>
                                      Heavy
                                    </span>
                                    <span className="font-mono font-medium">
                                      {originalZone.stats.heavy} / {originalZone.limits?.heavy || '-'} ({data.Heavy.toFixed(1)}%)
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between gap-4 text-xs">
                                    <span className="flex items-center gap-1.5 text-slate-500">
                                      <div className="w-2 h-2 rounded-full bg-[#f59e0b]"></div>
                                      Medium
                                    </span>
                                    <span className="font-mono font-medium">
                                      {originalZone.stats.medium} / {originalZone.limits?.medium || '-'} ({data.Medium.toFixed(1)}%)
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between gap-4 text-xs">
                                    <span className="flex items-center gap-1.5 text-slate-500">
                                      <div className="w-2 h-2 rounded-full bg-[#3b82f6]"></div>
                                      Light
                                    </span>
                                    <span className="font-mono font-medium">
                                      {originalZone.stats.light} / {originalZone.limits?.light || '-'} ({data.Light.toFixed(1)}%)
                                    </span>
                                  </div>
                                </div>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Bar dataKey="Heavy" fill="#1e293b" radius={[4, 4, 0, 0]} name="Heavy">
                        <LabelList dataKey="Heavy" position="center" angle={-90} formatter={(value: number) => value > 0 ? `${Math.round(value)}%` : ''} style={{ fill: '#ffffff', fontSize: 10, fontWeight: 'bold' }} />
                      </Bar>
                      <Bar dataKey="Medium" fill="#f59e0b" radius={[4, 4, 0, 0]} name="Medium">
                        <LabelList dataKey="Medium" position="center" angle={-90} formatter={(value: number) => value > 0 ? `${Math.round(value)}%` : ''} style={{ fill: '#ffffff', fontSize: 10, fontWeight: 'bold' }} />
                      </Bar>
                      <Bar dataKey="Light" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Light">
                        <LabelList dataKey="Light" position="center" angle={-90} formatter={(value: number) => value > 0 ? `${Math.round(value)}%` : ''} style={{ fill: '#ffffff', fontSize: 10, fontWeight: 'bold' }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </div>

          {/* Bottom Section: Live Zone Overview & Search */}
          <div className="space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-orange-500" />
                <h3 className="font-bold text-slate-700">Live Parking Zone Overview</h3>
              </div>

              {/* 🔐 FEATURE GUARD 2: Search Widget (Police Only) */}
              {isAdmin && (
                <div className="flex items-center gap-3">
                  <form onSubmit={handleSearch} className="flex gap-2">
                    <Input
                      placeholder="Find Vehicle..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="bg-white w-[180px] h-9 text-sm"
                    />
                    <Button type="submit" size="sm" className="bg-slate-900 text-white h-9 px-3">
                      <Search className="w-3.5 h-3.5" />
                    </Button>
                  </form>
                </div>
              )}
            </div>

            <div className="max-h-[500px] overflow-y-auto pr-2 grid grid-cols-2 md:grid-cols-5 lg:grid-cols-10 gap-2">
              {isLoading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <Skeleton key={i} className="h-24 w-full rounded-lg" />
                  ))
                ) : (
                zones.map((zone, index) => (
                  <ZoneCard
                    key={zone.id}
                    zone={zone}              // ✅ backend ID untouched
                    displayIndex={index + 1} // ✅ UI-only numbering
                  />
                ))
              )}
            </div>
          </div>

        </div>
      </div>

      {/* 🔐 FEATURE GUARD 3: Ticket Dialog (Police Only) */}
      {isAdmin && (
        <Dialog open={isTicketOpen} onOpenChange={setIsTicketOpen} modal={false}>
          <DialogContent
            hideOverlay
            className="sm:max-w-[425px] fixed top-4 right-4 left-auto translate-x-0 translate-y-0"
          >
            <DialogHeader>
              <DialogTitle>Generate Parking Ticket</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="mb-2">
                <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2 block">AI Scanner (Plate & Category)</Label>
                <PlateScanner 
                  onScanResult={(res) => {
                    setTicketData(prev => ({ 
                      ...prev, 
                      vehicleNumber: res.plate || prev.vehicleNumber, 
                      type: (res.vehicle_type as any) || prev.type 
                    }));
                    toast({
                      title: "AI Analysis Complete",
                      description: res.plate 
                        ? `Detected: ${res.plate} (${res.vehicle_type})`
                        : `Suggested Type: ${res.vehicle_type} (Plate not clear)`,
                    });
                  }} 
                />
              </div>

              {ticketData.vehicleNumber && (
                 <div className="flex gap-4 p-2.5 rounded-lg bg-blue-50 border border-blue-100/50 mb-2">
                    <div className="flex-1">
                      <p className="text-[9px] font-bold text-blue-400 uppercase leading-none mb-1">Detected Plate</p>
                      <p className="text-sm font-black text-blue-900 font-mono tracking-tight">{ticketData.vehicleNumber}</p>
                    </div>
                    <div className="flex-1 border-l border-blue-200 pl-4">
                      <p className="text-[9px] font-bold text-blue-400 uppercase leading-none mb-1">Suggested Type</p>
                      <p className="text-sm font-bold text-blue-900 capitalize italic">{ticketData.type}</p>
                    </div>
                 </div>
              )}

              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="vehicle-no" className="text-right">Vehicle No.</Label>
                <Input 
                  id="vehicle-no" 
                  value={ticketData.vehicleNumber} 
                  onChange={(e) => setTicketData({ ...ticketData, vehicleNumber: e.target.value.toUpperCase() })} 
                  className="col-span-3 font-mono font-bold" 
                  placeholder="KL-01-AB-1234" 
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="vehicle-type" className="text-right">Type</Label>
                <Select value={ticketData.type} onValueChange={(val: VehicleType) => setTicketData({ ...ticketData, type: val })}>
                  <SelectTrigger className="col-span-3">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="light">Light Vehicle (Car/Jeep)</SelectItem>
                    <SelectItem value="medium">Medium Vehicle (Van/Mini Bus)</SelectItem>
                    <SelectItem value="heavy">Heavy Vehicle (Bus/Truck)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="zone" className="text-right">Zone</Label>
                <Select value={ticketData.zoneId || "auto"} onValueChange={(val) => setTicketData({ ...ticketData, zoneId: val === "auto" ? "" : val })}>
                  <SelectTrigger className="col-span-3">
                    <SelectValue placeholder="Auto-assign (Any Available)" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[200px]">
                    <SelectItem value="auto">Auto-assign (Any Available)</SelectItem>
                    {zones.map((zone) => (
                      <SelectItem key={zone.id} value={zone.id}>{zone.name} ({zone.capacity - zone.occupied} free)</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="slot" className="text-right">Slot (Opt)</Label>
                <Input id="slot" value={ticketData.slot} onChange={(e) => setTicketData({ ...ticketData, slot: e.target.value })} className="col-span-3" placeholder="e.g. A-12" />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" onClick={handleGenerateTicket}>Generate Ticket</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* 🔐 SEARCH RESULTS DIALOG */}
      <Dialog open={isSearchOpen} onOpenChange={setIsSearchOpen}>
        <DialogContent className="sm:max-w-[500px] p-0 overflow-hidden bg-white border border-slate-200">
          <div className="p-6 border-b border-slate-100 bg-slate-50/50">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-800">Find Vehicle</h2>
            </div>
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-white border-slate-200"
              placeholder="Enter vehicle number..."
            />
          </div>

          {searchResult && (
            <div className="p-6 bg-white">
              <div className="flex items-center justify-between mb-6">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Status</span>
                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${searchResult.status === 'INSIDE' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${searchResult.status === 'INSIDE' ? 'bg-green-600' : 'bg-red-600'}`}></div>
                  {searchResult.status === 'INSIDE' ? 'PARKED' : 'EXITED'}
                </div>
              </div>

              <div className="mb-8">
                <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Vehicle Number</div>
                <div className="text-2xl font-black text-slate-900 font-mono tracking-tight">{searchResult.vehicle}</div>
                <div className="flex items-center gap-2 mt-2 text-xs font-semibold text-slate-600">
                  <Ticket className="w-3.5 h-3.5" />
                  {searchResult.type || 'UNKNOWN'}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-y-6 gap-x-4">
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Parking Zone</div>
                  <div className="text-sm font-bold text-slate-800">{searchResult.zone}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Slot Number</div>
                  <div className="text-sm font-bold text-slate-800">N/A</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Time In</div>
                  <div className="text-sm font-bold text-slate-800">{formatTime(searchResult.entryTime)}</div>
                  <div className="text-[10px] text-slate-400">{searchResult.entryTime ? new Date(searchResult.entryTime).toLocaleDateString() : ''}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">
                    {searchResult.status === 'INSIDE' ? 'Duration' : 'Time Out'}
                  </div>
                  <div className={`text-sm font-bold ${searchResult.status === 'INSIDE' ? 'text-amber-600' : 'text-slate-800'}`}>
                    {searchResult.status === 'INSIDE'
                      ? getDuration(searchResult.entryTime)
                      : formatTime(searchResult.exitTime)}
                  </div>
                  {searchResult.status === 'EXITED' && (
                    <div className="text-[10px] text-slate-400">
                      {searchResult.exitTime ? new Date(searchResult.exitTime).toLocaleDateString() : ''}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div >
  );
};