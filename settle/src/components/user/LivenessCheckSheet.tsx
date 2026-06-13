"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ShieldCheck, Loader2, AlertCircle, Camera, Eye, CornerUpLeft, CornerUpRight, Shield, Lock, BadgeCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";

interface Props {
  open: boolean;
  onClose: () => void;
  onVerified: () => void;
}

type Step = "intro" | "scanning" | "success" | "error";
type Task = "blink" | "turn_left" | "turn_right";

const TASKS: Task[] = ["blink", "turn_left", "turn_right"];
const BLINK_EAR_THRESHOLD = 0.24;
const TURN_THRESHOLD = 0.12; // nose offset ratio to trigger head turn
const EYE_L = [362, 385, 387, 263, 373, 380];
const EYE_R = [33,  160, 158, 133, 153, 144];

function ear(pts: number[][], idx: number[]): number {
  const p = (i: number) => pts[idx[i]];
  const d = (a: number[], b: number[]) => Math.hypot(a[0]-b[0], a[1]-b[1]);
  return (d(p(1),p(5)) + d(p(2),p(4))) / (2 * d(p(0),p(3)));
}

function getFaceGuidance(box: { x: number; y: number; width: number; height: number }, vw: number, vh: number): string | null {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const ratio = box.width / vw;
  if (ratio < 0.2)    return "Move closer";
  if (ratio > 0.72)   return "Move back";
  if (cx / vw < 0.28) return "Move right";
  if (cx / vw > 0.72) return "Move left";
  if (cy / vh < 0.22) return "Move down";
  if (cy / vh > 0.78) return "Move up";
  return null;
}

const TASK_LABEL: Record<Task, string> = {
  blink:      "Blink twice",
  turn_left:  "Turn your head left",
  turn_right: "Turn your head right",
};

const TASK_ICON: Record<Task, LucideIcon> = {
  blink:      Eye,
  turn_left:  CornerUpLeft,
  turn_right: CornerUpRight,
};

