"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Camera, MapPin, Loader2, ArrowLeft, Upload, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function AddExpensePage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const gpsWatchId = useRef<number | null>(null);
  const bestGps = useRef<{lat: number; lng: number; acc: number} | null>(null);
  
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<string>("Fuel");
  const [note, setNote] = useState("");
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  
  const [gpsStatus, setGpsStatus] = useState<"idle" | "warming" | "ready" | "error">("idle");
  const [location, setLocation] = useState<{lat: number; lng: number; acc: number} | null>(null);
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [showPermissionDialog, setShowPermissionDialog] = useState(false);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (gpsWatchId.current !== null) {
        navigator.geolocation.clearWatch(gpsWatchId.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Start GPS — must be called from a user gesture (tap) to trigger the browser permission prompt
  const startGps = async () => {
    if (!navigator.geolocation) {
      setGpsStatus("error");
      setError("Geolocation is not supported by your browser.");
      return;
    }

    // Pre-check: if permission is already blocked at OS/browser level, no prompt will appear.
    // Detect this and show step-by-step instructions instead of silently failing.
    if (navigator.permissions) {
      try {
        const result = await navigator.permissions.query({ name: "geolocation" });
        if (result.state === "denied") {
          setGpsStatus("error");
          setShowPermissionDialog(true);
          return;
        }
      } catch {
        // Permissions API unsupported — fall through and let watchPosition handle it
      }
    }

    // Clear any previous watch
    if (gpsWatchId.current !== null) {
      navigator.geolocation.clearWatch(gpsWatchId.current);
    }

    setGpsStatus("warming");
    setError("");

    gpsWatchId.current = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        if (!bestGps.current || accuracy < bestGps.current.acc) {
          bestGps.current = { lat: latitude, lng: longitude, acc: accuracy };
          setLocation(bestGps.current);
        }
        setGpsStatus("ready");
      },
      (geoError) => {
        setGpsStatus("error");
        if (geoError.code === geoError.PERMISSION_DENIED) {
          // Permission denied during prompt or pre-blocked — show instructions dialog
          setShowPermissionDialog(true);
        } else if (geoError.code === geoError.TIMEOUT) {
          setError("GPS request timed out. Please ensure you have a clear view of the sky and try again.");
        } else {
          setError(`Unable to fetch location (${geoError.message}). Make sure GPS is turned on.`);
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  const startCamera = async () => {
    try {
      setIsCameraOpen(true);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" }
      });
      streamRef.current = stream;
      if (videoRef.current && videoRef.current.srcObject !== stream) {
        videoRef.current.srcObject = stream;
      }
      setError("");
    } catch (err) {
      console.error("Camera access denied or device not found:", err);
      setIsCameraOpen(false);
      // Fallback to normal file input if permission denied or no camera device
      fileInputRef.current?.click();
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsCameraOpen(false);
  };

  const takePhoto = () => {
    if (videoRef.current) {
      const canvas = document.createElement("canvas");
      canvas.width = videoRef.current.videoWidth || 800;
      canvas.height = videoRef.current.videoHeight || 800;
      const ctx = canvas.getContext("2d");
      ctx?.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      
      const dataUrl = canvas.toDataURL("image/jpeg", 0.6); // Compress
      setPhotoBase64(dataUrl);
      stopCamera();
    }
  };

  const handleCapturePhoto = () => {
    startCamera();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Read and compress image
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        // Create canvas for compression
        const canvas = document.createElement("canvas");
        const MAX_WIDTH = 800; // Mobile optimal
        const MAX_HEIGHT = 800;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx?.drawImage(img, 0, 0, width, height);

        // Export to highly compressed JPEG base64
        const dataUrl = canvas.toDataURL("image/jpeg", 0.6);
        setPhotoBase64(dataUrl);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const captureLocationAndSubmit = async () => {
    if (!amount || parseFloat(amount) <= 0) return setError("Please enter a valid amount");
    if (!photoBase64) return setError("A photo of the receipt/bill is required");
    
    if (!bestGps.current) {
      return setError("GPS location not available yet. Please wait a moment and try again.");
    }

    setError("");
    setIsSubmitting(true);

    const { lat, lng, acc } = bestGps.current;

    try {
      const res = await fetch("/api/driver/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: parseFloat(amount),
          category,
          note,
          photoBase64,
          latitude: lat,
          longitude: lng,
          accuracy: acc
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to submit expense");
      }

      // Success!
      router.push("/driver/dashboard");
      router.refresh();

    } catch (err: any) {
      setError(err.message);
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Location Permission Blocked Dialog */}
      {showPermissionDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-sm shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-rose-500/20 flex items-center justify-center shrink-0">
                <MapPin className="w-5 h-5 text-rose-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">Location Blocked</h2>
                <p className="text-xs text-slate-400">This site was previously denied</p>
              </div>
            </div>
            <p className="text-slate-300 text-sm leading-relaxed">
              Chrome has blocked this site from accessing location. To fix it:
            </p>
            <ol className="space-y-3 text-sm text-slate-300">
              <li className="flex gap-2">
                <span className="text-indigo-400 font-bold shrink-0">1.</span>
                <span>In Chrome, tap the <span className="text-white font-semibold">⋮ menu → Settings → Site Settings → Location</span></span>
              </li>
              <li className="flex gap-2">
                <span className="text-indigo-400 font-bold shrink-0">2.</span>
                <span>Scroll down to the <span className="text-rose-400 font-semibold">Blocked</span> list and tap this site&apos;s address.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-indigo-400 font-bold shrink-0">3.</span>
                <span>Tap <span className="text-white font-semibold">Location</span> and change it to <span className="text-emerald-400 font-semibold">Allow</span> or <span className="text-sky-400 font-semibold">Ask</span>.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-indigo-400 font-bold shrink-0">4.</span>
                <span>Return here and tap <span className="text-white font-semibold">Try Again</span>.</span>
              </li>
            </ol>
            <div className="bg-slate-800/60 rounded-lg p-3 text-xs text-slate-400 leading-relaxed">
              💡 <span className="text-slate-300 font-medium">Shortcut:</span> Tap the <span className="text-white">🔒 lock icon</span> in the address bar → <span className="text-white">Site settings</span> → Location → Allow
            </div>
            <div className="flex gap-3 pt-1">
              <Button
                variant="outline"
                className="flex-1 border-slate-600 text-slate-300 bg-transparent"
                onClick={() => setShowPermissionDialog(false)}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white"
                onClick={() => {
                  setShowPermissionDialog(false);
                  setGpsStatus("idle");
                  setTimeout(() => startGps(), 300);
                }}
              >
                Try Again
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Link href="/driver/dashboard" className="p-2 -ml-2 rounded-full hover:bg-slate-800 text-slate-400">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl font-bold text-white tracking-tight">Add Expense</h1>
      </div>

      <div className="space-y-6">
        {/* Photo Capture Section */}
        <div 
          className={`relative overflow-hidden w-full h-64 sm:h-72 rounded-2xl border-2 border-dashed flex flex-col items-center justify-center transition-all ${
            photoBase64 ? "border-emerald-500/50 bg-slate-900" : isCameraOpen ? "border-slate-800 bg-black" : "border-slate-700 bg-slate-900/50 hover:bg-slate-800 cursor-pointer"
          }`}
          onClick={() => !photoBase64 && !isCameraOpen && handleCapturePhoto()}
        >
          {isCameraOpen ? (
            <div className="absolute inset-0 w-full h-full bg-black z-10 flex flex-col items-center justify-center">
              <video 
                ref={(el) => {
                  videoRef.current = el;
                  if (el && streamRef.current && el.srcObject !== streamRef.current) {
                    el.srcObject = streamRef.current;
                  }
                }} 
                className="w-full h-full object-cover" 
                autoPlay 
                playsInline 
                muted
              />
              <div className="absolute bottom-4 left-0 w-full flex justify-center gap-4 px-4 z-20">
                <Button 
                  variant="outline" 
                  onClick={(e) => { e.stopPropagation(); stopCamera(); }} 
                  className="bg-slate-900/80 border-slate-700 text-white backdrop-blur-sm"
                >
                  Cancel
                </Button>
                <Button 
                  onClick={(e) => { e.stopPropagation(); takePhoto(); }} 
                  className="bg-indigo-600 hover:bg-indigo-700 text-white flex-1 max-w-xs shadow-lg"
                >
                  <Camera className="w-5 h-5 mr-2" /> Snap Photo
                </Button>
              </div>
            </div>
          ) : photoBase64 ? (
            <div className="w-full h-full cursor-pointer group" onClick={handleCapturePhoto}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photoBase64} alt="Receipt" className="absolute inset-0 w-full h-full object-cover opacity-60 group-hover:opacity-40 transition-opacity" />
              <div className="relative z-10 flex flex-col items-center justify-center p-4 bg-slate-950/60 rounded-xl h-full w-full">
                <CheckCircle2 className="w-10 h-10 text-emerald-400 mb-2 shadow-sm shadow-black/50 rounded-full bg-black/50" />
                <span className="text-sm font-bold text-emerald-100 drop-shadow-md">Photo Secured</span>
                <span className="text-xs font-semibold text-slate-300 mt-2 bg-slate-900/80 px-3 py-1 rounded-full">Tap to retake</span>
              </div>
            </div>
          ) : (
            <>
              <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center mb-4 border border-slate-700 shadow-xl shadow-black/20 group-hover:bg-slate-700 transition-colors">
                <Camera className="w-8 h-8 text-indigo-400" />
              </div>
              <p className="font-semibold text-slate-200">Take Photo of Bill</p>
              <p className="text-xs text-slate-500 mt-1">Required</p>
            </>
          )}
        </div>
        <input 
          type="file" 
          accept="image/*" 
          capture="environment" // Forces back camera on mobile
          ref={fileInputRef} 
          onChange={handleFileChange} 
          className="hidden" 
        />

        {error && (
          <div className="bg-rose-500/10 border border-rose-500/50 text-rose-500 text-sm rounded-lg p-3">
            {error}
          </div>
        )}

        <div className="space-y-4 bg-slate-900 p-5 rounded-2xl border border-slate-800">
          <div className="space-y-2">
            <Label className="text-slate-300">Amount (₹)</Label>
            <Input 
              type="number" 
              placeholder="0.00" 
              step="0.01"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              className="h-14 text-2xl font-bold bg-slate-950 border-slate-700 text-amber-400 placeholder:text-slate-600"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-slate-300">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="h-14 bg-slate-950 border-slate-700 text-slate-200 text-lg">
                <SelectValue placeholder="Select Category" />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-700 text-white">
                <SelectItem value="Fuel" className="py-3 text-base">⛽ Fuel</SelectItem>
                <SelectItem value="Toll" className="py-3 text-base">🛣️ Toll</SelectItem>
                <SelectItem value="Food" className="py-3 text-base">🍔 Food</SelectItem>
                <SelectItem value="Other" className="py-3 text-base">📦 Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-slate-300">Note (Optional)</Label>
            <Input 
              placeholder="e.g. Highway 401 run" 
              value={note}
              onChange={e => setNote(e.target.value)}
              className="h-12 bg-slate-950 border-slate-700 text-slate-200 placeholder:text-slate-600"
            />
          </div>
        </div>

        <div 
          className={`bg-slate-900/50 border rounded-xl p-4 flex items-start gap-3 transition-colors ${
            gpsStatus === "idle" || gpsStatus === "error" ? "border-amber-500/50 cursor-pointer hover:bg-slate-800/50" : "border-slate-800"
          }`}
          onClick={() => (gpsStatus === "idle" || gpsStatus === "error") && startGps()}
        >
          <MapPin className={`w-5 h-5 shrink-0 mt-0.5 ${
            gpsStatus === "ready" ? (location && location.acc > 100 ? "text-amber-400" : "text-emerald-400") 
            : gpsStatus === "error" ? "text-rose-400" 
            : gpsStatus === "warming" ? "text-amber-400 animate-pulse" 
            : "text-slate-400"
          }`} />
          <div className="text-xs leading-relaxed space-y-1">
            {gpsStatus === "idle" ? (
              <span className="text-sky-400 font-medium">
                📍 Tap here to enable location tracking
              </span>
            ) : gpsStatus === "ready" && location ? (
              <>
                <span className={`font-medium ${location.acc <= 100 ? "text-emerald-400" : "text-amber-400"}`}>
                  📍 GPS locked — accuracy: ~{Math.round(location.acc)}m
                </span>
                {location.acc > 100 && (
                  <p className="text-amber-300/80 mt-1">
                    ⚠️ Accuracy is low. Try stepping outside or away from buildings for a better GPS signal.
                  </p>
                )}
              </>
            ) : gpsStatus === "error" ? (
              <span className="text-rose-400 font-medium">
                ❌ Location blocked — tap here for help enabling it
              </span>
            ) : (
              <span className="text-amber-400 font-medium">
                🛰️ Acquiring GPS signal...
              </span>
            )}
          </div>
        </div>

        <Button 
          onClick={() => {
            if (gpsStatus === "idle" || gpsStatus === "error") {
              startGps();
              return;
            }
            captureLocationAndSubmit();
          }}
          disabled={isSubmitting || gpsStatus === "warming"}
          className="w-full h-16 text-lg font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xl shadow-indigo-900/20 rounded-xl"
        >
          {isSubmitting ? (
             <><Loader2 className="mr-2 h-6 w-6 animate-spin" /> Submitting...</>
          ) : gpsStatus === "idle" || gpsStatus === "error" ? (
            <><MapPin className="mr-2 h-6 w-6" /> Enable Location & Submit</>
          ) : (
            <><Upload className="mr-2 h-6 w-6" /> Submit Expense</>
          )}
        </Button>
      </div>
    </div>
  );
}
