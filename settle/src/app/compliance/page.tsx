"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  X,
  Shield,
  Bell,
  Activity,
  Send,
  MessageCircle,
  ChevronLeft,
  Users,
  Clock,
  Scale,
  UserCheck,
  Building2,
  Eye,
  AlertTriangle,
  FileText,
  Search,
  Filter,
  MoreHorizontal,
  ExternalLink,
  Zap,
  LogOut,
  Wallet,
  Loader2,
} from "lucide-react";
import { useRealtimeChat } from "@/hooks/useRealtimeChat";
import { usePusher } from "@/context/PusherContext";
import { useComplianceAuth } from "@/hooks/useComplianceAuth";
import { useDisputeManagement } from "@/hooks/useDisputeManagement";
import type { DisputeOrder } from "@/hooks/useDisputeManagement";
import DisputeCard, { getEmoji, formatTimeAgo } from "@/components/compliance/DisputeCard";
import ResolveModal from "@/components/compliance/ResolveModal";
import PWAInstallBanner from "@/components/PWAInstallBanner";
import dynamic from "next/dynamic";

// Dynamically import wallet components (client-side only)
const ComplianceWalletModal = dynamic(() => import("@/components/MerchantWalletModal"), { ssr: false });
const useSolanaWalletHook = () => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useSolanaWallet } = require("@/context/SolanaWalletContext");
    return useSolanaWallet();
  } catch {
    return {
      connected: false,
      connecting: false,
      publicKey: null,
      walletAddress: null,
      connect: () => {},
      disconnect: () => {},
      openWalletModal: () => {},
      solBalance: null,
      usdtBalance: null,
      refreshBalances: async () => {},
      releaseEscrow: async () => ({ txHash: '', success: false }),
      refundEscrow: async () => ({ txHash: '', success: false }),
      // V2.3: Dispute resolution (arbiter only)
      resolveDispute: async () => ({ txHash: '', success: false }),
      openDispute: async () => ({ txHash: '', success: false }),
      network: 'devnet' as const,
    };
  }
};

// Quick questions for compliance chat
const QUICK_QUESTIONS = [
  "Can you provide proof of payment?",
  "Please share the transaction ID",
  "When did you send the payment?",
  "What bank/method did you use?",
  "Did you receive any confirmation?",
];