export function LivenessCheckSheet({ open, onClose, onVerified }: Props) {
  const [step, setStep]         = useState<Step>("intro");
  const [message, setMessage]   = useState("");
  const [taskIdx, setTaskIdx]   = useState(0);
  const [faceOk, setFaceOk]     = useState(false);
  const [busy, setBusy]         = useState(false);
  const [loading, setLoading]   = useState(false);

  const videoRef    = useRef<HTMLVideoElement>(null);
  const streamRef   = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const faceApiRef  = useRef<any>(null);

  // per-task state
  const blinkCount    = useRef(0);
  const eyeWasClosed  = useRef(false);
  const taskIdxRef    = useRef(0);
  const taskDone      = useRef(false);

  const stopCamera = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (!open) {
      stopCamera();
      setStep("intro");
      setMessage("");
      setTaskIdx(0);
      taskIdxRef.current = 0;
      setFaceOk(false);
      blinkCount.current = 0;
      eyeWasClosed.current = false;
      taskDone.current = false;
    }
  }, [open, stopCamera]);

  async function loadModels() {
    if (faceApiRef.current) return faceApiRef.current;
    const faceapi = await import("face-api.js");
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri("/models"),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri("/models"),
    ]);
    faceApiRef.current = faceapi;
    return faceapi;
  }

  function startScan() {
    if (!window.isSecureContext) {
      setStep("error"); setMessage("HTTPS_REQUIRED"); return;
    }
    if (!navigator?.mediaDevices?.getUserMedia) {
      setStep("error"); setMessage("Camera not supported. Please use Chrome or Safari."); return;
    }
    setStep("scanning");
    setMessage("Starting camera…");

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } } })
      .catch(() => navigator.mediaDevices.getUserMedia({ video: true }))
      .then(stream => afterStream(stream))
      .catch((err: any) => {
        setStep("error");
        const denied = err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError";
        setMessage(denied ? "CAMERA_DENIED" : `Camera error: ${err?.name} — ${err?.message}`);
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

    setLoading(true);
    setMessage("Loading face detection…");
    let faceapi: any;
    try {
      faceapi = await loadModels();
    } catch {
      setStep("error");
      setMessage("Failed to load face detection. Check your connection.");
      stopCamera(); setLoading(false); return;
    }
    setLoading(false);
    nextTask();

    // Use setInterval so async detections don't stack up on slow mobile
    intervalRef.current = setInterval(async () => {
      const video = videoRef.current;
      if (!video || video.readyState < 2) return;

      const result = await faceapi
        .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.3, inputSize: 224 }))
        .withFaceLandmarks(true);

      if (!result) {
        setFaceOk(false);
        setMessage("No face detected — look at the camera");
        return;
      }

      const box = result.detection.box;
      const guidance = getFaceGuidance(
        { x: box.x, y: box.y, width: box.width, height: box.height },
        video.videoWidth, video.videoHeight
      );
      if (guidance) {
        setFaceOk(false);
        setMessage(guidance);
        return;
      }

      setFaceOk(true);
      const currentTask = TASKS[taskIdxRef.current];

      if (currentTask === "blink") {
        const pts = result.landmarks.positions.map((p: any) => [p.x, p.y]);
        // face-api 68-point model: left eye 36-41, right eye 42-47
        // ear(pts, [corner1, top1, top2, corner2, bottom1, bottom2])
        const earL = ear(pts, [36, 37, 38, 39, 40, 41]);
        const earR = ear(pts, [42, 43, 44, 45, 46, 47]);
        const avg  = (earL + earR) / 2;

        if (avg < BLINK_EAR_THRESHOLD && !eyeWasClosed.current) {
          eyeWasClosed.current = true;
        } else if (avg >= BLINK_EAR_THRESHOLD && eyeWasClosed.current) {
          eyeWasClosed.current = false;
          blinkCount.current += 1;
          if (blinkCount.current >= 2) advance();
          else setMessage(`Good! Blink once more`);
        } else {
          setMessage("Blink twice");
        }
      }

      if (currentTask === "turn_left") {
        const pts = result.landmarks.positions;
        const noseTip   = pts[30];
        const faceCenter = { x: (box.x + box.width / 2), y: (box.y + box.height / 2) };
        const offsetRatio = (noseTip.x - faceCenter.x) / box.width;
        // mirrored video: nose moving to screen-left = head turning left
        if (offsetRatio > TURN_THRESHOLD) {
          advance();
        } else {
          setMessage("Turn your head left");
        }
      }

      if (currentTask === "turn_right") {
        const pts = result.landmarks.positions;
        const noseTip    = pts[30];
        const faceCenter = { x: (box.x + box.width / 2), y: (box.y + box.height / 2) };
        const offsetRatio = (noseTip.x - faceCenter.x) / box.width;
        if (offsetRatio < -TURN_THRESHOLD) {
          advance();
        } else {
          setMessage("Turn your head right");
        }
      }
    }, 300);
  }

  function nextTask() {
    const task = TASKS[taskIdxRef.current];
    blinkCount.current = 0;
    eyeWasClosed.current = false;
    taskDone.current = false;
    setMessage(TASK_LABEL[task]);
    setTaskIdx(taskIdxRef.current);
  }

  function advance() {
    if (taskDone.current) return;
    taskDone.current = true;
    const next = taskIdxRef.current + 1;
    if (next >= TASKS.length) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      confirmVerified();
    } else {
      taskIdxRef.current = next;
      nextTask();
    }
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
        setStep("error"); setMessage("Verification failed. Please try again.");
      }
    } catch {
      setStep("error"); setMessage("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const ringColor = faceOk ? "border-emerald-400" : "border-white/30";
  const taskProgress = taskIdx / TASKS.length;
  const circumference = 2 * Math.PI * 106;

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
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-text-primary font-semibold text-lg inline-flex items-center gap-2">
                  <ShieldCheck size={20} className="text-emerald-500" />
                  Liveness Check
                </h2>
                <p className="text-text-tertiary text-sm">Quick checks to confirm you're real</p>
              </div>
              <button onClick={onClose} className="p-2 rounded-full bg-surface-active text-text-secondary hover:bg-surface-hover">
                <X size={18} />
              </button>
            </div>

            {step === "intro" && (
              <div className="flex flex-col items-center gap-6 py-4">
                <div className="w-24 h-24 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
                  <Camera size={36} className="text-emerald-400" />
                </div>
                <div className="text-center">
                  <p className="text-text-primary font-medium mb-1 inline-flex items-center justify-center gap-1.5">
                    Earn your <span className="text-emerald-500">Verified</span> badge
                    <BadgeCheck size={16} className="text-emerald-500" />
                  </p>
                  <p className="text-text-tertiary text-sm">We'll ask you to blink and turn your head. No data is stored.</p>
                </div>
                {/* Task preview — numbered steps with icons & dividers */}
                <div className="w-full flex items-stretch rounded-2xl bg-surface-active/60 border border-border-subtle p-1">
                  {TASKS.map((t, i) => {
                    const Icon = TASK_ICON[t];
                    return (
                      <div key={t} className="flex-1 flex flex-col items-center text-center gap-2 px-2 py-3 relative">
                        {i > 0 && (
                          <span className="absolute left-0 top-3 bottom-3 w-px bg-border-subtle" />
                        )}
                        <div className="w-9 h-9 rounded-full bg-emerald-500/10 flex items-center justify-center">
                          <Icon size={18} className="text-emerald-500" />
                        </div>
                        <span className="text-text-secondary text-xs leading-tight">
                          {i + 1}. {TASK_LABEL[t]}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <button
                  onClick={startScan}
                  className="w-full py-3.5 rounded-2xl bg-emerald-500 text-text-primary font-semibold text-sm active:scale-95 transition-transform flex items-center justify-center gap-2"
                >
                  <Shield size={16} />
                  Start Liveness Check
                </button>
                <div className="flex items-center justify-center gap-1.5 text-text-tertiary text-xs -mt-2">
                  <Lock size={12} className="text-emerald-500" />
                  Secure · Private · Encrypted
                </div>
              </div>
            )}

            {step === "scanning" && (
              <div className="flex flex-col items-center gap-4">
                <div className="relative w-56 h-56">
                  {/* Progress ring */}
                  <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 224 224">
                    <circle cx="112" cy="112" r="106" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4"/>
                    <circle
                      cx="112" cy="112" r="106"
                      fill="none" stroke="#34d399" strokeWidth="4"
                      strokeDasharray={circumference}
                      strokeDashoffset={circumference * (1 - taskProgress)}
                      strokeLinecap="round"
                      style={{ transition: "stroke-dashoffset 0.4s ease" }}
                    />
                  </svg>
                  <div className={`absolute inset-[6px] rounded-full border-2 overflow-hidden ${ringColor} transition-colors duration-300`}>
                    <video ref={videoRef} className="w-full h-full object-cover scale-x-[-1]" muted playsInline />
                    {loading && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                        <Loader2 size={28} className="text-text-primary animate-spin" />
                      </div>
                    )}
                  </div>
                </div>

                {/* Step indicators */}
                <div className="flex gap-3">
                  {TASKS.map((t, i) => (
                    <div key={t} className="flex items-center gap-1.5">
                      <div className={`w-2 h-2 rounded-full transition-colors ${
                        i < taskIdx ? "bg-emerald-400" : i === taskIdx ? "bg-text-primary" : "bg-surface-hover"
                      }`}/>
                      <span className={`text-xs transition-colors ${
                        i < taskIdx ? "text-emerald-400" : i === taskIdx ? "text-text-primary" : "text-text-quaternary"
                      }`}>{TASK_LABEL[t]}</span>
                    </div>
                  ))}
                </div>

                <p className="text-text-primary font-medium text-base text-center min-h-[24px]">{message}</p>
              </div>
            )}

            {step === "success" && (
              <div className="flex flex-col items-center gap-4 py-4">
                <div className="w-20 h-20 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <ShieldCheck size={40} className="text-emerald-400" />
                </div>
                <p className="text-text-primary font-semibold text-lg">You're Verified!</p>
                <p className="text-text-tertiary text-sm text-center">Your Verified badge is now active on your profile.</p>
              </div>
            )}

            {step === "error" && (
              <div className="flex flex-col items-center gap-4 py-4">
                <div className="w-20 h-20 rounded-full bg-red-500/10 flex items-center justify-center">
                  <AlertCircle size={40} className="text-red-400" />
                </div>
                {message === "HTTPS_REQUIRED" ? (
                  <p className="text-text-secondary text-sm text-center">Camera requires HTTPS. Make sure the address bar shows <span className="text-text-primary">https://</span></p>
                ) : message === "CAMERA_DENIED" ? (
                  <div className="w-full bg-surface-active rounded-2xl p-4 text-sm text-text-secondary space-y-2">
                    <p className="text-text-primary font-medium mb-2">Camera access blocked</p>
                    <p>1. Tap the <span className="text-text-primary">🔒 lock</span> in the address bar</p>
                    <p>2. Set <span className="text-text-primary">Camera</span> to <span className="text-text-primary">Allow</span></p>
                    <p>3. Refresh and try again</p>
                  </div>
                ) : (
                  <p className="text-text-secondary text-sm text-center">{message}</p>
                )}
                <button
                  onClick={() => {
                    setStep("intro"); setMessage(""); setTaskIdx(0);
                    taskIdxRef.current = 0; setFaceOk(false);
                    blinkCount.current = 0; eyeWasClosed.current = false; taskDone.current = false;
                  }}
                  className="w-full py-3.5 rounded-2xl bg-surface-active text-text-primary font-semibold text-sm"
                >
                  Try Again
                </button>
              </div>
            )}

            {busy && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-t-3xl">
                <Loader2 size={32} className="text-text-primary animate-spin" />
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
