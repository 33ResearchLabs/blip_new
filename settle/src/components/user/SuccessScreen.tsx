"use client";

import { motion } from "framer-motion";
import { CheckCircle2 } from "lucide-react";

interface SuccessScreenProps {
  amount: string;
  type: 'buy' | 'sell';
  onDone: () => void;
}

export default function SuccessScreen({ amount, type, onDone }: SuccessScreenProps) {
  return (
    <div className="h-full w-full flex flex-col items-center justify-center relative overflow-hidden"
      style={{ background: '#06060e', padding: 40, textAlign: 'center' }}>
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse at 50% 38%, rgba(16,185,129,0.12) 0%, rgba(124,58,237,0.08) 40%, transparent 70%)'
      }} />
      <motion.div
        initial={{ scale: 0.4, rotate: -15, opacity: 0 }}
        animate={{ scale: 1, rotate: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 400, damping: 10 }}
        className="flex items-center justify-center z-10"
        style={{
          width: 140, height: 140, borderRadius: 48, marginBottom: 36,
          background: 'linear-gradient(135deg, #059669 0%, #7c3aed 100%)',
          boxShadow: '0 0 60px rgba(16,185,129,0.28), 0 0 100px rgba(124,58,237,0.18)',
        }}>
        <CheckCircle2 size={68} strokeWidth={2.5} style={{ color: '#fff' }} />
      </motion.div>

      <motion.p initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.15 }}
        style={{ fontSize: 60, fontWeight: 900, letterSpacing: '-0.04em', lineHeight: 1, marginBottom: 10, zIndex: 1 }}>
        Done.
      </motion.p>
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }}
        style={{ fontSize: 18, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.2em',
          color: 'rgba(255,255,255,0.28)', marginBottom: 60, zIndex: 1 }}>
        {type === 'buy' ? 'Bought' : 'Sold'} {amount} USDC
      </motion.p>
      <motion.button
        whileTap={{ scale: 0.94 }}
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
        onClick={onDone}
        className="w-full z-10"
        style={{ height: 76, borderRadius: 32, fontSize: 17, fontWeight: 900,
          background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
          color: 'rgba(255,255,255,0.45)' }}>
        Back to Home
      </motion.button>
    </div>
  );
}