export default function ComplianceDashboard() {
  // Solana wallet hook
  const solanaWallet = useSolanaWalletHook();

  // Auth hook
  const auth = useComplianceAuth(solanaWallet);
  const {
    isLoggedIn,
    member,
    loginForm,
    setLoginForm,
    loginError,
    isLoading,
    showWalletModal,
    setShowWalletModal,
    isWalletLoggingIn,
    handleLogin,
    handleWalletLogin,
    handleLogout,
  } = auth;

  // Notifications state
  const [notifications, setNotifications] = useState<{
    id: string;
    type: 'dispute' | 'resolution' | 'escalation' | 'system';
    message: string;
    time: string;
    read: boolean;
    disputeId?: string;
  }[]>([]);

  // Mark notification as read
  const markNotificationRead = (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  // Add notification helper
  const addNotification = useCallback((type: 'dispute' | 'resolution' | 'escalation' | 'system', message: string, disputeId?: string) => {
    const newNotif = {
      id: `notif-${Date.now()}`,
      type,
      message,
      time: 'Just now',
      read: false,
      disputeId,
    };
    setNotifications(prev => [newNotif, ...prev].slice(0, 50));
  }, []);

  // Dispute management hook
  const disputeMgmt = useDisputeManagement(member, solanaWallet, addNotification);
  const {
    disputes,
    showResolveModal,
    setShowResolveModal,
    selectedDispute,
    setSelectedDispute,
    resolveForm,
    setResolveForm,
    isProcessingOnChain,
    fetchDisputes,
    startInvestigating,
    resolveDispute,
    finalizeDispute,
    getDisputeReasonInfo,
  } = disputeMgmt;

  const [showNotifications, setShowNotifications] = useState(false);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<{
    type: "user" | "merchant";
    id: string;
    name: string;
    wallet: string;
    rating: number;
    trades: number;
  } | null>(null);
  // Mobile view state: 'open' | 'investigating' | 'resolved' | 'chat'
  const [mobileView, setMobileView] = useState<'open' | 'investigating' | 'resolved' | 'chat'>('open');

  const chatInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Pusher context
  const { setActor } = usePusher();

  // Set actor when logged in
  useEffect(() => {
    if (member) {
      setActor("compliance", member.id);
    }
  }, [member, setActor]);

  // Real-time chat hook
  const {
    chatWindows,
    openChat,
    closeChat,
    sendMessage,
  } = useRealtimeChat({
    maxWindows: 10,
    actorType: "compliance",
    actorId: member?.id,
  });

  useEffect(() => {
    if (isLoggedIn) {
      fetchDisputes();
      const interval = setInterval(fetchDisputes, 10000);
      return () => clearInterval(interval);
    }
  }, [isLoggedIn, fetchDisputes]);

  // Open dispute group chat
  const handleOpenDisputeChat = (dispute: DisputeOrder) => {
    const chatName = `Dispute #${dispute.orderNumber}`;
    const emoji = "\u2696\uFE0F";
    openChat(chatName, emoji, dispute.id);

    setTimeout(() => {
      const chat = chatWindows.find(w => w.orderId === dispute.id);
      if (chat) setActiveChatId(chat.id);
    }, 50);
  };

  // Scroll to bottom of messages
  useEffect(() => {
    if (activeChatId && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [activeChatId, chatWindows]);

  // Categorize disputes
  const openDisputes = disputes.filter(d =>
    d.orderStatus === "disputed" && (!d.dispute?.status || d.dispute.status === "open")
  );
  const investigatingDisputes = disputes.filter(d =>
    d.dispute?.status === "investigating" || d.dispute?.status === "pending_confirmation"
  );
  const resolvedDisputes = disputes.filter(d =>
    d.dispute?.status?.startsWith("resolved") || d.dispute?.status === "finalized"
  );

  const activeChat = chatWindows.find(c => c.id === activeChatId);
  const totalUnread = chatWindows.reduce((sum, c) => sum + c.unread, 0);

  // Login screen
  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center mx-auto mb-4">
              <Shield className="w-8 h-8 text-orange-400" />
            </div>
            <h1 className="text-xl font-bold mb-2">Compliance Portal</h1>
            <p className="text-sm text-gray-500">Dispute Resolution Center</p>
          </div>

          <div className="bg-[#0d0d0d] rounded-2xl border border-white/[0.04] p-6 space-y-4">
            {loginError && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-sm text-red-400">
                {loginError}
              </div>
            )}

            {/* Primary: Wallet Login Section */}
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                if (solanaWallet.connected) {
                  handleWalletLogin();
                } else {
                  sessionStorage.setItem("pending_compliance_wallet_login", "true");
                  setShowWalletModal(true);
                }
              }}
              disabled={isWalletLoggingIn}
              className="w-full py-3 rounded-xl text-sm font-bold bg-purple-600 text-white hover:bg-purple-500 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isWalletLoggingIn ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Verifying wallet...
                </>
              ) : solanaWallet.connected ? (
                <>
                  <Wallet className="w-4 h-4" />
                  Sign In with {solanaWallet.walletAddress?.slice(0, 4)}...{solanaWallet.walletAddress?.slice(-4)}
                </>
              ) : (
                <>
                  <Wallet className="w-4 h-4" />
                  Connect DAO Wallet
                </>
              )}
            </motion.button>

            {solanaWallet.connected && !isLoggedIn && (
              <p className="text-[10px] text-center text-gray-500">
                Connected: {solanaWallet.walletAddress?.slice(0, 8)}...{solanaWallet.walletAddress?.slice(-8)}
              </p>
            )}

            <p className="text-[11px] text-gray-500 text-center">
              Authorized DAO members only (Devnet)
            </p>

            {/* Divider */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-white/[0.04]"></div>
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="px-2 bg-[#0d0d0d] text-gray-500">Legacy Login (Testing)</span>
              </div>
            </div>

            {/* Collapsible Email Login */}
            <details className="w-full">
              <summary className="cursor-pointer text-gray-400 text-xs text-center mb-4 hover:text-gray-300 transition-colors">
                Show email/password login
              </summary>

              <div className="space-y-4 mt-4">
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wide mb-2 block">Email</label>
                  <input
                    type="email"
                    value={loginForm.email}
                    onChange={(e) => setLoginForm(prev => ({ ...prev, email: e.target.value }))}
                    placeholder="compliance@blip.money"
                    className="w-full bg-[#1f1f1f] rounded-xl px-4 py-3 text-sm outline-none placeholder:text-gray-600 focus:ring-1 focus:ring-orange-500/30"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wide mb-2 block">Password</label>
                  <input
                    type="password"
                    value={loginForm.password}
                    onChange={(e) => setLoginForm(prev => ({ ...prev, password: e.target.value }))}
                    placeholder="••••••••"
                    className="w-full bg-[#1f1f1f] rounded-xl px-4 py-3 text-sm outline-none placeholder:text-gray-600 focus:ring-1 focus:ring-orange-500/30"
                    onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                  />
                </div>

                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={handleLogin}
                  disabled={isLoading}
                  className="w-full py-3 rounded-xl text-sm font-bold bg-orange-500 text-black hover:bg-orange-400 transition-colors disabled:opacity-50"
                >
                  {isLoading ? "Signing in..." : "Sign In with Email"}
                </motion.button>
              </div>
            </details>

            {/* Test account shortcuts removed for production safety */}
          </div>
        </div>

        {/* Wallet Modal */}
        {showWalletModal && (
          <ComplianceWalletModal
            isOpen={showWalletModal}
            onClose={() => setShowWalletModal(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col">
      {/* Ambient Background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-1/3 w-[600px] h-[400px] bg-orange-500/[0.02] rounded-full blur-[150px]" />
        <div className="absolute bottom-0 left-1/4 w-[500px] h-[300px] bg-orange-500/[0.015] rounded-full blur-[150px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[500px] bg-white/[0.01] rounded-full blur-[200px]" />
      </div>

      {/* Top Navbar */}
      <header className="sticky top-0 z-50 bg-[#0a0a0a]/90 backdrop-blur-xl border-b border-white/[0.04]">
        <div className="px-4 h-12 flex items-center gap-3">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg border border-orange-500/30 bg-orange-500/10 flex items-center justify-center">
              <Shield className="w-4 h-4 text-orange-400" />
            </div>
            <span className="text-sm font-semibold hidden sm:block">Compliance</span>
          </div>

          {/* Nav Links */}
          <nav className="flex items-center gap-1 ml-3">
            <button className="px-2.5 py-1 text-[11px] font-medium bg-orange-500/10 border border-orange-500/20 rounded-md text-orange-400">
              Disputes
            </button>
            <button className="px-2.5 py-1 text-[11px] font-medium text-gray-400 hover:text-white hover:bg-white/[0.04] rounded-md transition-all">
              History
            </button>
            <button className="px-2.5 py-1 text-[11px] font-medium text-gray-400 hover:text-white hover:bg-white/[0.04] rounded-md transition-all">
              Analytics
            </button>
          </nav>

          <div className="flex-1" />

          {/* Quick Stats */}
          <div className="hidden lg:flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-red-500/10 rounded-md border border-red-500/20" title="Open Disputes">
              <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
              <span className="text-xs font-bold text-red-400">{openDisputes.length}</span>
              <span className="text-[10px] text-red-400/60">open</span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-orange-500/10 rounded-md border border-orange-500/20" title="Investigating">
              <Eye className="w-3.5 h-3.5 text-orange-400" />
              <span className="text-xs font-bold text-orange-400">{investigatingDisputes.length}</span>
              <span className="text-[10px] text-orange-400/60">active</span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[#151515] rounded-md border border-white/[0.04]" title="Resolved Today">
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-xs font-medium text-emerald-400">{resolvedDisputes.length}</span>
              <span className="text-[10px] text-gray-500">resolved</span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[#151515] rounded-md border border-white/[0.04]" title="Total Volume at Risk">
              <Activity className="w-3.5 h-3.5 text-gray-400" />
              <span className="text-xs font-medium">
                ${disputes.reduce((sum, d) => sum + d.cryptoAmount, 0).toLocaleString()}
              </span>
            </div>
          </div>

          {/* Online Status */}
          <div className="flex items-center gap-1.5 px-2 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
            <motion.div
              className="w-1.5 h-1.5 rounded-full bg-emerald-500"
              animate={{ opacity: [1, 0.4, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
            />
            <span className="text-[10px] text-emerald-400 font-medium">Online</span>
          </div>

          {/* Notifications */}
          <div className="relative">
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowNotifications(!showNotifications)}
              className="p-1.5 bg-[#151515] rounded-md border border-white/[0.04] relative"
            >
              <Bell className="w-4 h-4 text-gray-400" />
              {notifications.filter(n => !n.read).length > 0 && (
                <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-orange-500 rounded-full text-[8px] font-bold flex items-center justify-center text-black">
                  {notifications.filter(n => !n.read).length}
                </span>
              )}
            </motion.button>

            <AnimatePresence>
              {showNotifications && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  className="absolute top-full right-0 mt-2 w-72 bg-[#151515] rounded-xl border border-white/[0.08] shadow-2xl overflow-hidden"
                >
                  <div className="p-3 border-b border-white/[0.04] flex items-center justify-between">
                    <p className="text-xs font-semibold">Notifications</p>
                    <button className="text-[10px] text-orange-400">Mark all read</button>
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {notifications.map(notif => (
                      <div
                        key={notif.id}
                        className={`px-3 py-2.5 border-b border-white/[0.02] hover:bg-white/[0.02] cursor-pointer ${
                          !notif.read ? "bg-orange-500/5" : ""
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <div className={`w-2 h-2 rounded-full mt-1 ${
                            notif.type === "dispute" ? "bg-red-500" :
                            notif.type === "resolution" ? "bg-emerald-500" : "bg-orange-500"
                          }`} />
                          <div className="flex-1">
                            <p className="text-xs text-gray-300">{notif.message}</p>
                            <p className="text-[10px] text-gray-600 mt-0.5">{notif.time}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Profile & Wallet */}
          <div className="flex items-center gap-2 pl-2 border-l border-white/[0.08]">
            {/* Wallet indicator/button */}
            {solanaWallet.connected ? (
              <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 bg-purple-500/10 rounded-lg border border-purple-500/20">
                <Wallet className="w-3 h-3 text-purple-400" />
                <span className="text-[10px] text-purple-400">
                  {solanaWallet.walletAddress?.slice(0, 4)}...{solanaWallet.walletAddress?.slice(-4)}
                </span>
              </div>
            ) : (
              <button
                onClick={() => setShowWalletModal(true)}
                className="hidden sm:flex items-center gap-1.5 px-2 py-1 bg-purple-500/10 hover:bg-purple-500/20 rounded-lg border border-purple-500/20 transition-colors"
                title="Connect wallet for on-chain operations"
              >
                <Wallet className="w-3 h-3 text-purple-400" />
                <span className="text-[10px] text-purple-400">Connect</span>
              </button>
            )}
            <div className="w-7 h-7 rounded-full bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-sm">
              {"\u{1F6E1}\uFE0F"}
            </div>
            <div className="hidden sm:block">
              <p className="text-[11px] font-medium">{member?.name || "Agent"}</p>
              <p className="text-[9px] text-gray-500 capitalize">{member?.role}</p>
            </div>
            <button
              onClick={handleLogout}
              className="p-1.5 hover:bg-red-500/10 rounded-lg border border-transparent hover:border-red-500/20 transition-colors ml-1"
              title="Logout"
            >
              <LogOut className="w-4 h-4 text-gray-400 hover:text-red-400" />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Stats Bar - Shows on mobile only */}
      <div className="lg:hidden flex items-center gap-2 px-4 py-2 bg-[#0d0d0d] border-b border-white/[0.04] overflow-x-auto scrollbar-hide">
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-red-500/10 rounded-lg border border-red-500/20 shrink-0">
          <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
          <span className="text-xs font-bold text-red-400">{openDisputes.length}</span>
          <span className="text-[10px] text-red-400/60">open</span>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-orange-500/10 rounded-lg border border-orange-500/20 shrink-0">
          <Eye className="w-3.5 h-3.5 text-orange-400" />
          <span className="text-xs font-bold text-orange-400">{investigatingDisputes.length}</span>
          <span className="text-[10px] text-orange-400/60">active</span>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-500/10 rounded-lg border border-emerald-500/20 shrink-0">
          <Check className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-xs font-bold text-emerald-400">{resolvedDisputes.length}</span>
          <span className="text-[10px] text-emerald-400/60">resolved</span>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#151515] rounded-lg border border-white/[0.04] shrink-0">
          <Activity className="w-3.5 h-3.5 text-gray-400" />
          <span className="text-xs font-medium">${openDisputes.reduce((sum, d) => sum + d.cryptoAmount, 0).toLocaleString()}</span>
        </div>
        <div className="flex-1" />
        <button
          onClick={handleLogout}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-red-500/10 rounded-lg border border-red-500/20 shrink-0"
        >
          <LogOut className="w-3.5 h-3.5 text-red-400" />
          <span className="text-xs font-medium text-red-400">Logout</span>
        </button>
      </div>

      {/* Main Layout: Content + Sidebar */}
      <div className="flex-1 flex overflow-hidden w-full pb-16 lg:pb-0">
        {/* Main Content - Desktop Grid */}
        <main className="hidden lg:block flex-1 p-4 overflow-auto relative z-10">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">

            {/* Column 1: Open Disputes */}
            <div className="flex flex-col h-[calc(100vh-80px)]">
              <div className="flex items-center gap-2 mb-3">
                <motion.div
                  className="w-2.5 h-2.5 rounded-full bg-red-500"
                  animate={{ scale: [1, 1.3, 1], opacity: [0.5, 1, 0.5] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                />
                <span className="text-sm font-semibold">Open Disputes</span>
                <span className="ml-auto text-xs border border-red-500/30 text-red-400 px-2 py-0.5 rounded-full font-medium">
                  {openDisputes.length}
                </span>
              </div>

              <div className="flex-1 bg-[#0d0d0d] rounded-xl border border-white/[0.04] overflow-hidden min-h-0">
                <div className="h-full overflow-y-auto p-3 space-y-3">
                  <AnimatePresence mode="popLayout">
                    {openDisputes.length > 0 ? (
                      openDisputes.map((dispute, i) => (
                        <DisputeCard
                          key={dispute.id}
                          dispute={dispute}
                          reasonInfo={getDisputeReasonInfo(dispute.dispute?.reason)}
                          variant="open"
                          index={i}
                          onInvestigate={startInvestigating}
                          onChat={handleOpenDisputeChat}
                        />
                      ))
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full py-12">
                        <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mb-3">
                          <Check className="w-8 h-8 text-emerald-500/50" />
                        </div>
                        <p className="text-sm text-gray-500 font-medium">No open disputes</p>
                        <p className="text-xs text-gray-600 mt-1">All clear!</p>
                      </div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>

            {/* Column 2: Investigating */}
            <div className="flex flex-col h-[calc(100vh-80px)]">
              <div className="flex items-center gap-2 mb-3">
                <Eye className="w-4 h-4 text-orange-500" />
                <span className="text-sm font-semibold">Investigating</span>
                <span className="ml-auto text-xs bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full font-medium">
                  {investigatingDisputes.length}
                </span>
              </div>

              <div className="flex-1 bg-[#0d0d0d] rounded-xl border border-white/[0.04] overflow-hidden min-h-0">
                <div className="h-full overflow-y-auto p-3 space-y-3">
                  <AnimatePresence mode="popLayout">
                    {investigatingDisputes.length > 0 ? (
                      investigatingDisputes.map((dispute, i) => (
                        <DisputeCard
                          key={dispute.id}
                          dispute={dispute}
                          reasonInfo={getDisputeReasonInfo(dispute.dispute?.reason)}
                          variant="investigating"
                          index={i}
                          onChat={handleOpenDisputeChat}
                          onResolve={(d) => {
                            setSelectedDispute(d);
                            setShowResolveModal(true);
                          }}
                        />
                      ))
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full py-12">
                        <div className="w-16 h-16 rounded-full bg-white/[0.04] flex items-center justify-center mb-3">
                          <Search className="w-8 h-8 text-gray-600" />
                        </div>
                        <p className="text-sm text-gray-500 font-medium">No active investigations</p>
                        <p className="text-xs text-gray-600 mt-1">Pick a dispute to investigate</p>
                      </div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>

            {/* Column 3: Resolved */}
            <div className="flex flex-col h-[calc(100vh-80px)]">
              <div className="flex items-center gap-2 mb-3">
                <Check className="w-4 h-4 text-emerald-500" />
                <span className="text-sm font-semibold">Resolved</span>
                <span className="ml-auto text-xs bg-[#151515] text-gray-500 px-2 py-0.5 rounded-full font-medium border border-white/[0.04]">
                  {resolvedDisputes.length}
                </span>
              </div>

              <div className="flex-1 bg-[#0d0d0d] rounded-xl border border-white/[0.04] overflow-hidden">
                <div className="h-full overflow-y-auto p-3 space-y-3">
                  <AnimatePresence mode="popLayout">
                    {resolvedDisputes.length > 0 ? (
                      resolvedDisputes.map((dispute, i) => {
                        const resolution = dispute.dispute?.status?.replace("resolved_", "") || "";
                        const resolutionInfo = {
                          user: { icon: "\u{1F464}", label: "Favor User", color: "bg-blue-500/10 text-blue-400" },
                          merchant: { icon: "\u{1F3EA}", label: "Favor Merchant", color: "bg-purple-500/10 text-purple-400" },
                          split: { icon: "\u2696\uFE0F", label: "Split", color: "bg-orange-500/10 text-orange-400" },
                        }[resolution] || { icon: "\u2713", label: "Resolved", color: "bg-emerald-500/10 text-emerald-400" };

                        return (
                          <motion.div
                            key={dispute.id}
                            layout
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: i * 0.03 }}
                            className="p-3 bg-[#151515] rounded-xl border border-white/[0.04] hover:border-white/[0.08] transition-all opacity-75 hover:opacity-100"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-lg bg-[#1f1f1f] flex items-center justify-center text-lg">
                                {resolutionInfo.icon}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium">#{dispute.orderNumber}</span>
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${resolutionInfo.color}`}>
                                    {resolutionInfo.label}
                                  </span>
                                </div>
                                <p className="text-xs text-gray-500 mt-0.5">
                                  ${dispute.cryptoAmount.toLocaleString()} {"\u2022"} {formatTimeAgo(dispute.dispute?.resolvedAt || dispute.createdAt)}
                                </p>
                              </div>
                              <button className="p-1.5 hover:bg-white/[0.04] rounded">
                                <ExternalLink className="w-3.5 h-3.5 text-gray-500" />
                              </button>
                            </div>
                          </motion.div>
                        );
                      })
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full py-12">
                        <div className="w-16 h-16 rounded-full bg-white/[0.04] flex items-center justify-center mb-3">
                          <FileText className="w-8 h-8 text-gray-600" />
                        </div>
                        <p className="text-sm text-gray-500 font-medium">No resolved disputes</p>
                        <p className="text-xs text-gray-600 mt-1">History will appear here</p>
                      </div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>

          </div>
        </main>

        {/* Mobile Views */}
        <div className="lg:hidden flex-1 overflow-hidden">
          <main className="h-[calc(100vh-180px)] overflow-auto p-3">
            {/* Mobile: Open Disputes */}
            {mobileView === 'open' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 mb-3">
                  <motion.div
                    className="w-2.5 h-2.5 rounded-full bg-red-500"
                    animate={{ scale: [1, 1.3, 1], opacity: [0.5, 1, 0.5] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  />
                  <span className="text-sm font-semibold">Open Disputes</span>
                  <span className="ml-auto text-xs border border-red-500/30 text-red-400 px-2 py-0.5 rounded-full">
                    {openDisputes.length}
                  </span>
                </div>
                {openDisputes.length > 0 ? (
                  openDisputes.map((dispute) => {
                    const reasonInfo = getDisputeReasonInfo(dispute.dispute?.reason);
                    return (
                      <motion.div
                        key={dispute.id}
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="p-3 bg-[#151515] rounded-xl border border-red-500/20"
                      >
                        <div className="flex items-start gap-3 mb-3">
                          <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center text-lg">
                            {reasonInfo.icon}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-bold">#{dispute.orderNumber}</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                                dispute.dispute?.initiatedBy === "user"
                                  ? "bg-blue-500/20 text-blue-400"
                                  : "bg-purple-500/20 text-purple-400"
                              }`}>
                                By {dispute.dispute?.initiatedBy}
                              </span>
                            </div>
                            <p className={`text-xs ${reasonInfo.color}`}>
                              {reasonInfo.icon} {reasonInfo.label}
                            </p>
                          </div>
                          <p className="text-sm font-bold">${dispute.cryptoAmount.toLocaleString()}</p>
                        </div>
                        <div className="flex gap-2">
                          <motion.button
                            whileTap={{ scale: 0.98 }}
                            onClick={() => startInvestigating(dispute.id)}
                            className="flex-1 py-2.5 bg-orange-500/10 border border-orange-500/30 rounded-xl text-sm font-medium text-orange-400 flex items-center justify-center gap-2"
                          >
                            <Eye className="w-4 h-4" />
                            Investigate
                          </motion.button>
                          <button
                            onClick={() => { handleOpenDisputeChat(dispute); setMobileView('chat'); }}
                            className="px-4 py-2.5 border border-white/20 rounded-xl"
                          >
                            <MessageCircle className="w-4 h-4" />
                          </button>
                        </div>
                      </motion.div>
                    );
                  })
                ) : (
                  <div className="flex flex-col items-center justify-center py-12">
                    <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center mb-3">
                      <Check className="w-6 h-6 text-emerald-400" />
                    </div>
                    <p className="text-sm text-gray-500">No open disputes</p>
                  </div>
                )}
              </div>
            )}

            {/* Mobile: Investigating */}
            {mobileView === 'investigating' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 mb-3">
                  <Eye className="w-4 h-4 text-orange-500" />
                  <span className="text-sm font-semibold">Investigating</span>
                  <span className="ml-auto text-xs bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full">
                    {investigatingDisputes.length}
                  </span>
                </div>
                {investigatingDisputes.length > 0 ? (
                  investigatingDisputes.map((dispute) => {
                    const reasonInfo = getDisputeReasonInfo(dispute.dispute?.reason);
                    return (
                      <motion.div
                        key={dispute.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="p-3 bg-[#151515] rounded-xl border border-orange-500/20"
                      >
                        <div className="flex items-start gap-3 mb-3">
                          <div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center">
                            <Search className="w-5 h-5 text-orange-400" />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-bold">#{dispute.orderNumber}</span>
                              <span className="text-[10px] px-1.5 py-0.5 bg-orange-500/20 text-orange-400 rounded">
                                In Progress
                              </span>
                            </div>
                            <p className={`text-xs ${reasonInfo.color}`}>
                              {reasonInfo.icon} {reasonInfo.label}
                            </p>
                          </div>
                          <p className="text-sm font-bold">${dispute.cryptoAmount.toLocaleString()}</p>
                        </div>
                        <div className="flex gap-2">
                          <motion.button
                            whileTap={{ scale: 0.98 }}
                            onClick={() => {
                              setSelectedDispute(dispute);
                              setShowResolveModal(true);
                            }}
                            className="flex-1 py-2.5 bg-orange-500 rounded-xl text-sm font-bold text-black flex items-center justify-center gap-2"
                          >
                            <Scale className="w-4 h-4" />
                            Resolve
                          </motion.button>
                          <button
                            onClick={() => { handleOpenDisputeChat(dispute); setMobileView('chat'); }}
                            className="px-4 py-2.5 border border-white/20 rounded-xl"
                          >
                            <MessageCircle className="w-4 h-4" />
                          </button>
                        </div>
                      </motion.div>
                    );
                  })
                ) : (
                  <div className="flex flex-col items-center justify-center py-12">
                    <Eye className="w-10 h-10 text-gray-600 mb-3 opacity-30" />
                    <p className="text-sm text-gray-500">No active investigations</p>
                  </div>
                )}
              </div>
            )}

            {/* Mobile: Resolved */}
            {mobileView === 'resolved' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 mb-3">
                  <Check className="w-4 h-4 text-emerald-500" />
                  <span className="text-sm font-semibold">Resolved</span>
                  <span className="ml-auto text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full">
                    {resolvedDisputes.length}
                  </span>
                </div>
                {resolvedDisputes.length > 0 ? (
                  resolvedDisputes.map((dispute) => {
                    const resolution = dispute.dispute?.status?.replace("resolved_", "") || "";
                    return (
                      <motion.div
                        key={dispute.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="p-3 bg-[#151515] rounded-xl border border-white/[0.04]"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                            <Check className="w-5 h-5 text-emerald-400" />
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-bold">#{dispute.orderNumber}</p>
                            <p className="text-xs text-gray-500">
                              {resolution === 'user' ? 'Favor User' :
                               resolution === 'merchant' ? 'Favor Merchant' :
                               resolution === 'split' ? 'Split' : 'Resolved'}
                            </p>
                          </div>
                          <p className="text-sm font-medium text-emerald-400">
                            ${dispute.cryptoAmount.toLocaleString()}
                          </p>
                        </div>
                      </motion.div>
                    );
                  })
                ) : (
                  <div className="flex flex-col items-center justify-center py-12">
                    <FileText className="w-10 h-10 text-gray-600 mb-3 opacity-30" />
                    <p className="text-sm text-gray-500">No resolved disputes</p>
                  </div>
                )}
              </div>
            )}

            {/* Mobile: Chat View */}
            {mobileView === 'chat' && (
              <div className="h-full flex flex-col -m-3">
                {activeChat ? (
                  <>
                    {/* Chat Header */}
                    <div className="px-4 py-3 border-b border-white/[0.04] flex items-center gap-3 bg-[#0d0d0d]">
                      <button
                        onClick={() => setMobileView('open')}
                        className="p-2 hover:bg-white/[0.04] rounded-lg"
                      >
                        <ChevronLeft className="w-5 h-5 text-gray-400" />
                      </button>
                      <div className="w-10 h-10 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-lg">
                        {activeChat.emoji}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium">{activeChat.user}</p>
                        <p className="text-[10px] text-gray-500">Group Chat</p>
                      </div>
                      <button
                        onClick={() => { closeChat(activeChat.id); setActiveChatId(null); }}
                        className="p-2 hover:bg-white/[0.04] rounded-lg"
                      >
                        <X className="w-5 h-5 text-gray-500" />
                      </button>
                    </div>

                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#0a0a0a]">
                      {activeChat.messages.map((msg) => {
                        if (msg.from === "system" || msg.messageType === "system" || msg.messageType?.includes("resolution")) {
                          return (
                            <div key={msg.id} className="flex justify-center">
                              <div className="px-3 py-1.5 bg-orange-500/10 border border-orange-500/20 rounded-full text-xs text-orange-400">
                                {msg.text}
                              </div>
                            </div>
                          );
                        }
                        return (
                          <div
                            key={msg.id}
                            className={`flex ${msg.from === "me" ? "justify-end" : "justify-start"}`}
                          >
                            <div
                              className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm ${
                                msg.from === "me"
                                  ? "bg-orange-500/20 border border-orange-500/30 text-white"
                                  : msg.senderType === 'user'
                                    ? "bg-blue-500/10 border border-blue-500/20 text-gray-300"
                                    : "bg-purple-500/10 border border-purple-500/20 text-gray-300"
                              }`}
                            >
                              {msg.text}
                            </div>
                          </div>
                        );
                      })}
                      <div ref={messagesEndRef} />
                    </div>

                    {/* Quick Questions */}
                    <div className="px-3 py-2 border-t border-white/[0.04] bg-[#0d0d0d]">
                      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
                        {QUICK_QUESTIONS.map((q, i) => (
                          <button
                            key={i}
                            onClick={() => sendMessage(activeChat.id, q)}
                            className="shrink-0 px-2.5 py-1 bg-white/[0.04] border border-white/[0.08] rounded-full text-[10px] text-gray-400"
                          >
                            {q}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Input */}
                    <div className="p-3 bg-[#0d0d0d] border-t border-white/[0.04]">
                      <div className="flex gap-2">
                        <input
                          ref={(el) => { chatInputRefs.current[activeChat.id] = el; }}
                          type="text"
                          placeholder="Type a message..."
                          className="flex-1 bg-[#1f1f1f] rounded-xl px-4 py-3 outline-none text-sm"
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && e.currentTarget.value.trim()) {
                              sendMessage(activeChat.id, e.currentTarget.value);
                              e.currentTarget.value = "";
                            }
                          }}
                        />
                        <motion.button
                          whileTap={{ scale: 0.95 }}
                          onClick={() => {
                            const input = chatInputRefs.current[activeChat.id];
                            if (input && input.value.trim()) {
                              sendMessage(activeChat.id, input.value);
                              input.value = "";
                            }
                          }}
                          className="w-12 h-12 rounded-xl bg-orange-500 flex items-center justify-center"
                        >
                          <Send className="w-5 h-5 text-black" />
                        </motion.button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center py-12">
                    <MessageCircle className="w-12 h-12 text-gray-600 mb-3" />
                    <p className="text-sm text-gray-500">No active chat</p>
                    <p className="text-xs text-gray-600 mt-1">Select a dispute to start chatting</p>
                  </div>
                )}
              </div>
            )}
          </main>
        </div>

        {/* Right Sidebar - Notifications + Chat (50/50 split) */}
        <aside className="hidden lg:flex w-80 border-l border-white/[0.04] bg-[#0d0d0d]/50 flex-col">
          {/* Top Half - Notifications */}
          <div className="h-1/2 flex flex-col border-b border-white/[0.08]">
            <div className="h-12 px-4 flex items-center gap-2 border-b border-white/[0.04] shrink-0">
              <Bell className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-semibold">Notifications</span>
              {notifications.filter(n => !n.read).length > 0 && (
                <span className="ml-auto w-5 h-5 bg-red-500 rounded-full text-[10px] font-bold flex items-center justify-center text-white">
                  {notifications.filter(n => !n.read).length}
                </span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto">
              {notifications.length > 0 ? (
                <div className="p-2 space-y-1.5">
                  {notifications.map((notif) => (
                    <motion.div
                      key={notif.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className={`p-2.5 rounded-lg border transition-all cursor-pointer ${
                        notif.read
                          ? 'bg-[#151515] border-white/[0.04] opacity-60'
                          : 'bg-[#1a1a1a] border-white/[0.08] hover:border-white/[0.12]'
                      }`}
                      onClick={() => markNotificationRead(notif.id)}
                    >
                      <div className="flex items-start gap-2">
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm shrink-0 ${
                          notif.type === 'dispute' ? 'bg-red-500/20' :
                          notif.type === 'resolution' ? 'bg-emerald-500/20' :
                          notif.type === 'escalation' ? 'bg-orange-500/20' :
                          'bg-white/[0.08]'
                        }`}>
                          {notif.type === 'dispute' ? '\u26A0\uFE0F' :
                           notif.type === 'resolution' ? '\u2705' :
                           notif.type === 'escalation' ? '\u{1F525}' : '\u{1F514}'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-gray-300 leading-tight">{notif.message}</p>
                          <p className="text-[10px] text-gray-600 mt-0.5">{notif.time}</p>
                        </div>
                        {!notif.read && (
                          <div className="w-2 h-2 rounded-full bg-orange-500 shrink-0 mt-1" />
                        )}
                      </div>
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full py-8 text-gray-600">
                  <Bell className="w-8 h-8 mb-2 opacity-20" />
                  <p className="text-xs text-gray-500">No notifications</p>
                </div>
              )}
            </div>
          </div>

          {/* Bottom Half - Chat */}
          <div className="h-1/2 flex flex-col">
            {/* Chat Header */}
            <div className="h-12 px-4 flex items-center gap-2 border-b border-white/[0.04] shrink-0">
              <MessageCircle className="w-4 h-4 text-orange-400" />
              <span className="text-sm font-semibold">Dispute Chats</span>
              {totalUnread > 0 && (
                <span className="ml-auto w-5 h-5 bg-orange-500 rounded-full text-[10px] font-bold flex items-center justify-center text-black">
                  {totalUnread}
                </span>
              )}
            </div>

            {/* Chat List / Active Chat */}
            <div className="flex-1 flex flex-col min-h-0">
            {activeChat ? (
              // Active Chat View
              <>
                {/* Dispute Chat Header */}
                <div className="px-4 py-3 border-b border-white/[0.04] shrink-0">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setActiveChatId(null)}
                      className="p-1.5 hover:bg-white/[0.04] rounded-lg"
                    >
                      <ChevronLeft className="w-4 h-4 text-gray-500" />
                    </button>
                    <div className="w-9 h-9 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-lg">
                      {activeChat.emoji}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{activeChat.user}</p>
                      <p className="text-[10px] text-gray-500">Group Chat</p>
                    </div>
                    <button
                      onClick={() => { closeChat(activeChat.id); setActiveChatId(null); }}
                      className="p-1.5 hover:bg-white/[0.04] rounded-lg"
                    >
                      <X className="w-4 h-4 text-gray-500" />
                    </button>
                  </div>
                  {/* Participants - Clickable */}
                  {(() => {
                    const chatDispute = disputes.find(d => d.id === activeChat.orderId);
                    return (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-[10px] text-gray-500">Participants:</span>
                        <button
                          onClick={() => {
                            if (chatDispute) {
                              setSelectedProfile({
                                type: "user",
                                id: chatDispute.user.id,
                                name: chatDispute.user.name,
                                wallet: chatDispute.user.wallet,
                                rating: chatDispute.user.rating,
                                trades: chatDispute.user.trades,
                              });
                              setShowProfileModal(true);
                            }
                          }}
                          className="text-[10px] px-1.5 py-0.5 bg-blue-500/10 rounded text-blue-400 hover:bg-blue-500/20 transition-colors"
                        >
                          {"\u{1F464}"} {chatDispute?.user.name || "User"}
                        </button>
                        <button
                          onClick={() => {
                            if (chatDispute) {
                              setSelectedProfile({
                                type: "merchant",
                                id: chatDispute.merchant.id,
                                name: chatDispute.merchant.name,
                                wallet: chatDispute.merchant.wallet,
                                rating: chatDispute.merchant.rating,
                                trades: chatDispute.merchant.trades,
                              });
                              setShowProfileModal(true);
                            }
                          }}
                          className="text-[10px] px-1.5 py-0.5 bg-purple-500/10 rounded text-purple-400 hover:bg-purple-500/20 transition-colors"
                        >
                          {"\u{1F3EA}"} {chatDispute?.merchant.name || "Merchant"}
                        </button>
                        <span className="text-[10px] px-1.5 py-0.5 bg-orange-500/10 rounded text-orange-400">{"\u{1F6E1}\uFE0F"} You</span>
                      </div>
                    );
                  })()}
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {activeChat.messages.length === 0 && (
                    <div className="text-center py-8">
                      <div className="w-12 h-12 rounded-full bg-white/[0.04] flex items-center justify-center mx-auto mb-2">
                        <MessageCircle className="w-6 h-6 text-gray-600" />
                      </div>
                      <p className="text-xs text-gray-500">No messages yet</p>
                      <p className="text-[10px] text-gray-600 mt-1">Start the conversation</p>
                    </div>
                  )}
                  {activeChat.messages.map((msg) => {
                    // System messages
                    if (msg.from === "system" || msg.messageType === "system" || msg.messageType === "dispute" || msg.messageType === "resolution" || msg.messageType === "resolution_proposed" || msg.messageType === "resolution_rejected" || msg.messageType === "resolution_accepted" || msg.messageType === "resolution_finalized") {
                      return (
                        <div key={msg.id} className="flex justify-center">
                          <div className="px-3 py-1.5 bg-orange-500/10 border border-orange-500/20 rounded-full text-xs text-orange-400">
                            {(() => {
                              try {
                                const data = JSON.parse(msg.text);
                                if (data.type === 'dispute_opened') return `\u{1F6A8} ${data.reason}`;
                                if (data.type === 'resolution_proposed') return `\u2696\uFE0F Resolution proposed: ${data.resolution}`;
                                if (data.type === 'resolution_rejected') return `\u274C Resolution rejected`;
                                if (data.type === 'resolution_accepted') return `\u2705 Resolution accepted by ${data.party}`;
                                if (data.type === 'resolution_finalized') return `\u{1F389} Dispute resolved!`;
                                return msg.text;
                              } catch {
                                return msg.text;
                              }
                            })()}
                          </div>
                        </div>
                      );
                    }
                    // Get sender info for display
                    const senderColor = msg.senderType === 'user' ? 'text-blue-400' :
                                       msg.senderType === 'merchant' ? 'text-purple-400' :
                                       msg.senderType === 'compliance' ? 'text-orange-400' : 'text-gray-400';
                    const senderLabel = msg.senderName || (msg.senderType === 'user' ? 'User' : msg.senderType === 'merchant' ? 'Merchant' : 'Compliance');

                    // Regular messages with sender name
                    return (
                      <div
                        key={msg.id}
                        className={`flex ${msg.from === "me" ? "justify-end" : "justify-start"}`}
                      >
                        <div className={`max-w-[85%] ${msg.from === "me" ? "text-right" : "text-left"}`}>
                          {/* Sender name */}
                          {msg.from !== "me" && (
                            <p className={`text-[10px] ${senderColor} mb-1 px-1`}>
                              {msg.senderType === 'user' ? '\u{1F464}' : msg.senderType === 'merchant' ? '\u{1F3EA}' : '\u{1F6E1}\uFE0F'} {senderLabel}
                            </p>
                          )}
                          <div
                            className={`px-3 py-2 rounded-xl text-sm inline-block ${
                              msg.from === "me"
                                ? "bg-orange-500/20 border border-orange-500/30 text-white"
                                : msg.senderType === 'user'
                                  ? "bg-blue-500/10 border border-blue-500/20 text-gray-300"
                                  : "bg-purple-500/10 border border-purple-500/20 text-gray-300"
                            }`}
                          >
                            {msg.text}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {activeChat.isTyping && (
                    <div className="flex justify-start">
                      <div className="bg-[#1f1f1f] px-3 py-2 rounded-xl flex items-center gap-1">
                        <motion.span className="w-1.5 h-1.5 bg-gray-400 rounded-full" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity, delay: 0 }} />
                        <motion.span className="w-1.5 h-1.5 bg-gray-400 rounded-full" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity, delay: 0.2 }} />
                        <motion.span className="w-1.5 h-1.5 bg-gray-400 rounded-full" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity, delay: 0.4 }} />
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Quick Questions */}
                <div className="px-3 py-2 border-t border-white/[0.04] shrink-0">
                  <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
                    {QUICK_QUESTIONS.map((q, i) => (
                      <button
                        key={i}
                        onClick={() => {
                          sendMessage(activeChat.id, q);
                        }}
                        className="shrink-0 px-2.5 py-1 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] rounded-full text-[10px] text-gray-400 hover:text-white transition-all"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Input */}
                <div className="p-3 border-t border-white/[0.04] shrink-0">
                  <div className="flex gap-2">
                    <input
                      ref={(el) => { chatInputRefs.current[activeChat.id] = el; }}
                      type="text"
                      placeholder="Type a message..."
                      className="flex-1 bg-[#1f1f1f] rounded-xl px-4 py-2.5 outline-none text-sm placeholder:text-gray-600 focus:ring-1 focus:ring-orange-500/30"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && e.currentTarget.value.trim()) {
                          sendMessage(activeChat.id, e.currentTarget.value);
                          e.currentTarget.value = "";
                        }
                      }}
                    />
                    <motion.button
                      whileTap={{ scale: 0.9 }}
                      onClick={() => {
                        const input = chatInputRefs.current[activeChat.id];
                        if (input && input.value.trim()) {
                          sendMessage(activeChat.id, input.value);
                          input.value = "";
                        }
                      }}
                      className="w-10 h-10 rounded-xl bg-orange-500 hover:bg-orange-400 flex items-center justify-center transition-colors"
                    >
                      <Send className="w-4 h-4 text-black" />
                    </motion.button>
                  </div>
                </div>
              </>
            ) : (
              // Chat List View
              <div className="flex-1 overflow-y-auto">
                {chatWindows.length > 0 ? (
                  chatWindows.map((chat) => (
                    <motion.button
                      key={chat.id}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setActiveChatId(chat.id)}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] border-b border-white/[0.02] text-left transition-all"
                    >
                      <div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center text-lg">
                        {chat.emoji}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{chat.user}</p>
                        <p className="text-xs text-gray-500 truncate">
                          {chat.messages[chat.messages.length - 1]?.text || "No messages yet"}
                        </p>
                      </div>
                      {chat.unread > 0 && (
                        <span className="w-5 h-5 bg-orange-500 rounded-full text-[10px] font-bold flex items-center justify-center text-black">
                          {chat.unread}
                        </span>
                      )}
                    </motion.button>
                  ))
                ) : (
                  <div className="flex flex-col items-center justify-center h-full py-12">
                    <div className="w-16 h-16 rounded-full bg-white/[0.04] flex items-center justify-center mb-3">
                      <MessageCircle className="w-8 h-8 text-gray-600" />
                    </div>
                    <p className="text-sm text-gray-500 font-medium">No active chats</p>
                    <p className="text-xs text-gray-600 mt-1">Open a dispute to start chatting</p>
                  </div>
                )}
              </div>
            )}
          </div>
          </div>
        </aside>
      </div>

      {/* Resolve Modal */}
      <ResolveModal
        showResolveModal={showResolveModal}
        selectedDispute={selectedDispute}
        resolveForm={resolveForm}
        setResolveForm={setResolveForm}
        isProcessingOnChain={isProcessingOnChain}
        walletConnected={solanaWallet.connected}
        walletAddress={solanaWallet.walletAddress}
        memberWalletAddress={member?.wallet_address}
        onResolve={resolveDispute}
        onFinalize={finalizeDispute}
        onClose={() => setShowResolveModal(false)}
      />

      {/* Profile Modal */}
      <AnimatePresence>
        {showProfileModal && selectedProfile && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50"
              onClick={() => setShowProfileModal(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-sm"
            >
              <div className="bg-[#151515] rounded-2xl border border-white/[0.08] shadow-2xl overflow-hidden">
                {/* Header */}
                <div className={`px-6 py-5 border-b border-white/[0.04] ${
                  selectedProfile.type === "user" ? "bg-blue-500/5" : "bg-purple-500/5"
                }`}>
                  <div className="flex items-center gap-4">
                    <div className={`w-14 h-14 rounded-xl ${
                      selectedProfile.type === "user" ? "bg-blue-500/10 border-blue-500/20" : "bg-purple-500/10 border-purple-500/20"
                    } border flex items-center justify-center text-2xl`}>
                      {getEmoji(selectedProfile.name)}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h2 className="text-lg font-bold">{selectedProfile.name}</h2>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                          selectedProfile.type === "user" ? "bg-blue-500/20 text-blue-400" : "bg-purple-500/20 text-purple-400"
                        }`}>
                          {selectedProfile.type === "user" ? "User" : "Merchant"}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1 font-mono">
                        {selectedProfile.wallet.slice(0, 6)}...{selectedProfile.wallet.slice(-4)}
                      </p>
                    </div>
                    <button
                      onClick={() => setShowProfileModal(false)}
                      className="p-2 hover:bg-white/[0.04] rounded-lg transition-colors"
                    >
                      <X className="w-5 h-5 text-gray-500" />
                    </button>
                  </div>
                </div>

                {/* Stats Grid */}
                <div className="p-6 grid grid-cols-2 gap-4">
                  <div className="p-4 bg-[#1a1a1a] rounded-xl">
                    <div className="flex items-center gap-2 mb-2">
                      <Activity className="w-4 h-4 text-gray-500" />
                      <span className="text-xs text-gray-500">Total Trades</span>
                    </div>
                    <p className="text-2xl font-bold">{selectedProfile.trades}</p>
                  </div>
                  <div className="p-4 bg-[#1a1a1a] rounded-xl">
                    <div className="flex items-center gap-2 mb-2">
                      <UserCheck className="w-4 h-4 text-gray-500" />
                      <span className="text-xs text-gray-500">Rating</span>
                    </div>
                    <p className="text-2xl font-bold flex items-center gap-1">
                      {selectedProfile.rating.toFixed(1)}
                      <span className="text-sm text-yellow-500">{"\u2605"}</span>
                    </p>
                  </div>
                  <div className="p-4 bg-[#1a1a1a] rounded-xl">
                    <div className="flex items-center gap-2 mb-2">
                      <Check className="w-4 h-4 text-emerald-500" />
                      <span className="text-xs text-gray-500">Success Rate</span>
                    </div>
                    <p className="text-2xl font-bold text-emerald-400">
                      {selectedProfile.trades > 0 ? Math.min(100, Math.round(95 + Math.random() * 5)) : 0}%
                    </p>
                  </div>
                  <div className="p-4 bg-[#1a1a1a] rounded-xl">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className="w-4 h-4 text-red-500" />
                      <span className="text-xs text-gray-500">Disputes</span>
                    </div>
                    <p className="text-2xl font-bold text-red-400">
                      {Math.floor(selectedProfile.trades * 0.02)}
                    </p>
                  </div>
                </div>

                {/* Trade History Preview */}
                <div className="px-6 pb-6">
                  <div className="p-4 bg-[#1a1a1a] rounded-xl">
                    <p className="text-xs text-gray-500 mb-3">Recent Activity</p>
                    <div className="space-y-2">
                      {[
                        { action: "Completed trade", amount: "$250", time: "2h ago", success: true },
                        { action: "Completed trade", amount: "$1,200", time: "5h ago", success: true },
                        { action: "Dispute resolved", amount: "$500", time: "1d ago", success: false },
                      ].map((item, i) => (
                        <div key={i} className="flex items-center gap-3 text-xs">
                          <div className={`w-2 h-2 rounded-full ${item.success ? "bg-emerald-500" : "bg-red-500"}`} />
                          <span className="flex-1 text-gray-400">{item.action}</span>
                          <span className="font-medium">{item.amount}</span>
                          <span className="text-gray-600">{item.time}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div className="px-6 pb-6">
                  <button
                    onClick={() => setShowProfileModal(false)}
                    className="w-full py-3 rounded-xl text-sm font-medium bg-white/[0.04] hover:bg-white/[0.08] transition-colors"
                  >
                    Close
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Mobile Bottom Navigation */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 bg-[#0a0a0a] border-t border-white/[0.04] px-2 py-2 pb-safe z-50">
        <div className="flex items-center justify-around">
          <button
            onClick={() => setMobileView('open')}
            className={`flex flex-col items-center gap-1 px-4 py-2 rounded-xl transition-all ${
              mobileView === 'open' ? 'bg-white/[0.08]' : ''
            }`}
          >
            <div className="relative">
              <AlertTriangle className={`w-5 h-5 ${mobileView === 'open' ? 'text-red-400' : 'text-gray-500'}`} />
              {openDisputes.length > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                  {openDisputes.length}
                </span>
              )}
            </div>
            <span className={`text-[10px] ${mobileView === 'open' ? 'text-white' : 'text-gray-500'}`}>Open</span>
          </button>

          <button
            onClick={() => setMobileView('investigating')}
            className={`flex flex-col items-center gap-1 px-4 py-2 rounded-xl transition-all ${
              mobileView === 'investigating' ? 'bg-white/[0.08]' : ''
            }`}
          >
            <div className="relative">
              <Eye className={`w-5 h-5 ${mobileView === 'investigating' ? 'text-orange-400' : 'text-gray-500'}`} />
              {investigatingDisputes.length > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-orange-500 text-black text-[10px] font-bold rounded-full flex items-center justify-center">
                  {investigatingDisputes.length}
                </span>
              )}
            </div>
            <span className={`text-[10px] ${mobileView === 'investigating' ? 'text-white' : 'text-gray-500'}`}>Active</span>
          </button>

          <button
            onClick={() => setMobileView('chat')}
            className={`flex flex-col items-center gap-1 px-4 py-2 rounded-xl transition-all ${
              mobileView === 'chat' ? 'bg-white/[0.08]' : ''
            }`}
          >
            <div className="relative">
              <MessageCircle className={`w-5 h-5 ${mobileView === 'chat' ? 'text-orange-400' : 'text-gray-500'}`} />
              {totalUnread > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-orange-500 text-black text-[10px] font-bold rounded-full flex items-center justify-center">
                  {totalUnread}
                </span>
              )}
            </div>
            <span className={`text-[10px] ${mobileView === 'chat' ? 'text-white' : 'text-gray-500'}`}>Chat</span>
          </button>

          <button
            onClick={() => setMobileView('resolved')}
            className={`flex flex-col items-center gap-1 px-4 py-2 rounded-xl transition-all ${
              mobileView === 'resolved' ? 'bg-white/[0.08]' : ''
            }`}
          >
            <Check className={`w-5 h-5 ${mobileView === 'resolved' ? 'text-emerald-400' : 'text-gray-500'}`} />
            <span className={`text-[10px] ${mobileView === 'resolved' ? 'text-white' : 'text-gray-500'}`}>Done</span>
          </button>
        </div>
      </nav>

      {/* PWA Install Banner */}
      <PWAInstallBanner appName="Compliance" accentColor="#f97316" />

      {/* Wallet Modal - for connecting wallet after login */}
      {showWalletModal && (
        <ComplianceWalletModal
          isOpen={showWalletModal}
          onClose={() => setShowWalletModal(false)}
        />
      )}
    </div>
  );
}
