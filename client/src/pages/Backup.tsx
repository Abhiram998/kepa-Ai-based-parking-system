import { useEffect, useState } from "react";
import { useParking } from "@/lib/parking-context";
import { Link } from "wouter";
import { ArrowLeft, Database, RotateCcw, Loader2, Save, Download, Trash2, Calendar as CalendarIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiGet, apiPost, apiDelete } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";

/* ================= TYPES ================= */

type ServerSnapshot = {
  id: number;
  snapshot_time: string;
  records: number;
  data: any[];
};

type VehicleRecord = {
  plate: string;
  zone: string;
  timeIn: string;
  timeOut?: string | null;
  type?: 'heavy' | 'medium' | 'light';
};

/* ================= COMPONENT ================= */

export default function Backup() {
  const { refreshData, restoreData } = useParking();
  const { toast } = useToast();

  const [snapshots, setSnapshots] = useState<ServerSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);

  // Filter snapshots by selected date
  const filteredSnapshots = selectedDate
    ? snapshots.filter((snap) => {
      const snapDate = new Date(snap.snapshot_time);
      return (
        snapDate.getFullYear() === selectedDate.getFullYear() &&
        snapDate.getMonth() === selectedDate.getMonth() &&
        snapDate.getDate() === selectedDate.getDate()
      );
    })
    : snapshots;

  /* ================= FETCH SNAPSHOT LIST ================= */

  const loadSnapshots = async () => {
    setLoading(true);
    try {
      const data = await apiGet<ServerSnapshot[]>(`/api/snapshots?_t=${Date.now()}`);
      if (data && Array.isArray(data)) {
        setSnapshots(data);
      }
    } catch (err) {
      console.error("Backup Sync Error:", err);
      toast({
        variant: "destructive",
        title: "Sync Error",
        description: "Could not fetch snapshot history from server.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSnapshots();
  }, []);

  /* ================= QUICK RECOVERY ================= */

  const handleQuickRecovery = async () => {
    if (!confirm('Quick Recovery will fetch the latest system state from the server and restore live data. Continue?')) return;

    setIsProcessing(true);

    try {
      const today = new Date().toISOString().slice(0, 10);
      const rows = await apiGet<any[]>(`/api/reports?report_date=${today}`);

      if (!rows || !Array.isArray(rows)) {
        toast({
          variant: "destructive",
          title: "No Data",
          description: "No active vehicle records found on the server for today.",
        });
        return;
      }

      const records: VehicleRecord[] = rows
        .filter((r) => r.status === "INSIDE")
        .map((r) => ({
          plate: r.vehicle,
          zone: r.zone,
          timeIn: r.entryTime,
          timeOut: null,
          type: r.type.toLowerCase() as "light" | "medium" | "heavy",
        }));

      restoreData(records);

      toast({
        title: "Recovery Successful",
        description: `Restored ${records.length} vehicles to the dashboard.`,
      });
    } catch (e: any) {
      console.error('Quick Recovery Error:', e);
      toast({
        variant: "destructive",
        title: "Recovery Failed",
        description: e.message || "Failed to perform Quick Recovery.",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  /* ================= MANUAL SNAPSHOT ================= */

  const handleManualSnapshot = async () => {
    setIsProcessing(true);

    try {
      await apiPost("/api/snapshot", {});

      toast({
        title: "Snapshot Created",
        description: "Manual snapshot saved to server.",
      });

      await loadSnapshots();
    } catch (e: any) {
      console.error('Manual Snapshot Error:', e);
      toast({
        variant: "destructive",
        title: "Snapshot Failed",
        description: e.message || "Failed to create manual snapshot.",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  /* ================= DOWNLOAD SNAPSHOT ================= */

  const handleDownloadSnapshot = (snap: ServerSnapshot) => {
    const dataStr = JSON.stringify({
      meta: {
        app: "nilakkal-police-admin",
        version: 1,
        createdAt: snap.snapshot_time,
        recordCount: snap.records,
        snapshotId: snap.id
      },
      data: snap.data
    }, null, 2);

    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `snapshot-${snap.id}-${new Date(snap.snapshot_time).toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);

    toast({
      title: "Download Started",
      description: `Snapshot #${snap.id} downloaded successfully.`,
    });
  };

  /* ================= DELETE SNAPSHOT ================= */

  const handleDeleteSnapshot = async (snapshotId: number) => {
    if (!confirm(`Delete snapshot #${snapshotId}? This action cannot be undone.`)) {
      return;
    }

    try {
      await apiDelete(`/api/snapshots/${snapshotId}`);

      toast({
        title: "Snapshot Deleted",
        description: `Snapshot #${snapshotId} has been removed from the server.`,
      });

      await loadSnapshots();
    } catch (err: any) {
      console.error("Delete failed:", err);
      toast({
        variant: "destructive",
        title: "Delete Failed",
        description: err.message || "Could not delete snapshot.",
      });
    }
  };

  /* ================= ACTIVATE SNAPSHOT VIEW ================= */

  const activateSnapshotView = async (snapshotId: number) => {
    if (!confirm(`Restore snapshot #${snapshotId}? This will replace all current parking data with the snapshot state.`)) {
      return;
    }

    try {
      await apiPost(`/api/snapshot/activate/${snapshotId}`, {});

      toast({
        title: "Snapshot Restored",
        description: "System has been restored to the selected snapshot.",
      });

      await refreshData();
      await loadSnapshots();

    } catch (err: any) {
      console.error("Snapshot activation failed:", err);
      toast({
        variant: "destructive",
        title: "Restore Failed",
        description: err.message || "Could not activate snapshot view.",
      });
    }
  };

  /* ================= UI ================= */

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-6">
      <div className="max-w-6xl mx-auto space-y-6 animate-in fade-in duration-500">

        {/* HEADER */}
        <div className="flex items-center gap-4">
          <Link href="/admin">
            <Button variant="ghost" size="icon" className="hover:bg-white/50 dark:hover:bg-slate-800/50">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>

          <div className="flex-1">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-lg shadow-blue-500/20">
                <Database className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-900 to-slate-600 dark:from-white dark:to-slate-300 bg-clip-text text-transparent">
                  System Backup & Recovery
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  Manage server snapshots and restore system state
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ACTION CARDS */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Quick Recovery Card */}
          <div className="group relative overflow-hidden bg-gradient-to-br from-green-500 to-emerald-600 rounded-2xl p-6 shadow-xl shadow-green-500/20 hover:shadow-2xl hover:shadow-green-500/30 transition-all duration-300 cursor-pointer"
            onClick={handleQuickRecovery}>
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-500"></div>
            <div className="relative z-10">
              <div className="flex items-start justify-between mb-4">
                <div className="p-3 bg-white/20 backdrop-blur-sm rounded-xl">
                  <RotateCcw className={`w-6 h-6 text-white ${isProcessing ? 'animate-spin' : ''}`} />
                </div>
                {isProcessing && (
                  <span className="px-3 py-1 bg-white/20 backdrop-blur-sm rounded-full text-xs text-white font-medium">
                    Processing...
                  </span>
                )}
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Quick Recovery</h3>
              <p className="text-green-50 text-sm leading-relaxed">
                Fetch the latest system state from the server and restore all active vehicles to the dashboard instantly.
              </p>
              <div className="mt-4 flex items-center text-white/80 text-xs">
                <span className="flex items-center gap-1">
                  <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></div>
                  Live sync enabled
                </span>
              </div>
            </div>
          </div>

          {/* Manual Snapshot Card */}
          <div className="group relative overflow-hidden bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl p-6 shadow-xl shadow-blue-500/20 hover:shadow-2xl hover:shadow-blue-500/30 transition-all duration-300 cursor-pointer"
            onClick={handleManualSnapshot}>
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-500"></div>
            <div className="relative z-10">
              <div className="flex items-start justify-between mb-4">
                <div className="p-3 bg-white/20 backdrop-blur-sm rounded-xl">
                  <Save className="w-6 h-6 text-white" />
                </div>
                <span className="px-3 py-1 bg-white/20 backdrop-blur-sm rounded-full text-xs text-white font-medium">
                  {snapshots.length} saved
                </span>
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Create Snapshot</h3>
              <p className="text-blue-50 text-sm leading-relaxed">
                Manually capture the current system state and save it as a new snapshot on the server for future restoration.
              </p>
              <div className="mt-4 flex items-center text-white/80 text-xs">
                <span className="flex items-center gap-1">
                  <div className="w-1.5 h-1.5 bg-white rounded-full"></div>
                  Server-side storage
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* SNAPSHOTS PANEL */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 overflow-hidden">

          {/* Panel Header */}
          <div className="bg-gradient-to-r from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-900 border-b border-slate-200 dark:border-slate-700 px-6 py-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                  Snapshot History
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Loading snapshots from server...
                    </span>
                  ) : snapshots.length === 0 ? (
                    "No snapshots available"
                  ) : (
                    `${filteredSnapshots.length} of ${snapshots.length} snapshot(s) ${selectedDate ? 'on selected date' : 'available'}`
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {/* Date Filter */}
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className={`gap-2 ${selectedDate ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/20' : ''}`}
                    >
                      <CalendarIcon className="w-3.5 h-3.5" />
                      {selectedDate ? format(selectedDate, "MMM dd, yyyy") : "Filter by Date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="end">
                    <Calendar
                      mode="single"
                      selected={selectedDate}
                      onSelect={setSelectedDate}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>

                {/* Clear Filter */}
                {selectedDate && (
                  <Button
                    onClick={() => setSelectedDate(undefined)}
                    variant="ghost"
                    size="sm"
                    className="gap-1 text-slate-600 dark:text-slate-400"
                  >
                    <X className="w-3.5 h-3.5" />
                    Clear
                  </Button>
                )}

                {/* Refresh Button */}
                <Button
                  onClick={loadSnapshots}
                  variant="outline"
                  size="sm"
                  disabled={loading}
                  className="gap-2"
                >
                  <RotateCcw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
              </div>
            </div>
          </div>

          {/* Snapshots List */}
          <div className="p-6">
            <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
              {filteredSnapshots.length === 0 && !loading ? (
                <div className="text-center py-16 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                  <Database className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
                  <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">
                    {selectedDate ? 'No snapshots found for selected date' : 'No snapshots found'}
                  </p>
                  <p className="text-slate-400 dark:text-slate-500 text-xs mt-1">
                    {selectedDate ? 'Try selecting a different date' : 'Create your first snapshot to get started'}
                  </p>
                </div>
              ) : (
                filteredSnapshots.map((snap, index) => (
                  <div
                    key={snap.id}
                    className="group relative bg-gradient-to-br from-slate-50 to-white dark:from-slate-800 dark:to-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5 hover:shadow-lg hover:border-blue-300 dark:hover:border-blue-700 transition-all duration-300"
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    {/* Snapshot Badge */}
                    <div className="absolute top-3 right-3">
                      <span className="px-3 py-1 bg-gradient-to-r from-blue-500 to-indigo-500 text-white text-xs font-bold rounded-full shadow-lg">
                        #{snap.id}
                      </span>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex-1 space-y-2">
                        {/* Timestamp */}
                        <div className="flex items-center gap-2">
                          <div className="w-1.5 h-1.5 bg-green-500 rounded-full"></div>
                          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                            {new Date(snap.snapshot_time).toLocaleString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </span>
                        </div>

                        {/* Stats */}
                        <div className="flex items-center gap-4 text-xs">
                          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                            <Database className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                            <span className="font-bold text-blue-700 dark:text-blue-300">{snap.records}</span>
                            <span className="text-blue-600 dark:text-blue-400">vehicles</span>
                          </div>
                          <div className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
                            <div className="w-1 h-1 bg-slate-400 rounded-full"></div>
                            <span>Server snapshot</span>
                          </div>
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex items-center gap-2">
                        <Button
                          onClick={() => handleDownloadSnapshot(snap)}
                          variant="outline"
                          size="sm"
                          className="gap-2"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Download
                        </Button>

                        <Button
                          onClick={() => activateSnapshotView(snap.id)}
                          className="bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white shadow-lg shadow-blue-500/30 hover:shadow-xl hover:shadow-blue-500/40 transition-all duration-300"
                          size="sm"
                        >
                          <RotateCcw className="w-3.5 h-3.5 mr-2" />
                          Restore
                        </Button>

                        <Button
                          onClick={() => handleDeleteSnapshot(snap.id)}
                          variant="outline"
                          size="sm"
                          className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/10"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Footer Note */}
        <div className="flex items-center gap-2 px-4 py-3 bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30 rounded-xl">
          <div className="w-1.5 h-1.5 bg-blue-500 rounded-full"></div>
          <p className="text-xs text-blue-700 dark:text-blue-300">
            Snapshots are created automatically on every entry/exit and stored securely on the central server
          </p>
        </div>
      </div>
    </div>
  );
}
