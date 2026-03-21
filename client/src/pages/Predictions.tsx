import { ArrowLeft, TrendingUp, Calendar, Info } from "lucide-react";
import { Link } from "wouter";
import { useEffect, useState, useMemo } from "react";
import { apiGet } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  AreaChart,
  Area,
} from "recharts";

/* =========================
   TYPES
========================= */

type PastDay = {
  day: string;
  occupancy: number;
};

type ZonePrediction = {
  zone: string;
  probability: number;
};

type HourlyData = {
  time: string;
  probability: number;
};

/* =========================
   COMPONENT
========================= */

export default function Predictions() {
  const [weeklyData, setWeeklyData] = useState<PastDay[]>([]);
  const [tomorrowProbability, setTomorrowProbability] = useState<number>(0);
  const [zonePredictions, setZonePredictions] = useState<ZonePrediction[]>([]);
  const [loading, setLoading] = useState(true);
  const [hourlyData, setHourlyData] = useState<HourlyData[]>([]);

  /* =========================
     FETCH DATA
  ========================= */

  useEffect(() => {
    apiGet<any>("/api/predictions")
      .then((data) => {
        setWeeklyData(data.past7Days || []);
        setTomorrowProbability(data.tomorrow?.probability || 0);
        setZonePredictions(data.zones || []);
        setHourlyData(data.hourly || []);
      })
      .catch((err) => {
        console.error("Prediction fetch error:", err);
      })
      .finally(() => setLoading(false));
  }, []);

  /* =========================
     COMPUTED METRICS
  ========================= */

  const sortedZones = useMemo(() => {
    return [...zonePredictions].sort(
      (a, b) => parseInt(a.zone.replace("Z", "")) - parseInt(b.zone.replace("Z", ""))
    );
  }, [zonePredictions]);

  // Gradient helpers for card - BLUE THEME
  const getGradient = (prob: number) => {
    if (prob > 75) return "from-red-600 to-rose-600";
    if (prob > 40) return "from-amber-500 to-orange-500";
    return "from-blue-600 to-indigo-600"; // Changed to Blue
  };

  const statusText = useMemo(() => {
    if (tomorrowProbability > 75) return "High Congestion Expected";
    if (tomorrowProbability > 40) return "Moderate Traffic Expected";
    return "Low Congestion Expected";
  }, [tomorrowProbability]);

  /* =========================
     UI
  ========================= */
  if (loading) {
    return (
      <div className="h-[60vh] flex flex-col items-center justify-center text-muted-foreground gap-2">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        <p>Loading forecast...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500 p-1 pb-10">
      {/* HEADER */}
      <div className="flex items-center gap-4 mb-2">
        <Link href="/">
          <Button variant="ghost" size="icon" className="hover:bg-slate-100">
            <ArrowLeft className="w-5 h-5 text-slate-700" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Forecast & Analytics
          </h1>
          <p className="text-slate-500 text-sm">
            Smart parking predictions for pilgrims
          </p>
        </div>
      </div>

      {/* 1. TOMORROW CARD (Hero - Original Layout Style) */}
      <Card className={`border-none shadow-lg text-white bg-gradient-to-br ${getGradient(tomorrowProbability)} overflow-hidden relative`}>
        <div className="absolute right-0 top-0 h-full w-1/2 bg-white/5 skew-x-12 transform origin-bottom-right" />
        <CardContent className="pt-8 pb-8 relative z-10">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
            <div>
              <div className="flex items-center gap-2 text-white/90 mb-2">
                <Calendar className="w-4 h-4" />
                <span className="text-sm font-bold uppercase tracking-wider">Tomorrow's Outlook</span>
              </div>

              <div className="flex items-baseline gap-2">
                <h2 className="text-5xl font-extrabold tracking-tight">
                  {tomorrowProbability}%
                </h2>
                <span className="text-xl font-medium text-white/80">Probability</span>
              </div>

              <p className="text-white/90 font-medium mt-1 text-lg flex items-center gap-2">
                {statusText}
              </p>
            </div>

            <div className="h-16 w-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center border border-white/30 shadow-inner">
              <TrendingUp className="w-8 h-8 text-white" />
            </div>
          </div>

          {/* Decorative Chart Area (Restored & Improved) */}
          <div className="h-[100px] mt-6 -mx-6 -mb-8">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={hourlyData}>
                <defs>
                  <linearGradient id="heroChartFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ffffff" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="probability"
                  stroke="#ffffff"
                  strokeWidth={2}
                  fill="url(#heroChartFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* 2. PAST 7 DAYS (Original Layout Position) */}
      <Card className="shadow-sm border-slate-200">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg text-slate-800">Past 7 Days Trend</CardTitle>
              <CardDescription>Historical occupancy analysis</CardDescription>
            </div>
            <Info className="w-4 h-4 text-slate-400" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[220px] w-full mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyData} barSize={32}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis
                  dataKey="day"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#64748b', fontSize: 12, fontWeight: 500 }}
                  dy={10}
                />
                <YAxis hide />
                <Tooltip
                  cursor={{ fill: '#f8fafc' }}
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                />
                <Bar
                  dataKey="occupancy"
                  fill="#334155"
                  radius={[6, 6, 0, 0]}
                  activeBar={{ fill: '#0f172a' }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* 3. ZONE WISE PREDICTIONS (Original Layout Grid) */}
      <div>
        <h3 className="font-bold text-slate-800 mb-4 ml-1 flex items-center gap-2">
          Zone Analysis <span className="text-slate-400 text-sm font-normal">(Tomorrow)</span>
        </h3>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {sortedZones.map((zone) => {
            // Calculate local status for color - BLUE THEME
            let colorClass = "bg-blue-500"; // Changed to Blue
            let bgClass = "bg-blue-50 text-blue-700 border-blue-100"; // Changed to Blue

            if (zone.probability > 75) { colorClass = "bg-red-500"; bgClass = "bg-red-50 text-red-700 border-red-100"; }
            else if (zone.probability > 40) { colorClass = "bg-amber-500"; bgClass = "bg-amber-50 text-amber-700 border-amber-100"; }

            return (
              <Card key={zone.zone} className={`border shadow-sm hover:shadow-md transition-all ${bgClass}`}>
                <CardContent className="p-4">
                  <div className="flex justify-between items-start mb-3">
                    <span className="font-bold text-lg tracking-tight">{zone.zone}</span>
                    <span className={`text-xs font-bold px-2 py-1 rounded-full bg-white/60 backdrop-blur-sm`}>
                      {zone.probability}%
                    </span>
                  </div>

                  <Progress
                    value={zone.probability}
                    className="h-2 bg-white/50"
                    indicatorClassName={colorClass}
                  />
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

    </div>
  );
}
