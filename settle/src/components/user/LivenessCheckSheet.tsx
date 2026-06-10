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

const BLINKS_REQUIRED = 2;
const BLINK_THRESHOLD = 0.4; // blendshape score: 0=open, 1=closed

// Guidance based on face bounding box relative to video
function getFaceGuidance(
  box: { originX: number; originY: number; width: number; height: number },
  vw: number,
  vh: number
): string | null {
  const cx = box.originX + box.width / 2;
  const cy = box.originY + box.height / 2;
  const faceRatio = box.width / vw;

  if (faceRatio < 0.18) return "Move closer";
  if (faceRatio > 0.65) return "Move back";
  if (cx / vw < 0.3) return "Move right";
  if (cx / vw > 0.7) return "Move left";
  if (cy / vh < 0.25) return "Move down";
  if (cy / vh > 0.75) return "Move up";
  return null; // face is well-positioned
}

export function LivenessCheckSheet({ open, onClose, onVerified }: Props) {
  const [step, setStep]               = useState<Step>("intro");
  const [blinks, setBlinks]           = useState(0);
  const [message, setMessage]         = useState("Position your face in the circle");
  const [faceDetected, setFaceDetected] = useState(false);
  const [busy, setBusy]               = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);

  const videoRef      = useRef<HTMLVideoElement>(null);
  const streamRef     = useRef<MediaStream | null>(null);
  const rafRef        = useRef<number>(0);
  const landmarkerRef = useRef<any>(null);
  const eyeWasClosed  = useRef(false);
  const blinksRef     = useRef(0);
  const lastTs        = useRef(0);

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
      eyeWasClosed.current = false;
      setMessage("Position your face in the circle");
      setFaceDetected(false);
    }
  }, [open, stopCamera]);

  async function loadLandmarker() {
    if (landmarkerRef.current) return landmarkerRef.current;
    const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
    );
    const landmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true,
    });
    landmarkerRef.current = landmarker;
    return landmarker;
  }

  // Plain (non-async) click handler — Chrome Android requires getUserMedia()
  // to be called synchronously inside the gesture handler.
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
    if (video) {
      video.srcObject = stream;
      await video.play();
      await new Promise<void>(res => {
        if (video.videoWidth > 0) { res(); return; }
        video.addEventListener("loadedmetadata", () => res(), { once: true });
        setTimeout(res, 2000);
      });
    }

    setLoadingModels(true);
    setMessage("Loading face detection…");
    let landmarker: any;
    try {
      landmarker = await loadLandmarker();
    } catch {
      setStep("error");
      setMessage("Failed to load face detection. Check your connection.");
      stopCamera();
      setLoadingModels(false);
      return;
    }
    setLoadingModels(false);
    setMessage("Position your face in the circle");

    const detect = () => {
      const video = videoRef.current;
      if (!video || video.readyState < 2) {
        rafRef.current = requestAnimationFrame(detect);
        return;
      }

      const now = performance.now();
      if (now === lastTs.current) {
        rafRef.current = requestAnimationFrame(detect);
        return;
      }
      lastTs.current = now;

      const result = landmarker.detectForVideo(video, now);

      if (!result?.faceLandmarks?.length) {
        setFaceDetected(false);
        setMessage("No face detected — look straight at the camera");
        rafRef.current = requestAnimationFrame(detect);
        return;
      }

      setFaceDetected(true);

      // Face position guidance using bounding box from landmarks
      const lms = result.faceLandmarks[0];
      const xs = lms.map((p: any) => p.x);
      const ys = lms.map((p: any) => p.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      const box = { originX: minX, originY: minY, width: maxX - minX, height: maxY - minY };
      const guidance = getFaceGuidance(box, 1, 1); // normalized coords
      if (guidance) {
        setMessage(guidance);
        rafRef.current = requestAnimationFrame(detect);
        return;
      }

      // Blink detection via blendshapes
      const blendshapes = result.faceBlendshapes?.[0]?.categories ?? [];
      const getScore = (name: string) =>
        blendshapes.find((c: any) => c.categoryName === name)?.score ?? 0;
      const blinkL = getScore("eyeBlinkLeft");
      const blinkR = getScore("eyeBlinkRight");
      const eyesClosed = blinkL > BLINK_THRESHOLD && blinkR > BLINK_THRESHOLD;

      if (eyesClosed && !eyeWasClosed.current) {
        eyeWasClosed.current = true;
      } else if (!eyesClosed && eyeWasClosed.current) {
        eyeWasClosed.current = false;
        blinksRef.current += 1;
        setBlinks(blinksRef.current);
        if (blinksRef.current >= BLINKS_REQUIRED) {
          cancelAnimationFrame(rafRef.current);
          confirmVerified();
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
    ? faceDetected ? "border-emerald-400" : "border-white/30"
    : "border-white/20";

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
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-white font-semibold text-lg">Liveness Check</h2>
                <p className="text-white/50 text-sm">Blink to prove you're real</p>
              </div>
              <button onClick={onClose} className="p-2 rounded-full bg-white/10 text-white/60 hover:bg-white/20">
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

            {/* Scanning */}
            {step === "scanning" && (
              <div className="flex flex-col items-center gap-4">
                <div className={`relative w-56 h-56 rounded-full border-4 overflow-hidden ${ringColor} transition-colors duration-300`}>
                  <video
                    ref={videoRef}
                    className="w-full h-full object-cover scale-x-[-1]"
                    muted playsInline
                  />
                  {loadingModels && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                      <Loader2 size={28} className="text-white animate-spin" />
                    </div>
                  )}
                </div>
                <p className="text-white/70 text-sm text-center px-4 min-h-[20px]">{message}</p>
                <div className="flex gap-2">
                  {Array.from({ length: BLINKS_REQUIRED }).map((_, i) => (
                    <div
                      key={i}
                      className={`w-3 h-3 rounded-full transition-colors ${i < blinks ? "bg-emerald-400" : "bg-white/20"}`}
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
                <p className="text-white font-semibold text-lg">You're Verified!</p>
                <p className="text-white/50 text-sm text-center">Your Verified badge is now active on your profile.</p>
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
                      <p className="text-white font-medium mb-1">Secure connection required</p>
                      <p className="text-white/50 text-sm">Camera only works over HTTPS.</p>
                    </div>
                    <div className="w-full bg-white/5 rounded-2xl p-4 text-sm text-white/60">
                      <p>Make sure the address bar shows <span className="text-white">https://</span> before the site URL.</p>
                    </div>
                  </>
                ) : message === "CAMERA_DENIED" ? (
                  <>
                    <div className="text-center">
                      <p className="text-white font-medium mb-1">Camera access blocked</p>
                      <p className="text-white/50 text-sm">To enable it:</p>
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
                  onClick={() => { setStep("intro"); setBlinks(0); blinksRef.current = 0; eyeWasClosed.current = false; setMessage("Position your face in the circle"); }}
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
