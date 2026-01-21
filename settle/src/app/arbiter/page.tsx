"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Scale,
  Shield,
  Trophy,
  Star,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Users,
  Wallet,
  TrendingUp,
  Award,
  ChevronRight,
  Send,
  Loader2,
  LogOut,
  Eye,
} from "lucide-react";
import Link from "next/link";
import dynamic from "next/dynamic";

// Dynamically import wallet
const useSolanaWalletHook = () => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useSolanaWallet } = require("@/context/SolanaWalletContext");
    return useSolanaWallet();
  } catch {
    return {
      connected: false,
      walletAddress: null,
      openWalletModal: () => {},
    };
  }
};

const WalletModal = dynamic(() => import("@/components/MerchantWalletModal"), { ssr: false });

interface Arbiter {
  id: string;
  user_id: string;
  wallet_address: string;
  reputation_score: number;
  total_trades: number;
  successful_arbitrations: number;
  total_arbitrations: number;
  accuracy_rate: number;
  staked_amount: number;
  is_active: boolean;
  is_eligible: boolean;
  cooldown_until: string | null;
}

interface PendingVote {
  id: string;
  arbitration_id: string;
  order_id: string;
  vote_weight: number;
  deadline: string;
  dispute?: {
    reason: string;
    description: string;
    crypto_amount: number;
  };
}

interface VoteHistory {
  id: string;
  arbitration_id: string;
  order_id: string;
  vote: string;
  reasoning: string;
  voted_at: string;
  matched_majority: boolean | null;
  final_decision: string;
  arbitration_status: string;
}

interface LeaderboardEntry {
  id: string;
  wallet_address: string;
  reputation_score: number;
  accuracy_rate: number;
  total_arbitrations: number;
  successful_arbitrations: number;
}

