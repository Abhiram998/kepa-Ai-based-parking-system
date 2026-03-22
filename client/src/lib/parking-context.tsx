import { apiGet, apiPost, apiPut, apiDelete } from "./api";
import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { saveLatestSnapshot, VehicleRecord } from '@/utils/persistence';

export type VehicleType = 'heavy' | 'medium' | 'light';

export type Vehicle = {
  number: string;
  entryTime: Date;
  zoneId: string;
  ticketId: string;
  type: VehicleType;
  slot?: string;
};

export type ParkingZone = {
  id: string;
  name: string;
  capacity: number;
  occupied: number;
  vehicles: Vehicle[];
  limits: {
    heavy: number;
    medium: number;
    light: number;
  };
  stats: {
    heavy: number;
    medium: number;
    light: number;
  };
};

type ParkingContextType = {
  zones: ParkingZone[];
  refreshData: () => Promise<void>;

  enterVehicle: (
    vehicleNumber: string,
    type?: VehicleType,
    zoneId?: string,
    slot?: string
  ) => Promise<{ success: boolean; ticket?: any; message?: string }>;

  totalCapacity: number;
  totalOccupied: number;

  isAdmin: boolean;
  adminUser: {
    id: number;
    name: string;
    policeId: string;
    email: string;
    role: string;
  } | null;

  loginAdmin: (email: string, password: string) => Promise<boolean>;
  logoutAdmin: () => void;

  addZone: (
    zone: Omit<ParkingZone, "id" | "occupied" | "vehicles" | "stats">
  ) => Promise<void>;

  updateZone: (
    id: string,
    data: {
      name: string;
      limits: {
        heavy: number;
        medium: number;
        light: number;
      };
    }
  ) => Promise<void>;

  deleteZone: (id: string) => Promise<void>;
  restoreData: (records: any[]) => void;
};


const ParkingContext = createContext<ParkingContextType | undefined>(undefined);

// Hardcoded zones removed. Application now fully dynamic.
// const ZONES_COUNT = 20;
// const ZONE_CAPACITY = 50;
// const INITIAL_ZONES = ...

export function ParkingProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  
  // Use React Query for the primary zones data
  const { data: zonesData, refetch: refetchZones } = useQuery<ParkingZone[]>({
    queryKey: ["/api/zones"],
    queryFn: () => apiGet<ParkingZone[]>("/api/zones"),
    refetchInterval: 10000, 
  });

  const refreshData = async () => {
    await refetchZones();
  };

  const zones = zonesData || [];
  const zonesRef = useRef(zones);

  useEffect(() => {
    zonesRef.current = zones;
  }, [zones]);

  const [isAdmin, setIsAdmin] = useState(false);
  const [adminUser, setAdminUser] = useState<{
    id: number;
    name: string;
    policeId: string;
    email: string;
    role: string;
  } | null>(null);


  // Persistence logic
  useEffect(() => {
    const interval = setInterval(() => {
      const payload = makeSnapshotFromState(zonesRef.current);
      saveLatestSnapshot(payload).catch(e => console.error("Auto-save failed", e));
    }, 3 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const makeSnapshotFromState = (currentZones: ParkingZone[]) => {
    const records: VehicleRecord[] = currentZones.flatMap(z =>
      z.vehicles.map(v => ({
        plate: v.number,
        zone: z.name,
        timeIn: v.entryTime.toISOString(),
        timeOut: null,
        type: v.type
      }))
    );
    return {
      meta: { app: "nilakkal-police", version: 1, createdAt: new Date().toISOString(), recordCount: records.length },
      data: records
    };
  };

  type AdminLoginResponse = {
    success: boolean;
    user: {
      id: number;
      name: string;
      policeId: string;
      email: string;
      role: string;
    };
  };

  const loginAdmin = async (
    email: string,
    password: string
  ): Promise<boolean> => {
    try {
      const res = await apiPost<AdminLoginResponse>("/api/admin/login", {
        email,
        password,
      });

      if (!res.success) return false;

      setAdminUser(res.user);
      setIsAdmin(true);
      return true;
    } catch (err) {
      console.error("❌ Admin login failed", err);
      return false;
    }
  };




  const logoutAdmin = () => {
    setIsAdmin(false);
    setAdminUser(null);
  };


  // --- RECTIFIED ADMIN ACTIONS WITH API SYNC ---

  const addZone = async (zoneData: Omit<ParkingZone, 'id' | 'occupied' | 'vehicles' | 'stats'>) => {
    try {
      await apiPost("/api/zones", zoneData);
      queryClient.invalidateQueries({ queryKey: ["/api/zones"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard-summary"] });
      console.log("✅ New parking terminal registered on server");
    } catch (err) {
      console.error("❌ Failed to add zone", err);
      throw err;
    }
  };

  const updateZone = async (
    id: string,
    data: {
      name: string;
      limits: {
        heavy: number;
        medium: number;
        light: number;
      };
    }
  ) => {
    try {
      await apiPut(`/api/zones/${id}`, {
        name: data.name,
        limits: data.limits
      });
      queryClient.invalidateQueries({ queryKey: ["/api/zones"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard-summary"] });
    } catch (err) {
      console.error("❌ Failed to update zone", err);
      throw err;
    }
  };

  const deleteZone = async (id: string) => {
    try {
      await apiDelete(`/api/zones/${id}`);
      queryClient.invalidateQueries({ queryKey: ["/api/zones"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard-summary"] });
    } catch (err) {
      console.error("❌ Failed to delete zone", err);
      throw err;
    }
  };


  // --- END OF RECTIFIED ACTIONS ---

  const enterVehicle = async (vehicleNumber: string, type: VehicleType = "light", zoneId?: string, slot?: string) => {
    try {
      const res = await apiPost<{ success: boolean; ticket?: string; zone?: string; message?: string }>("/api/enter", {
        vehicle: vehicleNumber,
        type,
        zone: zoneId,
        slot,
      });

      if (!res.success) return { success: false, message: res.message || "Entry failed" };

      queryClient.invalidateQueries({ queryKey: ["/api/zones"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard-summary"] });
      
      return {
        success: true,
        ticket: {
          vehicleNumber,
          ticketId: res.ticket || "",
          zoneName: res.zone || "Assigned", 
          time: new Date().toLocaleTimeString(),
          type,
          slot,
        },
      };
    } catch (err: any) {
      console.error("❌ ENTER VEHICLE FAILED", err);
      return { success: false, message: err.message };
    }
  };

  const totalCapacity = zones.reduce((acc, z) => acc + z.capacity, 0);
  const totalOccupied = zones.reduce((acc, z) => acc + z.occupied, 0);

  const restoreData = (records: any[]) => {
    if (!records || records.length === 0) {
      refreshData();
      return;
    }
    // ... rest of the legacy client-side restore logic could be here if needed
    // But we are moving towards server-side snapshots.
  };

  return (
    <ParkingContext.Provider value={{
      zones,
      refreshData,
      enterVehicle,
      totalCapacity,
      totalOccupied,
      isAdmin,
      adminUser,        // ✅ now available everywhere
      loginAdmin,
      logoutAdmin,
      addZone,
      updateZone,
      deleteZone,
      restoreData
    }}>
      {children}
    </ParkingContext.Provider>
  );
}

export function useParking() {
  const context = useContext(ParkingContext);
  if (!context) throw new Error("useParking must be used within ParkingProvider");
  return context;
}