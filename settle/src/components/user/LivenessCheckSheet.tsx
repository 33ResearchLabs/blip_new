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

const BLINK_THRESHOLD = 0.22;   // EAR below this = eye closed
const BLINKS_REQUIRED = 2;
const EYE_LEFT  = [362, 385, 387, 263, 373, 380];
const EYE_RIGHT = [33,  160, 158, 133, 153, 144];

function eyeAspectRatio(landmarks: number[][], indices: number[]): number {
  const p = (i: number) => landmarks[indices[i]];
  const dist = (a: number[], b: number[]) =>
    Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);
  const v1 = dist(p(1), p(5));
  const v2 = dist(p(2), p(4));
  const h  = dist(p(0), p(3));
  return (v1 + v2) / (2 * h);
}

export function LivenessCheckSheet({ open, onClose, onVerified }: Props) {
  const [step, setStep]           = useState<Step>("intro");
  const [blinks, setBlinks]       = useState(0);
  const [message, setMessage]     = useState("Position your face in the circle");
  const [faceDetected, setFaceDetected] = useState(false);
  const [busy, setBusy]           = useState(false);

  const videoRef    = useRef<HTMLVideoElement>(null);
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const streamRef   = useRef<MediaStream | null>(null);
  const rafRef      = useRef<number>(0);
  const faceApiRef  = useRef<any>(null);
  const eyeWasClosedRef = useRef(false);
  const blinksRef   = useRef(0);

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (!open) {
      stopCamera();
      setStep("intro");
      setBlinks(0);
      blinksRef.current = 0;
      setMessage("Position your face in the circle");
      setFaceDetected(false);
    }
  }, [open, stopCamera]);

  async function loadModels() {
    if (faceApiRef.current) return faceApiRef.current;
    const faceapi = await import("face-api.js");
    const MODEL_URL = "/models";
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
    ]);
    faceApiRef.current = faceapi;
    return faceapi;
  }

  // Non-async wrapper — Chrome Android requires getUserMedia() to be invoked
  // synchronously inside the click handler. Async functions break the gesture
  // activation token on some Android versions even when called first.
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
    setMessage("Loading camera…");

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user" } })
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
    if (video) {
      video.srcObject = stream;
      await video.play();
      // Wait until the video has actual dimensions before running detection
      await new Promise<void>(res => {
        if (video.videoWidth > 0) { res(); return; }
        video.addEventListener("loadedmetadata", () => res(), { once: true });
        setTimeout(res, 2000); // fallback
      });
    }

    let faceapi: any;
    try {
      faceapi = await loadModels();
    } catch {
      setStep("error");
      setMessage("Failed to load face detection. Check your connection.");
      stopCamera();
      return;
    }

    setMessage("Position your face in the circle");

    const detect = async () => {
      if (!videoRef.current || !canvasRef.current) return;
      const result = await faceapi
        .detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.3 }))
        .withFaceLandmarks(true);

      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (!result) {
        setFaceDetected(false);
        setMessage("No face detected — look straight at the camera");
        rafRef.current = requestAnimationFrame(detect);
        return;
      }

      setFaceDetected(true);

      // Extract landmark positions as [x,y] arrays
      const pts = result.landmarks.positions.map((p: any) => [p.x, p.y]);
      const earLeft  = eyeAspectRatio(pts, EYE_LEFT);
      const earRight = eyeAspectRatio(pts, EYE_RIGHT);
      const ear = (earLeft + earRight) / 2;

      const eyesClosed = ear < BLINK_THRESHOLD;
      if (eyesClosed && !eyeWasClosedRef.current) {
        eyeWasClosedRef.current = true;
      } else if (!eyesClosed && eyeWasClosedRef.current) {
        eyeWasClosedRef.current = false;
        blinksRef.current += 1;
        setBlinks(blinksRef.current);
        if (blinksRef.current >= BLINKS_REQUIRED) {
          cancelAnimationFrame(rafRef.current);
          await confirmVerified();
          return;
        }
      }

      const remaining = BLINKS_REQUIRED - blinksRef.current;
      setMessage(
        blinksRef.current === 0
          ? "Blink slowly to verify you're real"
          : `Great! Blink ${remaining} more time${remaining !== 1 ? "s" : ""}`
      );

      rafRef.current = requestAnimationFrame(detect);
    };

    rafRef.current = requestAnimationFrame(detect);
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
    ? faceDetected ? "border-emerald-400" : "border-border-strong"
    : "border-border-subtle";

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
            className="fixed bottom-0 left-0 right-0 z-50 bg-surface-raised border-t border-border-subtle rounded-t-3xl p-6 pb-10"
            initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-text-primary font-semibold text-lg">Liveness Check</h2>
                <p className="text-text-secondary text-sm">Blink to prove you're real</p>
              </div>
              <button onClick={onClose} className="p-2 rounded-full bg-surface-active text-text-tertiary hover:text-text-primary">
                <X size={18} />
              </button>
            </div>

            {/* Intro */}
            {step === "intro" && (
              <div className="flex flex-col items-center gap-6 py-4">
                <div className="w-24 h-24 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
                  <Camera size={36} className="text-emerald-400" />
                </div>
                <div className="text-center">
                  <p className="text-text-primary font-medium mb-1">Earn your Verified badge</p>
                  <p className="text-text-secondary text-sm">We'll use your camera to confirm you're a real person. No data is stored.</p>
                </div>
                <button
                  onClick={startScan}
                  className="w-full py-3.5 rounded-2xl bg-emerald-500 text-white font-semibold text-sm active:scale-95 transition-transform"
                >
                  Start Liveness Check
                </button>
              </div>
            )}

            {/* Scanning */}
            {step === "scanning" && (
              <div className="flex flex-col items-center gap-4">
                <div className={`relative w-56 h-56 rounded-full border-4 overflow-hidden ${ringColor} transition-colors duration-300`}>
                  <video
                    ref={videoRef}
                    className="w-full h-full object-cover scale-x-[-1]"
                    muted playsInline
                  />
                  <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
                </div>
                <p className="text-text-secondary text-sm text-center px-4">{message}</p>
                <div className="flex gap-2">
                  {Array.from({ length: BLINKS_REQUIRED }).map((_, i) => (
                    <div
                      key={i}
                      className={`w-3 h-3 rounded-full transition-colors ${i < blinks ? "bg-emerald-400" : "bg-border-strong"}`}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Success */}
            {step === "success" && (
              <div className="flex flex-col items-center gap-4 py-4">
                <div className="w-20 h-20 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <ShieldCheck size={40} className="text-emerald-400" />
                </div>
                <p className="text-text-primary font-semibold text-lg">You're Verified!</p>
                <p className="text-text-secondary text-sm text-center">Your Verified badge is now active on your profile.</p>
              </div>
            )}

            {/* Error */}
            {step === "error" && (
              <div className="flex flex-col items-center gap-4 py-4">
                <div className="w-20 h-20 rounded-full bg-red-500/10 flex items-center justify-center">
                  <AlertCircle size={40} className="text-red-400" />
                </div>
                {message === "HTTPS_REQUIRED" ? (
                  <>
                    <div className="text-center">
                      <p className="text-text-primary font-medium mb-1">Secure connection required</p>
                      <p className="text-text-secondary text-sm">Camera only works over HTTPS.</p>
                    </div>
                    <div className="w-full bg-surface-active rounded-2xl p-4 text-sm text-text-secondary">
                      <p>Make sure the address bar shows <span className="text-text-primary">https://</span> before the site URL.</p>
                    </div>
                  </>
                ) : message === "CAMERA_DENIED" ? (
                  <>
                    <div className="text-center">
                      <p className="text-text-primary font-medium mb-1">Camera access blocked</p>
                      <p className="text-text-secondary text-sm">To enable it:</p>
                    </div>
                    <div className="w-full bg-surface-active rounded-2xl p-4 text-sm text-text-secondary space-y-2">
                      <p>1. Tap the <span className="text-text-primary">🔒 lock icon</span> in your browser's address bar</p>
                      <p>2. Find <span className="text-text-primary">Camera</span> and set it to <span className="text-text-primary">Allow</span></p>
                      <p>3. Refresh the page and try again</p>
                    </div>
                  </>
                ) : (
                  <p className="text-text-secondary text-sm text-center">{message}</p>
                )}
                <button
                  onClick={() => { setStep("intro"); setBlinks(0); blinksRef.current = 0; setMessage("Position your face in the circle"); }}
                  className="w-full py-3.5 rounded-2xl bg-surface-active text-text-primary font-semibold text-sm"
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