export default function ArbiterDashboard() {
  const [isLoading, setIsLoading] = useState(true);
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [arbiter, setArbiter] = useState<Arbiter | null>(null);
  const [pendingVotes, setPendingVotes] = useState<PendingVote[]>([]);
  const [voteHistory, setVoteHistory] = useState<VoteHistory[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [activeTab, setActiveTab] = useState<'pending' | 'history' | 'leaderboard'>('pending');

  // Vote modal
  const [showVoteModal, setShowVoteModal] = useState(false);
  const [selectedVote, setSelectedVote] = useState<PendingVote | null>(null);
  const [voteForm, setVoteForm] = useState({
    vote: '' as '' | 'user' | 'merchant' | 'split',
    reasoning: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Eligibility check
  const [eligibility, setEligibility] = useState<{
    eligible: boolean;
    reasons: string[];
    currentStats: {
      trades: number;
      rating: number;
      accountAge: number;
      reputation: number;
    };
  } | null>(null);

  const solanaWallet = useSolanaWalletHook();

  // Fetch arbiter data
  const fetchArbiterData = useCallback(async () => {
    if (!solanaWallet.connected || !solanaWallet.walletAddress) return;

    try {
      // First check if user exists with this wallet
      // For now, we'll use a simple check
      const arbiterRes = await fetch(`/api/arbiters?wallet_address=${solanaWallet.walletAddress}`);

      if (arbiterRes.ok) {
        const data = await arbiterRes.json();
        if (data.success && data.data?.id) {
          setArbiter(data.data);

          // Fetch pending votes
          const votesRes = await fetch(`/api/arbiters/${data.data.id}/votes`);
          if (votesRes.ok) {
            const votesData = await votesRes.json();
            if (votesData.success) {
              setPendingVotes(votesData.data.pending || []);
              setVoteHistory(votesData.data.history || []);
            }
          }
        }
      }

      // Fetch leaderboard
      const leaderboardRes = await fetch('/api/arbiters?action=leaderboard&limit=10');
      if (leaderboardRes.ok) {
        const lbData = await leaderboardRes.json();
        if (lbData.success) {
          setLeaderboard(lbData.data || []);
        }
      }
    } catch (error) {
      console.error('Failed to fetch arbiter data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [solanaWallet.connected, solanaWallet.walletAddress]);

  useEffect(() => {
    if (solanaWallet.connected) {
      fetchArbiterData();
    } else {
      setIsLoading(false);
    }
  }, [solanaWallet.connected, fetchArbiterData]);

  // Submit vote
  const handleSubmitVote = async () => {
    if (!selectedVote || !voteForm.vote || !arbiter) return;

    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/arbiters/${arbiter.id}/votes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          arbitration_id: selectedVote.arbitration_id,
          vote: voteForm.vote,
          reasoning: voteForm.reasoning,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setShowVoteModal(false);
        setSelectedVote(null);
        setVoteForm({ vote: '', reasoning: '' });
        fetchArbiterData(); // Refresh
      } else {
        alert(data.error || 'Failed to submit vote');
      }
    } catch (error) {
      console.error('Vote submission error:', error);
      alert('Failed to submit vote');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Format time remaining
  const formatTimeRemaining = (deadline: string) => {
    const diff = new Date(deadline).getTime() - Date.now();
    if (diff <= 0) return 'Expired';

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 24) {
      return `${Math.floor(hours / 24)}d ${hours % 24}h`;
    }
    return `${hours}h ${minutes}m`;
  };

  // Not connected state
  if (!solanaWallet.connected) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center p-4">
        <div className="w-full max-w-sm text-center">
          <div className="w-20 h-20 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mx-auto mb-6">
            <Scale className="w-10 h-10 text-purple-400" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Arbiter Portal</h1>
          <p className="text-gray-500 mb-8">
            Resolve disputes and earn rewards based on your reputation
          </p>

          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowWalletModal(true)}
            className="w-full py-4 rounded-xl text-sm font-bold bg-purple-600 text-white hover:bg-purple-500 transition-colors flex items-center justify-center gap-2"
          >
            <Wallet className="w-5 h-5" />
            Connect Wallet
          </motion.button>

          <div className="mt-8 p-4 bg-white/[0.02] rounded-xl border border-white/[0.04]">
            <h3 className="text-sm font-semibold mb-3">Requirements to become an Arbiter:</h3>
            <ul className="text-xs text-gray-500 space-y-2 text-left">
              <li className="flex items-center gap-2">
                <CheckCircle className="w-3 h-3 text-emerald-400" />
                Minimum 10 completed trades
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle className="w-3 h-3 text-emerald-400" />
                Account at least 30 days old
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle className="w-3 h-3 text-emerald-400" />
                4.0+ average rating
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle className="w-3 h-3 text-emerald-400" />
                100+ reputation score
              </li>
            </ul>
          </div>

          <Link
            href="/"
            className="inline-block mt-6 text-sm text-gray-500 hover:text-white transition-colors"
          >
            Back to Trading
          </Link>
        </div>

        {showWalletModal && (
          <WalletModal isOpen={showWalletModal} onClose={() => setShowWalletModal(false)} />
        )}
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
      </div>
    );
  }

  // Not an arbiter yet
  if (!arbiter) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center p-4">
        <div className="w-full max-w-sm text-center">
          <div className="w-20 h-20 rounded-2xl bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center mx-auto mb-6">
            <AlertTriangle className="w-10 h-10 text-yellow-400" />
          </div>
          <h1 className="text-xl font-bold mb-2">Not Registered as Arbiter</h1>
          <p className="text-gray-500 mb-6">
            You need to register and meet the requirements to become an arbiter.
          </p>

          <div className="p-4 bg-white/[0.02] rounded-xl border border-white/[0.04] mb-6">
            <p className="text-xs text-gray-500 mb-3">Connected Wallet:</p>
            <p className="text-sm font-mono">
              {solanaWallet.walletAddress?.slice(0, 8)}...{solanaWallet.walletAddress?.slice(-8)}
            </p>
          </div>

          <Link
            href="/"
            className="inline-block py-3 px-6 rounded-xl bg-purple-600 text-white font-semibold hover:bg-purple-500 transition-colors"
          >
            Start Trading to Build Reputation
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#0a0a0a]/90 backdrop-blur-xl border-b border-white/[0.04]">
        <div className="px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
              <Scale className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <h1 className="text-sm font-bold">Arbiter Portal</h1>
              <p className="text-[10px] text-gray-500">Dispute Resolution</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="px-3 py-1.5 bg-purple-500/10 rounded-lg border border-purple-500/20">
              <p className="text-[10px] text-gray-500">Reputation</p>
              <p className="text-sm font-bold text-purple-400">{arbiter.reputation_score}</p>
            </div>
            <Link href="/" className="p-2 hover:bg-white/[0.05] rounded-lg transition-colors">
              <LogOut className="w-4 h-4 text-gray-400" />
            </Link>
          </div>
        </div>
      </header>

      {/* Stats */}
      <div className="p-4 grid grid-cols-4 gap-2">
        <div className="p-3 bg-white/[0.02] rounded-xl border border-white/[0.04]">
          <Trophy className="w-4 h-4 text-yellow-400 mb-1" />
          <p className="text-lg font-bold">{arbiter.successful_arbitrations}</p>
          <p className="text-[10px] text-gray-500">Won</p>
        </div>
        <div className="p-3 bg-white/[0.02] rounded-xl border border-white/[0.04]">
          <Scale className="w-4 h-4 text-blue-400 mb-1" />
          <p className="text-lg font-bold">{arbiter.total_arbitrations}</p>
          <p className="text-[10px] text-gray-500">Total</p>
        </div>
        <div className="p-3 bg-white/[0.02] rounded-xl border border-white/[0.04]">
          <TrendingUp className="w-4 h-4 text-emerald-400 mb-1" />
          <p className="text-lg font-bold">{arbiter.accuracy_rate.toFixed(0)}%</p>
          <p className="text-[10px] text-gray-500">Accuracy</p>
        </div>
        <div className="p-3 bg-white/[0.02] rounded-xl border border-white/[0.04]">
          <Star className="w-4 h-4 text-purple-400 mb-1" />
          <p className="text-lg font-bold">{arbiter.total_trades}</p>
          <p className="text-[10px] text-gray-500">Trades</p>
        </div>
      </div>

      {/* Cooldown Warning */}
      {arbiter.cooldown_until && new Date(arbiter.cooldown_until) > new Date() && (
        <div className="mx-4 mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
          <div className="flex items-center gap-2 text-red-400">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-sm font-semibold">On Cooldown</span>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            You cannot participate in arbitrations until {new Date(arbiter.cooldown_until).toLocaleDateString()}
          </p>
        </div>
      )}

      {/* Tabs */}
      <div className="px-4 flex gap-2 mb-4">
        {(['pending', 'history', 'leaderboard'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab
                ? 'bg-purple-500 text-white'
                : 'bg-white/[0.02] text-gray-400 hover:bg-white/[0.05]'
            }`}
          >
            {tab === 'pending' && `Pending (${pendingVotes.length})`}
            {tab === 'history' && 'History'}
            {tab === 'leaderboard' && 'Leaderboard'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="px-4 pb-20">
        {/* Pending Votes */}
        {activeTab === 'pending' && (
          <div className="space-y-3">
            {pendingVotes.length === 0 ? (
              <div className="text-center py-12">
                <CheckCircle className="w-12 h-12 text-emerald-400 mx-auto mb-4" />
                <p className="text-gray-400">No pending votes</p>
                <p className="text-xs text-gray-600 mt-1">Check back later for new disputes</p>
              </div>
            ) : (
              pendingVotes.map((vote) => (
                <motion.div
                  key={vote.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-4 bg-white/[0.02] rounded-xl border border-white/[0.04]"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="text-sm font-semibold">Dispute #{vote.order_id.slice(0, 8)}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Clock className="w-3 h-3 text-orange-400" />
                        <span className="text-xs text-orange-400">
                          {formatTimeRemaining(vote.deadline)} remaining
                        </span>
                      </div>
                    </div>
                    <div className="px-2 py-1 bg-purple-500/10 rounded text-xs text-purple-400">
                      Weight: {vote.vote_weight}x
                    </div>
                  </div>

                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={() => {
                      setSelectedVote(vote);
                      setShowVoteModal(true);
                    }}
                    className="w-full py-2.5 bg-purple-600 hover:bg-purple-500 rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-2"
                  >
                    <Eye className="w-4 h-4" />
                    Review & Vote
                  </motion.button>
                </motion.div>
              ))
            )}
          </div>
        )}

        {/* Vote History */}
        {activeTab === 'history' && (
          <div className="space-y-2">
            {voteHistory.length === 0 ? (
              <div className="text-center py-12">
                <Scale className="w-12 h-12 text-gray-600 mx-auto mb-4" />
                <p className="text-gray-400">No vote history yet</p>
              </div>
            ) : (
              voteHistory.map((vote) => (
                <div
                  key={vote.id}
                  className="p-3 bg-white/[0.02] rounded-xl border border-white/[0.04] flex items-center gap-3"
                >
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    vote.matched_majority === true
                      ? 'bg-emerald-500/10 text-emerald-400'
                      : vote.matched_majority === false
                      ? 'bg-red-500/10 text-red-400'
                      : 'bg-gray-500/10 text-gray-400'
                  }`}>
                    {vote.matched_majority === true ? (
                      <CheckCircle className="w-5 h-5" />
                    ) : vote.matched_majority === false ? (
                      <XCircle className="w-5 h-5" />
                    ) : (
                      <Clock className="w-5 h-5" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">#{vote.order_id.slice(0, 8)}</p>
                    <p className="text-xs text-gray-500">
                      Voted: <span className="capitalize">{vote.vote}</span>
                      {vote.final_decision && ` → Decision: ${vote.final_decision}`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`text-xs font-semibold ${
                      vote.matched_majority === true ? 'text-emerald-400' :
                      vote.matched_majority === false ? 'text-red-400' : 'text-gray-400'
                    }`}>
                      {vote.matched_majority === true ? '+10 REP' :
                       vote.matched_majority === false ? '-5 REP' : 'Pending'}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Leaderboard */}
        {activeTab === 'leaderboard' && (
          <div className="space-y-2">
            {leaderboard.map((entry, index) => (
              <div
                key={entry.id}
                className={`p-3 rounded-xl border flex items-center gap-3 ${
                  entry.wallet_address === solanaWallet.walletAddress
                    ? 'bg-purple-500/10 border-purple-500/20'
                    : 'bg-white/[0.02] border-white/[0.04]'
                }`}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${
                  index === 0 ? 'bg-yellow-500/20 text-yellow-400' :
                  index === 1 ? 'bg-gray-400/20 text-gray-300' :
                  index === 2 ? 'bg-orange-500/20 text-orange-400' :
                  'bg-white/[0.05] text-gray-500'
                }`}>
                  {index + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium font-mono">
                    {entry.wallet_address.slice(0, 4)}...{entry.wallet_address.slice(-4)}
                    {entry.wallet_address === solanaWallet.walletAddress && (
                      <span className="text-purple-400 ml-2">(You)</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500">
                    {entry.total_arbitrations} cases • {entry.accuracy_rate.toFixed(0)}% accuracy
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-purple-400">{entry.reputation_score}</p>
                  <p className="text-[10px] text-gray-500">REP</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Vote Modal */}
      <AnimatePresence>
        {showVoteModal && selectedVote && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowVoteModal(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
            />
            <motion.div
              initial={{ opacity: 0, y: 100 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 100 }}
              className="fixed bottom-0 left-0 right-0 bg-[#0d0d0d] rounded-t-3xl border-t border-white/[0.04] z-50 max-h-[90vh] overflow-y-auto"
            >
              <div className="p-6">
                <div className="w-12 h-1 bg-white/10 rounded-full mx-auto mb-6" />

                <h2 className="text-lg font-bold mb-4">Cast Your Vote</h2>

                <div className="p-4 bg-white/[0.02] rounded-xl border border-white/[0.04] mb-6">
                  <p className="text-sm text-gray-400 mb-2">Dispute #{selectedVote.order_id.slice(0, 8)}</p>
                  <p className="text-xs text-gray-500">
                    Review the evidence in the dispute chat before voting.
                    Your vote weight is <span className="text-purple-400 font-semibold">{selectedVote.vote_weight}x</span>
                  </p>
                </div>

                {/* Vote Options */}
                <div className="space-y-2 mb-6">
                  <p className="text-sm font-semibold mb-3">Your Decision:</p>
                  {(['user', 'merchant', 'split'] as const).map((option) => (
                    <button
                      key={option}
                      onClick={() => setVoteForm(prev => ({ ...prev, vote: option }))}
                      className={`w-full p-4 rounded-xl border text-left transition-all ${
                        voteForm.vote === option
                          ? 'bg-purple-500/10 border-purple-500/30'
                          : 'bg-white/[0.02] border-white/[0.04] hover:bg-white/[0.05]'
                      }`}
                    >
                      <p className="text-sm font-semibold capitalize">{option === 'user' ? 'Favor User' : option === 'merchant' ? 'Favor Merchant' : 'Split 50/50'}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        {option === 'user' && 'Release escrow to the user'}
                        {option === 'merchant' && 'Refund escrow to the merchant'}
                        {option === 'split' && 'Split the escrowed amount equally'}
                      </p>
                    </button>
                  ))}
                </div>

                {/* Reasoning */}
                <div className="mb-6">
                  <label className="text-sm font-semibold block mb-2">
                    Reasoning (min. 50 characters)
                  </label>
                  <textarea
                    value={voteForm.reasoning}
                    onChange={(e) => setVoteForm(prev => ({ ...prev, reasoning: e.target.value }))}
                    placeholder="Explain your decision based on the evidence..."
                    className="w-full h-32 bg-white/[0.02] border border-white/[0.04] rounded-xl p-3 text-sm resize-none outline-none focus:border-purple-500/30"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    {voteForm.reasoning.length}/50 characters
                  </p>
                </div>

                {/* Submit */}
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={handleSubmitVote}
                  disabled={!voteForm.vote || voteForm.reasoning.length < 50 || isSubmitting}
                  className="w-full py-4 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      Submit Vote
                    </>
                  )}
                </motion.button>

                <p className="text-xs text-gray-500 text-center mt-3">
                  Votes cannot be changed once submitted
                </p>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
