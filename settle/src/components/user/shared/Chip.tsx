"use client";

interface ChipProps {
  label: string;
  value: string;
  color: string;
}

export default function Chip({ label, value, color }: ChipProps) {
  return (
    <div
      className="flex-1 rounded-[18px] px-3 py-3"
      style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.055)' }}
    >
      <p className="text-[7.5px] font-black uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.25)' }}>
        {label}
      </p>
      <p className="text-[13px] font-black" style={{ color }}>
        {value}
      </p>
    </div>
  );
}
