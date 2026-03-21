import { apiGet, apiPost, apiPut, apiDelete } from "./api";
import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
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
  const [zones, setZones] = useState<ParkingZone[]>([]);
  const zonesRef = useRef(zones);

  useEffect(() => {
    zonesRef.current = zones;
  }, [zones]);

  const refreshData = async () => {
    try {
      const data = await apiGet<ParkingZone[]>("/api/zones");
      const normalized = data.map(z => ({
        ...z,
        vehicles: [],
        stats: z.stats || { heavy: 0, medium: 0, light: 0 }
      }));
      setZones(normalized);
    } catch (err) {
      console.error("❌ Failed to load zones from backend", err);
    }
  };

  useEffect(() => {
    refreshData();
  }, []);

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
      // 1. Sync with backend
      await apiPost("/api/zones", zoneData);
      // 2. Refresh state from source of truth
      await refreshData();
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
      await refreshData();
    } catch (err) {
      console.error("❌ Failed to update zone", err);
      throw err;
    }
  };


  const deleteZone = async (id: string) => {
    try {
      await apiDelete(`/api/zones/${id}`);   // ✅ DELETE
      await refreshData();
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

      await refreshData();
      return {
        success: true,
        ticket: {
          vehicleNumber,
          ticketId: res.ticket || "",
          zoneName: res.zone || "Assigned", // ✅ Included zone name from backend
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
    // If records are empty or we are in Server-Side Restore mode, 
    // we should just fetch the latest state from the backend.
    if (!records || records.length === 0) {
      refreshData();
      return;
    }

    // CLIENT-SIDE RESTORE / OFFLINE MODE (Legacy Fallback)
    // Use current zones state as the base, do NOT invent new zones.
    const newZones: ParkingZone[] = zones.map(z => ({
      ...z,
      occupied: 0,
      vehicles: [],
      stats: { heavy: 0, medium: 0, light: 0 }
    }));

    records.forEach(rec => {
      // Find the matching zone by ID or Name from the existing dynamic zones
      let zone = newZones.find(z => z.name === rec.zone || z.id === rec.zone);

      // If zone doesn't exist in the new dynamic system, SKIPPING instead of forcing to Zone 1 
      // (Safety choice to avoid overflow). Or we could fallback to the first active zone.
      if (!zone) {
        if (newZones.length > 0) zone = newZones[0];
        else return; // No zones at all? nothing to restore to.
      }

      // Safe access: ensure zone is defined before proceeding
      if (!zone) return;

      const vehicleType: VehicleType = ['heavy', 'medium', 'light'].includes(rec.type) ? rec.type : 'light';

      // Only add if there is capacity
      if (zone.occupied < zone.capacity) {
        zone.vehicles.push({
          number: rec.plate,
          entryTime: new Date(rec.timeIn),
          zoneId: zone.id,
          ticketId: `RES-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          type: vehicleType
        });
        zone.occupied++;
        zone.stats[vehicleType]++;
      }
    });

    setZones(newZones);
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