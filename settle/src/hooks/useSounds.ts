'use client';

import { useCallback, useRef } from 'react';

type SoundType = 'message' | 'send' | 'trade_start' | 'trade_complete' | 'notification' | 'error' | 'click' | 'new_order' | 'order_complete';

// Web Audio API based sound generator
export function useSounds() {
  const audioContextRef = useRef<AudioContext | null>(null);

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }
    return audioContextRef.current;
  }, []);

  const playTone = useCallback((frequency: number, duration: number, type: OscillatorType = 'sine', volume: number = 0.3) => {
    try {
      const ctx = getAudioContext();
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);

      // Envelope for smooth sound
      gainNode.gain.setValueAtTime(0, ctx.currentTime);
      gainNode.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + duration);
    } catch (e) {
      console.log('Sound not available:', e);
    }
  }, [getAudioContext]);

  const playSound = useCallback((sound: SoundType) => {
    switch (sound) {
      case 'message':
        // Pleasant notification chime - two quick ascending tones
        playTone(880, 0.1, 'sine', 0.2);
        setTimeout(() => playTone(1100, 0.15, 'sine', 0.15), 80);
        break;

      case 'send':
        // Soft whoosh sound - quick descending tone
        playTone(600, 0.08, 'sine', 0.15);
        setTimeout(() => playTone(400, 0.1, 'sine', 0.1), 50);
        break;

      case 'trade_start':
        // Exciting start - ascending arpeggio
        playTone(440, 0.1, 'sine', 0.2);
        setTimeout(() => playTone(554, 0.1, 'sine', 0.2), 100);
        setTimeout(() => playTone(659, 0.1, 'sine', 0.2), 200);
        setTimeout(() => playTone(880, 0.2, 'sine', 0.25), 300);
        break;

      case 'trade_complete':
        // Success fanfare - major chord arpeggio
        playTone(523, 0.15, 'sine', 0.2);
        setTimeout(() => playTone(659, 0.15, 'sine', 0.2), 120);
        setTimeout(() => playTone(784, 0.15, 'sine', 0.2), 240);
        setTimeout(() => playTone(1047, 0.3, 'sine', 0.25), 360);
        break;

      case 'notification':
        // Alert sound - attention-grabbing
        playTone(800, 0.1, 'triangle', 0.25);
        setTimeout(() => playTone(1000, 0.15, 'triangle', 0.2), 120);
        break;

      case 'error':
        // Error buzz - low dissonant tone
        playTone(200, 0.15, 'sawtooth', 0.15);
        setTimeout(() => playTone(180, 0.2, 'sawtooth', 0.1), 100);
        break;

      case 'click':
        // Subtle click
        playTone(1000, 0.03, 'sine', 0.1);
        break;

      case 'new_order':
        // Crisp "ka-ching" - bright double ping
        playTone(1200, 0.06, 'sine', 0.2);
        setTimeout(() => playTone(1600, 0.12, 'sine', 0.25), 70);
        break;

      case 'order_complete':
        // Satisfying success - quick rising 3-note chime
        playTone(660, 0.08, 'sine', 0.2);
        setTimeout(() => playTone(880, 0.08, 'sine', 0.22), 80);
        setTimeout(() => playTone(1320, 0.18, 'sine', 0.18), 160);
        break;

      default:
        break;
    }
  }, [playTone]);

  return { playSound };
}

export default useSounds;
