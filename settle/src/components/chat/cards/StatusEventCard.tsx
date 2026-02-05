'use client';

import {
  Check,
  Clock,
  Lock,
  Unlock,
  DollarSign,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Timer,
  FileText,
  Zap,
  Bot,
} from 'lucide-react';
import type { ReactNode } from 'react';

type EventType =
  | 'order_created'
  | 'accepted'
  | 'escrowed'
  | 'payment_sent'
  | 'payment_confirmed'
  | 'completed'
  | 'cancelled'
  | 'expired'
  | 'disputed'
  | 'extension_requested'
  | 'extension_granted'
  | 'info';

interface StatusEventCardProps {
  type: EventType;
  text: string;
  timestamp?: Date;
  metadata?: Record<string, unknown>;
}

const EVENT_CONFIG: Record<EventType, {
  icon: ReactNode;
  bg: string;
  iconColor: string;
  borderColor?: string;
}> = {
  order_created: {
    icon: <FileText className="w-3.5 h-3.5" />,
    bg: 'bg-blue-500/20',
    iconColor: 'text-blue-400',
  },
  accepted: {
    icon: <Check className="w-3.5 h-3.5" />,
    bg: 'bg-emerald-500/20',
    iconColor: 'text-emerald-400',
  },
  escrowed: {
    icon: <Lock className="w-3.5 h-3.5" />,
    bg: 'bg-purple-500/20',
    iconColor: 'text-purple-400',
  },
  payment_sent: {
    icon: <DollarSign className="w-3.5 h-3.5" />,
    bg: 'bg-cyan-500/20',
    iconColor: 'text-cyan-400',
  },
  payment_confirmed: {
    icon: <CheckCircle2 className="w-3.5 h-3.5" />,
    bg: 'bg-teal-500/20',
    iconColor: 'text-teal-400',
  },
  completed: {
    icon: <Unlock className="w-3.5 h-3.5" />,
    bg: 'bg-emerald-500/20',
    iconColor: 'text-emerald-400',
    borderColor: 'border-emerald-500/30',
  },
  cancelled: {
    icon: <XCircle className="w-3.5 h-3.5" />,
    bg: 'bg-red-500/20',
    iconColor: 'text-red-400',
    borderColor: 'border-red-500/30',
  },
  expired: {
    icon: <Timer className="w-3.5 h-3.5" />,
    bg: 'bg-zinc-500/20',
    iconColor: 'text-zinc-400',
  },
  disputed: {
    icon: <AlertTriangle className="w-3.5 h-3.5" />,
    bg: 'bg-orange-500/20',
    iconColor: 'text-orange-400',
    borderColor: 'border-orange-500/30',
  },
  extension_requested: {
    icon: <Clock className="w-3.5 h-3.5" />,
    bg: 'bg-amber-500/20',
    iconColor: 'text-amber-400',
  },
  extension_granted: {
    icon: <Zap className="w-3.5 h-3.5" />,
    bg: 'bg-amber-500/20',
    iconColor: 'text-amber-400',
  },
  info: {
    icon: <Bot className="w-3.5 h-3.5" />,
    bg: 'bg-amber-500/20',
    iconColor: 'text-amber-400',
  },
};

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function StatusEventCard({ type, text, timestamp, metadata }: StatusEventCardProps) {
  const config = EVENT_CONFIG[type] || EVENT_CONFIG.info;

  // Special styling for terminal events (completed, cancelled, disputed)
  const isTerminal = ['completed', 'cancelled', 'disputed'].includes(type);
  const borderClass = config.borderColor || 'border-white/[0.06]';

  return (
    <div className={`bg-white/[0.03] border ${borderClass} rounded-xl px-4 py-3 ${isTerminal ? 'ring-1 ring-inset ' + borderClass : ''}`}>
      <div className="flex items-start gap-3">
        <div className={`flex-shrink-0 p-1.5 rounded-lg ${config.bg} ${config.iconColor}`}>
          {config.icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-gray-200">{text}</p>
          {timestamp && (
            <span className="text-[10px] text-gray-500 mt-1 block">
              {formatTime(timestamp)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// Helper function to detect event type from message text
export function detectEventType(text: string): EventType {
  const lowerText = text.toLowerCase();

  if (lowerText.includes('created') || lowerText.includes('new order')) return 'order_created';
  if (lowerText.includes('accepted')) return 'accepted';
  if (lowerText.includes('escrow') && (lowerText.includes('lock') || lowerText.includes('secured'))) return 'escrowed';
  if (lowerText.includes('payment') && lowerText.includes('sent')) return 'payment_sent';
  if (lowerText.includes('payment') && lowerText.includes('confirmed')) return 'payment_confirmed';
  if (lowerText.includes('completed') || lowerText.includes('released')) return 'completed';
  if (lowerText.includes('cancelled') || lowerText.includes('canceled')) return 'cancelled';
  if (lowerText.includes('expired')) return 'expired';
  if (lowerText.includes('dispute')) return 'disputed';
  if (lowerText.includes('extension') && lowerText.includes('request')) return 'extension_requested';
  if (lowerText.includes('extension') && (lowerText.includes('grant') || lowerText.includes('approved'))) return 'extension_granted';

  return 'info';
}

export default StatusEventCard;
