import React, { useState, useRef } from "react";
import { Camera, Upload, X, Loader2, RefreshCcw, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiPost } from "@/lib/api";

interface ScanResult {
  plate: string;
  vehicle_type: string;
}

interface PlateScannerProps {
  onScanResult: (result: ScanResult) => void;
  className?: string;
}

export function PlateScanner({ onScanResult, className = "" }: PlateScannerProps) {
  const [image, setImage] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const startCamera = async () => {
    try {
      setIsCapturing(true);
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Camera error:", err);
      setError("Unable to access camera. Check permissions.");
      setIsCapturing(false);
    }
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    setIsCapturing(false);
  };

  const captureImage = () => {
    if (videoRef.current && canvasRef.current) {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(video, 0, 0);
        const dataUrl = canvas.toDataURL("image/jpeg");
        setImage(dataUrl);
        stopCamera();
        processImage(dataUrl);
      }
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        setImage(dataUrl);
        processImage(dataUrl);
      };
      reader.readAsDataURL(file);
    }
  };

  const processImage = async (dataUrl: string) => {
    setLoading(true);
    setError(null);
    try {
      // Updated Endpoint to call vehicle details instead of just plate
      const res = await apiPost<ScanResult>("/api/extract-vehicle-details", {
        image: dataUrl,
      });
      
      const plate = res.plate.trim();
      const vtype = res.vehicle_type;

      if (plate === "No license plate detected" || !plate) {
        setError("AI could not detect a license plate. However, we've suggested the vehicle type.");
        // We still pass the type if available
        onScanResult({ plate: "", vehicle_type: vtype === "Unknown" ? "light" : vtype.toLowerCase() });
      } else {
        const cleanedPlate = plate.replace(/[^a-zA-Z0-9-]/g, "").toUpperCase();
        onScanResult({ plate: cleanedPlate, vehicle_type: vtype.toLowerCase() });
      }
    } catch (err: any) {
      setError(err?.message || "Failed to analyze image");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setImage(null);
    setError(null);
    stopCamera();
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {!image && !isCapturing ? (
        <div className="flex gap-4">
          <Button
            variant="outline"
            type="button"
            className="flex-1 py-10 flex-col gap-2 rounded-xl border-dashed bg-slate-50/50 hover:bg-slate-100 hover:border-slate-300 transition-all"
            onClick={startCamera}
          >
            <Camera className="w-6 h-6 text-slate-500" />
            <div className="text-center">
              <span className="text-xs font-semibold text-slate-600 block">AI Scan (Camera)</span>
              <span className="text-[10px] text-slate-400">Auto-detect Type & Plate</span>
            </div>
          </Button>
          <Button
            variant="outline"
            type="button"
            className="flex-1 py-10 flex-col gap-2 rounded-xl border-dashed bg-slate-50/50 hover:bg-slate-100 hover:border-slate-300 transition-all"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="w-6 h-6 text-slate-500" />
            <div className="text-center">
              <span className="text-xs font-semibold text-slate-600 block">Upload Photo</span>
              <span className="text-[10px] text-slate-400">Analyze Image</span>
            </div>
          </Button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept="image/*"
            className="hidden"
          />
        </div>
      ) : isCapturing ? (
        <div className="relative rounded-xl overflow-hidden bg-slate-900 aspect-video ring-2 ring-blue-500 shadow-xl">
          <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
          <div className="absolute inset-0 flex items-end justify-center pb-6 gap-6 bg-gradient-to-t from-black/40 to-transparent">
            <Button
              size="icon"
              type="button"
              className="w-14 h-14 rounded-full border-4 border-white bg-slate-900 hover:scale-105 active:scale-95 transition-transform shadow-2xl"
              onClick={captureImage}
            >
              <div className="w-4 h-4 rounded-sm bg-white" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              type="button"
              className="rounded-full w-10 h-10 bg-white/10 backdrop-blur border-white/20 text-white hover:bg-white/20"
              onClick={stopCamera}
            >
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="relative rounded-xl overflow-hidden bg-slate-100 aspect-video group ring-1 ring-slate-200 shadow-inner">
          <img src={image || undefined} className="w-full h-full object-contain" alt="Captured" />
          
          {loading && (
            <div className="absolute inset-0 bg-white/70 backdrop-blur-sm flex flex-col items-center justify-center gap-2">
              <Loader2 className="w-7 h-7 animate-spin text-blue-600" />
              <div className="text-center">
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-800 animate-pulse">Scanning Vehicle</p>
                <p className="text-[9px] text-slate-500 font-medium">Detecting Plate & Category...</p>
              </div>
            </div>
          )}

          {!loading && (
            <div className="absolute top-3 right-3 flex gap-2">
              <Button
                variant="outline"
                size="icon"
                type="button"
                className="w-8 h-8 rounded-full bg-white/90 backdrop-blur shadow-sm hover:scale-105 transition-transform"
                onClick={reset}
              >
                <RefreshCcw className="w-4 h-4 text-slate-600" />
              </Button>
            </div>
          )}
        </div>
      )}

      {error && !isCapturing && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 text-amber-800 text-xs font-medium border border-amber-100 animate-in fade-in slide-in-from-top-1">
          <AlertCircle className="w-5 h-5 shrink-0 text-amber-500" />
          <div className="flex-1">
            <p className="font-bold mb-0.5">Note</p>
            <p className="opacity-80">{error}</p>
          </div>
          <Button 
            variant="ghost" 
            size="icon" 
            type="button"
            className="w-6 h-6 hover:bg-amber-100/50 text-amber-700" 
            onClick={reset}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
