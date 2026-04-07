import { useEffect, useRef, useCallback } from 'react';

interface TradeUpdate {
  action: string;
  trade_pda: string;
  status: string;
  amount: string;
  creator: string;
  counterparty: string | null;
  created_at: string;
  updated_at: string;
}

interface StreamEvent {
  type: 'connected' | 'trade_update' | 'heartbeat' | 'error';
  data?: TradeUpdate;
  message?: string;
}

export function useTradeStream(onUpdate: (event: StreamEvent) => void) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource('/api/stream');
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const parsed: StreamEvent = JSON.parse(event.data);
        onUpdateRef.current(parsed);
      } catch {
        // Invalid event
      }
    };

    es.onerror = () => {
      es.close();
      // Reconnect after 3 seconds
      setTimeout(() => {
        if (eventSourceRef.current === es) {
          connect();
        }
      }, 3000);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [connect]);
}
