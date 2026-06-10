"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ShieldCheck, Loader2, AlertCircle, Camera } from "lucide-react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";

interface Props {
  open: boolean;
  onClose: () => void;
  onVerified: () => void;
}

type Step = "intro" | "scanning" | "success" | "error";

const HOLD_SECONDS = 3; // seconds face must stay in frame
const DETECT_INTERVAL = 200; // ms between detections

function getFaceGuidance(
  face: { boundingBox: DOMRectReadOnly },
  vw: number,
  vh: number
): string | null {
  const b = face.boundingBox;
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const ratio = b.width / vw;

  if (ratio < 0.2)  return "Move closer";
  if (ratio > 0.7)  return "Move back";
  if (cx / vw < 0.28) return "Move right";
  if (cx / vw > 0.72) return "Move left";
  if (cy / vh < 0.22) return "Move down";
  if (cy / vh > 0.78) return "Move up";
  return null;
}

export function LivenessCheckSheet({ open, onClose, onVerified }: Props) {
  const [step, setStep]       = useState<Step>("intro");
  const [message, setMessage] = useState("Position your face in the circle");
  const [progress, setProgress] = useState(0); // 0–100
  const [faceDetected, setFaceDetected] = useState(false);
  const [busy, setBusy]       = useState(false);
  const [hasFaceApi, setHasFaceApi] = useState(true);

  const videoRef    = useRef<HTMLVideoElement>(null);
  const streamRef   = useRef<MediaStream | null>(null);
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const holdRef     = useRef(0); // ms face has been held in position
  const detectorRef = useRef<any>(null);

  const stopCamera = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (!open) {
      stopCamera();
      setStep("intro");
      setProgress(0);
      holdRef.current = 0;
      setMessage("Position your face in the circle");
      setFaceDetected(false);
    }
  }, [open, stopCamera]);

  // Plain (non-async) — Chrome Android gesture token requires this
  function startScan() {
    if (!window.isSecureContext) {
      setStep("error");
      setMessage("HTTPS_REQUIRED");
      return;
    }
    if (!navigator?.mediaDevices?.getUserMedia) {
      setStep("error");
      setMessage("Camera not supported in this browser. Please use Chrome or Safari.");
      return;
    }

    setStep("scanning");
    setMessage("Starting camera…");

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } } })
      .catch(() => navigator.mediaDevices.getUserMedia({ video: true }))
      .then(stream => afterStream(stream))
      .catch((err: any) => {
        setStep("error");
        const isDenied = err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError";
        setMessage(isDenied ? "CAMERA_DENIED" : `Camera error: ${err?.name} — ${err?.message}`);
      });
  }

  async function afterStream(stream: MediaStream) {
    streamRef.current = stream;
    const video = videoRef.current;
    if (!video) return;

    video.srcObject = stream;
    await video.play();
    await new Promise<void>(res => {
      if (video.videoWidth > 0) { res(); return; }
      video.addEventListener("loadedmetadata", () => res(), { once: true });
      setTimeout(res, 2000);
    });

    // Try native FaceDetector API (Chrome Android / Chrome desktop)
    let detector: any = null;
    if ("FaceDetector" in window) {
      try {
        detector = new (window as any).FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
        detectorRef.current = detector;
      } catch { /* not supported */ }
    }

    if (!detector) {
      // Fallback: no face detection API — just verify camera works and hold for 5s
      setHasFaceApi(false);
      setMessage("Hold still…");
      startHoldTimer(null);
      return;
    }

    setMessage("Position your face in the circle");
    startHoldTimer(detector);
  }

  function startHoldTimer(detector: any | null) {
    holdRef.current = 0;
    setProgress(0);

    timerRef.current = setInterval(async () => {
      const video = videoRef.current;
      if (!video) return;

      if (detector) {
        let faces: any[] = [];
        try { faces = await detector.detect(video); } catch { faces = []; }

        if (!faces.length) {
          setFaceDetected(false);
          setMessage("No face detected — look straight at the camera");
          holdRef.current = 0;
          setProgress(0);
          return;
        }

        const guidance = getFaceGuidance(faces[0], video.videoWidth, video.videoHeight);
        if (guidance) {
          setFaceDetected(true);
          setMessage(guidance);
          holdRef.current = 0;
          setProgress(0);
          return;
        }
      }

      setFaceDetected(true);
      holdRef.current += DETECT_INTERVAL;
      const pct = Math.min(100, Math.round((holdRef.current / (HOLD_SECONDS * 1000)) * 100));
      setProgress(pct);

      const remaining = Math.ceil((HOLD_SECONDS * 1000 - holdRef.current) / 1000);
      setMessage(
        holdRef.current === DETECT_INTERVAL
          ? "Hold still…"
          : remaining > 0
            ? `Hold still… ${remaining}s`
            : "Verifying…"
      );

      if (holdRef.current >= HOLD_SECONDS * 1000) {
        if (timerRef.current) clearInterval(timerRef.current);
        confirmVerified();
      }
    }, DETECT_INTERVAL);
  }

  async function confirmVerified() {
    stopCamera();
    setBusy(true);
    try {
      const res = await fetchWithAuth("/api/auth/liveness", { method: "POST" });
      if (res.ok) {
        setStep("success");
        setTimeout(() => { onVerified(); onClose(); }, 1800);
      } else {
        setStep("error");
        setMessage("Verification failed. Please try again.");
      }
    } catch {
      setStep("error");
      setMessage("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const ringColor = step === "scanning"
    ? faceDetected ? "border-emerald-400" : "border-white/30"
    : "border-white/20";

  const circumference = 2 * Math.PI * 106; // r=106 for w-56 (224px) circle
  const dashOffset = circumference * (1 - progress / 100);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="fixed bottom-0 left-0 right-0 z-50 bg-[#0f0f0f] rounded-t-3xl p-6 pb-10"
            initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
          >
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-white font-semibold text-lg">Liveness Check</h2>
                <p className="text-white/50 text-sm">Hold still to prove you're real</p>
              </div>
              <button onClick={onClose} className="p-2 rounded-full bg-white/10 text-white/60 hover:bg-white/20">
                <X size={18} />
              </button>
            </div>

            {step === "intro" && (
              <div className="flex flex-col items-center gap-6 py-4">
                <div className="w-24 h-24 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
                  <Camera size={36} className="text-emerald-400" />
                </div>
                <div className="text-center">
                  <p className="text-white font-medium mb-1">Earn your Verified badge</p>
                  <p className="text-white/50 text-sm">We'll use your camera to confirm you're a real person. No data is stored.</p>
                </div>
                <button
                  onClick={startScan}
                  className="w-full py-3.5 rounded-2xl bg-emerald-500 text-white font-semibold text-sm active:scale-95 transition-transform"
                >
                  Start Liveness Check
                </button>
              </div>
            )}

            {step === "scanning" && (
              <div className="flex flex-col items-center gap-4">
                <div className="relative w-56 h-56">
                  {/* Progress ring */}
                  <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 224 224">
                    <circle cx="112" cy="112" r="106" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
                    {progress > 0 && (
                      <circle
                        cx="112" cy="112" r="106"
                        fill="none" stroke="#34d399" strokeWidth="4"
                        strokeDasharray={circumference}
                        strokeDashoffset={dashOffset}
                        strokeLinecap="round"
                        style={{ transition: "stroke-dashoffset 0.2s linear" }}
                      />
                    )}
                  </svg>
                  {/* Video circle */}
                  <div className={`absolute inset-[6px] rounded-full border-2 overflow-hidden ${ringColor} transition-colors duration-300`}>
                    <video
                      ref={videoRef}
                      className="w-full h-full object-cover scale-x-[-1]"
                      muted playsInline
                    />
                  </div>
                </div>
                <p className="text-white/70 text-sm text-center px-4 min-h-[20px]">{message}</p>
              </div>
            )}

            {step === "success" && (
              <div className="flex flex-col items-center gap-4 py-4">
                <div className="w-20 h-20 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <ShieldCheck size={40} className="text-emerald-400" />
                </div>
                <p className="text-white font-semibold text-lg">You're Verified!</p>
                <p className="text-white/50 text-sm text-center">Your Verified badge is now active on your profile.</p>
              </div>
            )}

            {step === "error" && (
              <div className="flex flex-col items-center gap-4 py-4">
                <div className="w-20 h-20 rounded-full bg-red-500/10 flex items-center justify-center">
                  <AlertCircle size={40} className="text-red-400" />
                </div>
                {message === "HTTPS_REQUIRED" ? (
                  <>
                    <p className="text-white font-medium">Secure connection required</p>
                    <p className="text-white/50 text-sm text-center">Make sure the address bar shows <span className="text-white">https://</span></p>
                  </>
                ) : message === "CAMERA_DENIED" ? (
                  <>
                    <div className="text-center">
                      <p className="text-white font-medium mb-1">Camera access blocked</p>
                    </div>
                    <div className="w-full bg-white/5 rounded-2xl p-4 text-sm text-white/60 space-y-2">
                      <p>1. Tap the <span className="text-white">🔒 lock icon</span> in your browser's address bar</p>
                      <p>2. Find <span className="text-white">Camera</span> and set it to <span className="text-white">Allow</span></p>
                      <p>3. Refresh the page and try again</p>
                    </div>
                  </>
                ) : (
                  <p className="text-white/70 text-sm text-center">{message}</p>
                )}
                <button
                  onClick={() => { setStep("intro"); setProgress(0); holdRef.current = 0; setFaceDetected(false); setMessage("Position your face in the circle"); }}
                  className="w-full py-3.5 rounded-2xl bg-white/10 text-white font-semibold text-sm"
                >
                  Try Again
                </button>
              </div>
            )}

            {busy && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-t-3xl">
                <Loader2 size={32} className="text-white animate-spin" />
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
