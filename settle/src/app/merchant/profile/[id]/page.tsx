'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Shield, Star, ArrowLeft, Loader2, CheckCircle2, TrendingUp, Award, Tag, History, MessageSquare } from 'lucide-react';

const TIER_COLORS: Record<string, { text: string; bg: string; border: string }> = {
  newcomer: { text: 'text-white/50', bg: 'bg-white/[0.04]', border: 'border-white/[0.08]' },
  bronze: { text: 'text-orange-700', bg: 'bg-orange-900/10', border: 'border-orange-800/20' },
  silver: { text: 'text-gray-300', bg: 'bg-gray-500/10', border: 'border-gray-500/20' },
  gold: { text: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' },
  platinum: { text: 'text-blue-200', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
  diamond: { text: 'text-cyan-300', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20' },
};

const BADGE_ICONS: Record<string, string> = {
  fast_trader: '⚡', high_volume: '📈', trusted: '🛡️', veteran: '🎖️',
  perfect_rating: '⭐', dispute_free: '✅', consistent: '📊',
  whale: '🐋', early_adopter: '🚀', arbiter_approved: '⚖️',
};

function formatAmount(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

function formatRelativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return '1d ago';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

interface PublicOrder {
  id: string;
  type: 'buy' | 'sell';
  payment_method: string;
  fiat_amount: number;
  fiat_currency: string;
  created_at: string;
  completed_at: string;
}

interface PublicReview {
  id: string;
  rating: number;
  review_text: string;
  rater_type: 'merchant' | 'user';
  created_at: string;
}

interface PublicOffer {
  id: string;
  type: 'buy' | 'sell';
  payment_method: string;
  rate: number;
  min_amount: number;
  max_amount: number;
  available_amount: number;
  bank_name: string | null;
}

interface ProfileData {
  merchant: {
    id: string;
    display_name: string;
    username: string;
    avatar_url: string | null;
    bio: string | null;
    rating: number;
    rating_count: number;
    total_trades: number;
    total_volume: number;
    is_online: boolean;
    created_at: string;
  };
  reputation: {
    score: {
      total_score: number;
      review_score: number;
      execution_score: number;
      volume_score: number;
      consistency_score: number;
      trust_score: number;
      tier: string;
      badges: string[];
    };
    breakdown: {
      execution: { completion_rate: number; avg_completion_time_mins: number; completed_orders: number };
      volume: { total_volume_usd: number };
      trust: { disputes_raised: number; disputes_lost: number };
    };
    tierInfo: { name: string; color: string; description: string };
    progress: { currentTier: string; nextTier: string | null; progress: number };
    rank: number | null;
  } | null;
  publicStats: {
    recentOrders: PublicOrder[];
    reviews: PublicReview[];
    activeOffers: PublicOffer[];
  } | null;
}

export default function MerchantProfilePage() {
  const params = useParams();
  const router = useRouter();
  const merchantId = params.id as string;
  const [data, setData] = useState<ProfileData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!merchantId) return;

    Promise.all([
      fetch(`/api/merchant/${merchantId}`).then(r => r.json()),
      fetch(`/api/reputation?entityId=${merchantId}&entityType=merchant`).then(r => r.json()),
      fetch(`/api/merchant/${merchantId}/public-stats`).then(r => r.json()),
    ])
      .then(([merchantRes, repRes, statsRes]) => {
        if (!merchantRes.success) {
          setError('Merchant not found');
          return;
        }
        setData({
          merchant: merchantRes.data,
          reputation: repRes.success ? repRes.data : null,
          publicStats: statsRes.success ? statsRes.data : null,
        });
      })
      .catch(() => setError('Failed to load profile'))
      .finally(() => setIsLoading(false));
  }, [merchantId]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#060606] flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-orange-400/40 animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-[#060606] flex flex-col items-center justify-center gap-4">
        <p className="text-white/40">{error || 'Profile not found'}</p>
        <button onClick={() => router.back()} className="text-orange-400 text-sm hover:underline">Go back</button>
      </div>
    );
  }

  const { merchant, reputation, publicStats } = data;
  const tier = reputation?.score.tier || 'newcomer';
  const tierStyle = TIER_COLORS[tier] || TIER_COLORS.newcomer;
  const accountAge = Math.floor((Date.now() - new Date(merchant.created_at).getTime()) / 86400000);

  const scoreComponents = reputation ? [
    { label: 'Review', score: reputation.score.review_score, weight: 30 },
    { label: 'Execution', score: reputation.score.execution_score, weight: 25 },
    { label: 'Volume', score: reputation.score.volume_score, weight: 15 },
    { label: 'Consistency', score: reputation.score.consistency_score, weight: 15 },
    { label: 'Trust', score: reputation.score.trust_score, weight: 15 },
  ] : [];

  return (
    <div className="min-h-screen bg-[#060606]">
      <div className="max-w-lg mx-auto px-4 py-6">
        {/* Back button */}
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-white/30 hover:text-white/60 text-sm mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>

        {/* Profile header */}
        <div className="glass-card rounded-2xl border border-white/[0.06] p-6 mb-4">
          <div className="flex items-start gap-4">
            {/* Avatar */}
            <div className="relative shrink-0">
              {merchant.avatar_url ? (
                <img src={merchant.avatar_url} alt={merchant.display_name} className="w-20 h-20 rounded-full object-cover border-2 border-white/10" />
              ) : (
                <div className="w-20 h-20 rounded-full border-2 border-white/10 flex items-center justify-center text-3xl bg-white/5">
                  {merchant.display_name.charAt(0).toUpperCase()}
                </div>
              )}
              {merchant.is_online && (
                <div className="absolute bottom-0 right-0 w-4 h-4 bg-emerald-500 border-2 border-[#060606] rounded-full" />
              )}
            </div>

            {/* Name + tier */}
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold text-white truncate">{merchant.display_name}</h1>
              <p className="text-xs text-white/30 font-mono">@{merchant.username}</p>

              {reputation && (
                <div className="flex items-center gap-2 mt-2">
                  <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${tierStyle.bg} border ${tierStyle.border}`}>
                    <Shield className={`w-3.5 h-3.5 ${tierStyle.text}`} />
                    <span className={`text-xs font-bold ${tierStyle.text}`}>{reputation.tierInfo.name}</span>
                  </div>
                  <span className="text-sm font-bold text-white/60 font-mono">{reputation.score.total_score}</span>
                  <span className="text-[10px] text-white/20 font-mono">/1000</span>
                </div>
              )}
            </div>
          </div>

          {/* Bio */}
          {merchant.bio && (
            <p className="mt-4 text-sm text-white/50 leading-relaxed">{merchant.bio}</p>
          )}

          {/* Quick stats row */}
          <div className="grid grid-cols-4 gap-3 mt-5 pt-5 border-t border-white/[0.04]">
            <div className="text-center">
              <div className="text-lg font-bold text-white font-mono">{merchant.total_trades}</div>
              <div className="text-[9px] text-white/25 font-mono uppercase">Trades</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-white font-mono">
                {merchant.total_volume >= 1000 ? `$${(merchant.total_volume / 1000).toFixed(1)}k` : `$${Math.round(merchant.total_volume)}`}
              </div>
              <div className="text-[9px] text-white/25 font-mono uppercase">Volume</div>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center gap-0.5">
                <Star className="w-3.5 h-3.5 fill-orange-400 text-orange-400" />
                <span className="text-lg font-bold text-white font-mono">{Number(merchant.rating).toFixed(1)}</span>
              </div>
              <div className="text-[9px] text-white/25 font-mono uppercase">{merchant.rating_count} reviews</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-white font-mono">{accountAge}d</div>
              <div className="text-[9px] text-white/25 font-mono uppercase">Age</div>
            </div>
          </div>
        </div>

        {/* Active Offers */}
        {publicStats && publicStats.activeOffers.length > 0 && (
          <div className="glass-card rounded-2xl border border-white/[0.06] p-5 mb-4">
            <div className="flex items-center gap-2 mb-3">
              <Tag className="w-4 h-4 text-white/30" />
              <h2 className="text-xs font-bold text-white/50 font-mono uppercase tracking-wider">Active Offers</h2>
              <span className="text-[10px] text-white/20 font-mono ml-auto">{publicStats.activeOffers.length}</span>
            </div>
            <div className="space-y-2">
              {publicStats.activeOffers.map((offer) => (
                <div key={offer.id} className="flex items-center justify-between p-3 bg-white/[0.02] rounded-xl">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded ${
                      offer.type === 'buy'
                        ? 'bg-orange-500/10 text-orange-400'
                        : 'bg-emerald-500/10 text-emerald-400'
                    }`}>
                      {offer.type.toUpperCase()}
                    </span>
                    <span className="text-xs text-white/50 capitalize">
                      {offer.payment_method.replace(/_/g, ' ')}
                    </span>
                    {offer.bank_name && (
                      <span className="text-[10px] text-white/25">{offer.bank_name}</span>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-white font-mono">{Number(offer.rate).toFixed(2)} AED</div>
                    <div className="text-[9px] text-white/25 font-mono">
                      {formatAmount(Number(offer.min_amount))}–{formatAmount(Number(offer.max_amount))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Reputation breakdown */}
        {reputation && (
          <div className="glass-card rounded-2xl border border-white/[0.06] p-5 mb-4">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-4 h-4 text-white/30" />
              <h2 className="text-xs font-bold text-white/50 font-mono uppercase tracking-wider">Reputation Breakdown</h2>
            </div>

            {/* Progress to next tier */}
            {reputation.progress.nextTier && (
              <div className="mb-5 p-3 bg-white/[0.02] rounded-xl border border-white/[0.04]">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] text-white/30 font-mono">
                    {reputation.tierInfo.name} → {reputation.progress.nextTier.charAt(0).toUpperCase() + reputation.progress.nextTier.slice(1)}
                  </span>
                  <span className="text-[10px] text-white/40 font-mono font-bold">{Math.round(reputation.progress.progress)}%</span>
                </div>
                <div className="w-full h-2 bg-white/[0.04] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-orange-500/60 to-orange-400/60 rounded-full transition-all"
                    style={{ width: `${reputation.progress.progress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Score bars */}
            <div className="space-y-3">
              {scoreComponents.map((comp) => (
                <div key={comp.label}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] text-white/50 font-medium">{comp.label}</span>
                    <span className="text-[10px] text-white/30 font-mono">{comp.score}/100 ({comp.weight}%)</span>
                  </div>
                  <div className="w-full h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-orange-500/40 rounded-full transition-all"
                      style={{ width: `${comp.score}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Rank */}
            {reputation.rank && (
              <div className="mt-4 pt-4 border-t border-white/[0.04] flex items-center justify-between">
                <span className="text-[10px] text-white/30 font-mono uppercase">Global Rank</span>
                <span className="text-sm font-bold text-orange-400 font-mono">#{reputation.rank}</span>
              </div>
            )}
          </div>
        )}

        {/* Badges */}
        {reputation && reputation.score.badges.length > 0 && (
          <div className="glass-card rounded-2xl border border-white/[0.06] p-5 mb-4">
            <div className="flex items-center gap-2 mb-3">
              <Award className="w-4 h-4 text-white/30" />
              <h2 className="text-xs font-bold text-white/50 font-mono uppercase tracking-wider">Badges</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {reputation.score.badges.map((badge: string) => (
                <div
                  key={badge}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.03] border border-white/[0.06]"
                >
                  <span className="text-sm">{BADGE_ICONS[badge] || '🏅'}</span>
                  <span className="text-[11px] text-white/60 font-medium capitalize">{badge.replace(/_/g, ' ')}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Performance stats */}
        {reputation?.breakdown && (
          <div className="glass-card rounded-2xl border border-white/[0.06] p-5 mb-4">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="w-4 h-4 text-white/30" />
              <h2 className="text-xs font-bold text-white/50 font-mono uppercase tracking-wider">Performance</h2>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-white/[0.02] rounded-xl">
                <div className="text-[9px] text-white/25 font-mono uppercase mb-1">Completion Rate</div>
                <div className="text-base font-bold text-white font-mono">
                  {(reputation.breakdown.execution.completion_rate * 100).toFixed(0)}%
                </div>
              </div>
              <div className="p-3 bg-white/[0.02] rounded-xl">
                <div className="text-[9px] text-white/25 font-mono uppercase mb-1">Avg Speed</div>
                <div className="text-base font-bold text-white font-mono">
                  {reputation.breakdown.execution.avg_completion_time_mins}m
                </div>
              </div>
              <div className="p-3 bg-white/[0.02] rounded-xl">
                <div className="text-[9px] text-white/25 font-mono uppercase mb-1">Completed</div>
                <div className="text-base font-bold text-white font-mono">
                  {reputation.breakdown.execution.completed_orders}
                </div>
              </div>
              <div className="p-3 bg-white/[0.02] rounded-xl">
                <div className="text-[9px] text-white/25 font-mono uppercase mb-1">Disputes Lost</div>
                <div className="text-base font-bold text-white font-mono">
                  {reputation.breakdown.trust.disputes_lost}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Recent Trades */}
        {publicStats && publicStats.recentOrders.length > 0 && (
          <div className="glass-card rounded-2xl border border-white/[0.06] p-5 mb-4">
            <div className="flex items-center gap-2 mb-3">
              <History className="w-4 h-4 text-white/30" />
              <h2 className="text-xs font-bold text-white/50 font-mono uppercase tracking-wider">Recent Trades</h2>
              <span className="text-[10px] text-white/20 font-mono ml-auto">{publicStats.recentOrders.length}</span>
            </div>
            <div>
              {publicStats.recentOrders.map((order) => (
                <div key={order.id} className="flex items-center justify-between py-2.5 border-b border-white/[0.03] last:border-0">
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      order.type === 'buy' ? 'bg-orange-400' : 'bg-emerald-400'
                    }`} />
                    <span className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded ${
                      order.type === 'buy'
                        ? 'bg-orange-500/10 text-orange-400'
                        : 'bg-emerald-500/10 text-emerald-400'
                    }`}>
                      {order.type.toUpperCase()}
                    </span>
                    <span className="text-xs text-white/40 capitalize">
                      {order.payment_method.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-white font-mono">
                      {order.fiat_currency} {formatAmount(Number(order.fiat_amount))}
                    </span>
                    <span className="text-[10px] text-white/20 font-mono">
                      {formatRelativeDate(order.completed_at)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Reviews */}
        <div className="glass-card rounded-2xl border border-white/[0.06] p-5 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <MessageSquare className="w-4 h-4 text-white/30" />
            <h2 className="text-xs font-bold text-white/50 font-mono uppercase tracking-wider">Reviews</h2>
            {publicStats && publicStats.reviews.length > 0 && (
              <span className="text-[10px] text-white/20 font-mono ml-auto">{publicStats.reviews.length}</span>
            )}
          </div>

          {(!publicStats || publicStats.reviews.length === 0) ? (
            <div className="py-6 text-center">
              <MessageSquare className="w-8 h-8 text-white/[0.06] mx-auto mb-2" />
              <p className="text-xs text-white/25">No written reviews yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {publicStats.reviews.map((review) => (
                <div key={review.id} className="p-3 bg-white/[0.02] rounded-xl">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-0.5">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <Star
                          key={s}
                          className={`w-3 h-3 ${
                            s <= review.rating
                              ? 'fill-orange-400 text-orange-400'
                              : 'text-white/10'
                          }`}
                        />
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-white/25 font-mono">
                        {review.rater_type === 'merchant' ? 'Merchant' : 'Customer'}
                      </span>
                      <span className="text-[9px] text-white/20 font-mono">
                        {formatRelativeDate(review.created_at)}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-white/50 leading-relaxed">{review.review_text}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
