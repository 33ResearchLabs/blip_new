'use client';

import { useState, useCallback } from 'react';
import {
  Copy, Check, Lock, Trash2, Download, Loader2, Droplets, Wallet,
} from 'lucide-react';
import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { DEVNET_RPC } from '@/lib/solana/v2/config';
import { exportPrivateKey } from '@/lib/wallet/embeddedWallet';
import { Keypair } from '@solana/web3.js';

interface EmbeddedWalletPanelProps {
  publicKey: PublicKey | null;
  keypair?: Keypair | null;
  solBalance: number | null;
  usdtBalance: number | null;
  onLock: () => void;
  onDelete: () => void;
  onRefresh: () => Promise<void>;
}

export function EmbeddedWalletPanel({
  publicKey,
  keypair,
  solBalance,
  usdtBalance,
  onLock,
  onDelete,
  onRefresh,
}: EmbeddedWalletPanelProps) {
  const [copied, setCopied] = useState(false);
  const [showExportKey, setShowExportKey] = useState(false);
  const [exportedKey, setExportedKey] = useState('');
  const [copiedKey, setCopiedKey] = useState(false);
  const [isAirdropping, setIsAirdropping] = useState(false);
  const [airdropMsg, setAirdropMsg] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const address = publicKey?.toBase58() ?? '';
  const truncated = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : '';

  const handleCopyAddress = () => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAirdropSol = useCallback(async () => {
    if (!publicKey || isAirdropping) return;
    setIsAirdropping(true);
    setAirdropMsg('');

    try {
      const connection = new Connection(DEVNET_RPC, 'confirmed');
      const sig = await connection.requestAirdrop(publicKey, 2 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig);
      setAirdropMsg('2 SOL airdropped!');
      await onRefresh();
    } catch (err: any) {
      setAirdropMsg(err.message?.includes('429') ? 'Rate limited — try again later' : 'Airdrop failed');
    } finally {
      setIsAirdropping(false);
      setTimeout(() => setAirdropMsg(''), 4000);
    }
  }, [publicKey, isAirdropping, onRefresh]);

  const handleExportKey = () => {
    if (!keypair) return;
    setExportedKey(exportPrivateKey(keypair));
    setShowExportKey(true);
  };

  const handleCopyExportedKey = () => {
    navigator.clipboard.writeText(exportedKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const handleDelete = () => {
    onDelete();
    setShowDeleteConfirm(false);
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="px-3 py-2 border-b border-white/[0.04]">
        <div className="flex items-center gap-2">
          <Wallet className="w-3.5 h-3.5 text-white/30" />
          <h2 className="text-[10px] font-bold text-white/60 font-mono tracking-wider uppercase">
            Embedded Wallet
          </h2>
          <div className="flex items-center gap-1 px-1.5 py-0.5 bg-green-500/10 rounded border border-green-500/20">
            <div className="w-1.5 h-1.5 bg-green-500 rounded-full" />
            <span className="text-[9px] text-green-400 font-mono">Unlocked</span>
          </div>
        </div>
      </div>

      <div className="px-3 space-y-3">
        {/* Address */}
        <div
          onClick={handleCopyAddress}
          className="flex items-center justify-between p-2.5 bg-white/[0.02] border border-white/[0.06] rounded-lg cursor-pointer hover:border-white/[0.12] transition-colors"
        >
          <div>
            <div className="text-[9px] text-white/30 font-mono uppercase">Address</div>
            <div className="text-sm text-white font-mono">{truncated}</div>
          </div>
          {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5 text-white/30" />}
        </div>

        {/* Balances */}
        <div className="grid grid-cols-2 gap-2">
          <div className="p-2.5 bg-white/[0.02] border border-white/[0.06] rounded-lg">
            <div className="text-[9px] text-white/30 font-mono uppercase">SOL</div>
            <div className="text-base font-bold text-white font-mono tabular-nums">
              {solBalance !== null ? solBalance.toFixed(4) : '—'}
            </div>
          </div>
          <div className="p-2.5 bg-white/[0.02] border border-white/[0.06] rounded-lg">
            <div className="text-[9px] text-white/30 font-mono uppercase">USDT</div>
            <div className="text-base font-bold text-orange-500 font-mono tabular-nums">
              {usdtBalance !== null ? usdtBalance.toFixed(2) : '—'}
            </div>
          </div>
        </div>

        {/* Airdrop SOL */}
        <button
          onClick={handleAirdropSol}
          disabled={isAirdropping}
          className="w-full py-2 rounded-lg bg-white/[0.04] border border-white/[0.06]
                     text-xs text-white/60 font-mono hover:bg-white/[0.06] transition-colors
                     disabled:opacity-50 flex items-center justify-center gap-1.5"
        >
          {isAirdropping ? <Loader2 className="w-3 h-3 animate-spin" /> : <Droplets className="w-3 h-3" />}
          {isAirdropping ? 'Airdropping...' : 'Airdrop 2 SOL (Devnet)'}
        </button>
        {airdropMsg && (
          <div className={`text-[10px] font-mono text-center ${airdropMsg.includes('airdropped') ? 'text-green-400' : 'text-red-400'}`}>
            {airdropMsg}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          {keypair && (
            <button
              onClick={handleExportKey}
              className="flex-1 py-2 rounded-lg bg-white/[0.04] border border-white/[0.06]
                         text-[10px] text-white/50 font-mono hover:bg-white/[0.06] transition-colors
                         flex items-center justify-center gap-1"
            >
              <Download className="w-3 h-3" />
              Export Key
            </button>
          )}
          <button
            onClick={onLock}
            className="flex-1 py-2 rounded-lg bg-white/[0.04] border border-white/[0.06]
                       text-[10px] text-white/50 font-mono hover:bg-white/[0.06] transition-colors
                       flex items-center justify-center gap-1"
          >
            <Lock className="w-3 h-3" />
            Lock
          </button>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="py-2 px-3 rounded-lg bg-red-500/10 border border-red-500/20
                       text-[10px] text-red-400 font-mono hover:bg-red-500/20 transition-colors
                       flex items-center justify-center"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Export Key Modal */}
      {showExportKey && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => { setShowExportKey(false); setExportedKey(''); }}>
          <div className="bg-[#0d0d0d] rounded-2xl w-full max-w-sm border border-white/[0.08] shadow-2xl p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-white font-mono">Private Key</h3>
            <div className="relative">
              <div className="p-3 bg-white/[0.04] border border-white/[0.08] rounded-lg font-mono text-xs text-white/80 break-all select-all">
                {exportedKey}
              </div>
              <button onClick={handleCopyExportedKey} className="absolute top-2 right-2 p-1.5 rounded-md hover:bg-white/[0.08]">
                {copiedKey ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5 text-white/40" />}
              </button>
            </div>
            <p className="text-[9px] text-red-400/70 font-mono">Never share this key. Anyone with it can access your funds.</p>
            <button onClick={() => { setShowExportKey(false); setExportedKey(''); }}
              className="w-full py-2 rounded-lg bg-white/[0.06] text-xs text-white/60 font-mono hover:bg-white/[0.08]">
              Close
            </button>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowDeleteConfirm(false)}>
          <div className="bg-[#0d0d0d] rounded-2xl w-full max-w-sm border border-white/[0.08] shadow-2xl p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-red-400 font-mono">Delete Wallet?</h3>
            <p className="text-xs text-white/50 font-mono">
              This removes the encrypted key from this device. Make sure you have exported your private key first.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-2 rounded-lg bg-white/[0.06] text-xs text-white/60 font-mono hover:bg-white/[0.08]">
                Cancel
              </button>
              <button onClick={handleDelete}
                className="flex-1 py-2 rounded-lg bg-red-500/20 border border-red-500/30 text-xs text-red-400 font-mono hover:bg-red-500/30">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
