'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { copyToClipboard } from '@/lib/clipboard';
import {
  ArrowLeft,
  User,
  Shield,
  CreditCard,
  Bell,
  LogOut,
  Loader2,
  Check,
  AlertCircle,
  Wallet,
  Copy,
  ExternalLink,
  ChevronRight,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  Zap,
  Settings,
  Droplets,
  Monitor,
  Smartphone,
  Globe,
  X,
  Palette,
  Lock,
  Trophy,
  BookOpen,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMerchantStore } from '@/stores/merchantStore';
import { CorridorProviderSettings } from '@/components/merchant/CorridorProviderSettings';
import { WalletLedger } from '@/components/merchant/WalletLedger';
import { PaymentMethodModal } from '@/components/merchant/PaymentMethodModal';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
import { useTheme, THEMES, type Theme } from '@/context/ThemeContext';
import { Building2, Wallet as WalletIconLucide, DollarSign, Star } from 'lucide-react';

type MerchantPaymentMethod = {
  id: string;
  type: 'bank' | 'cash' | 'crypto' | 'card' | 'mobile';
  name: string;
  details: string;
  is_default: boolean;
};

const PM_TYPE_META: Record<
  MerchantPaymentMethod['type'],
  { label: string; Icon: any; gradient: string; border: string; text: string }
> = {
  bank:   { label: 'Bank Account',  Icon: Building2,        gradient: 'from-blue-500/20 to-blue-600/5',       border: 'border-blue-500/30',    text: 'text-blue-400' },
  cash:   { label: 'Cash Meeting',  Icon: DollarSign,       gradient: 'from-emerald-500/20 to-emerald-600/5', border: 'border-emerald-500/30', text: 'text-emerald-400' },
  crypto: { label: 'Crypto Wallet', Icon: WalletIconLucide, gradient: 'from-primary/20 to-primary/5',         border: 'border-primary/30',     text: 'text-primary' },
  card:   { label: 'Card',          Icon: CreditCard,       gradient: 'from-purple-500/20 to-purple-600/5',   border: 'border-purple-500/30',  text: 'text-purple-400' },
  mobile: { label: 'Mobile Money',  Icon: Smartphone,       gradient: 'from-pink-500/20 to-pink-600/5',       border: 'border-pink-500/30',    text: 'text-pink-400' },
};

// Avatar presets (same as profile modal)
const PRESET_AVATARS = [
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Felix',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Aneka',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Max',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Luna',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Charlie',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Bella',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Oliver',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Milo',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Sophie',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Leo',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=John',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Sarah',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Mike',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Emma',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=David',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Alice',
  'https://api.dicebear.com/7.x/bottts/svg?seed=Robot1',
  'https://api.dicebear.com/7.x/bottts/svg?seed=Robot2',
  'https://api.dicebear.com/7.x/bottts/svg?seed=Robot3',
  'https://api.dicebear.com/7.x/bottts/svg?seed=Robot4',
  'https://api.dicebear.com/7.x/pixel-art/svg?seed=Pixel1',
  'https://api.dicebear.com/7.x/pixel-art/svg?seed=Pixel2',
  'https://api.dicebear.com/7.x/pixel-art/svg?seed=Pixel3',
  'https://api.dicebear.com/7.x/pixel-art/svg?seed=Pixel4',
];

type SettingsTab = 'profile' | 'account' | 'security' | 'theme' | 'payments' | 'notifications' | 'liquidity' | 'reputation' | 'ledger';

export default function MerchantSettingsPage() {
  const router = useRouter();
  const merchantId = useMerchantStore(s => s.merchantId);
  const merchantInfo = useMerchantStore(s => s.merchantInfo);
  const setMerchantInfo = useMerchantStore(s => s.setMerchantInfo);
  const isLoggedIn = useMerchantStore(s => s.isLoggedIn);

  const [activeTab, setActiveTab] = useState<SettingsTab>('profile');
  const [isLoading, setIsLoading] = useState(true);
  const [merchant, setMerchant] = useState<any>(null);

  // Profile form
  const [displayName, setDisplayName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [bio, setBio] = useState('');
  const [phone, setPhone] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Password change
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  // Reputation
  const [repData, setRepData] = useState<any>(null);
  const [repLoading, setRepLoading] = useState(false);

  // Payment methods
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [showAddBank, setShowAddBank] = useState(false);
  const [newBank, setNewBank] = useState({ bank_name: '', account_name: '', iban: '' });
  const [isAddingBank, setIsAddingBank] = useState(false);

  // Merchant payment methods (multi-type: bank / cash / crypto / card / mobile)
  const [paymentMethods, setPaymentMethods] = useState<MerchantPaymentMethod[]>([]);
  const [isLoadingMethods, setIsLoadingMethods] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);

  // Notifications
  const [notifSettings, setNotifSettings] = useState({
    sound: true,
    orderAlerts: true,
    chatMessages: true,
    systemUpdates: true,
  });

  // Copied state
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Redirect if not logged in
  useEffect(() => {
    if (!merchantId && !isLoggedIn) {
      const saved = localStorage.getItem('blip_merchant');
      if (!saved) {
        router.push('/merchant');
        return;
      }
    }
  }, [merchantId, isLoggedIn, router]);

  // Fetch merchant data
  const fetchMerchant = useCallback(async () => {
    const id = merchantId || JSON.parse(localStorage.getItem('blip_merchant') || '{}')?.id;
    if (!id) return;

    try {
      const res = await fetchWithAuth(`/api/merchant/${id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setMerchant(data.data);
          setDisplayName(data.data.display_name || '');
          setBusinessName(data.data.business_name || '');
          setBio(data.data.bio || '');
          setPhone(data.data.phone || '');
          setSelectedAvatar(data.data.avatar_url || null);
        }
      }
    } catch (err) {
      console.error('Failed to fetch merchant:', err);
    } finally {
      setIsLoading(false);
    }
  }, [merchantId]);

  useEffect(() => { fetchMerchant(); }, [fetchMerchant]);

  // Load notification settings from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('blip_notif_settings');
    if (saved) {
      try { setNotifSettings(JSON.parse(saved)); } catch {}
    }

    const soundPref = localStorage.getItem('blip_sound_enabled');
    if (soundPref !== null) {
      setNotifSettings(prev => ({ ...prev, sound: soundPref === 'true' }));
    }
  }, []);

  // Fetch bank accounts
  useEffect(() => {
    const fetchBanks = async () => {
      const id = merchantId || JSON.parse(localStorage.getItem('blip_merchant') || '{}')?.id;
      if (!id) return;
      try {
        const res = await fetchWithAuth(`/api/users/${id}/bank-accounts`);
        if (res.ok) {
          const data = await res.json();
          if (data.success) setBankAccounts(data.data || []);
        }
      } catch {}
    };
    fetchBanks();
  }, [merchantId]);

  const handleSaveProfile = async () => {
    const id = merchantId || merchant?.id;
    if (!id) return;

    setIsSaving(true);
    setSaveError('');
    setSaveSuccess(false);

    try {
      const updates: any = {};
      if (displayName !== (merchant?.display_name || '')) updates.display_name = displayName;
      if (businessName !== (merchant?.business_name || '')) updates.business_name = businessName;
      if (bio !== (merchant?.bio || '')) updates.bio = bio;
      if (phone !== (merchant?.phone || '')) updates.phone = phone;
      if (selectedAvatar && selectedAvatar !== merchant?.avatar_url) updates.avatar_url = selectedAvatar;

      if (Object.keys(updates).length === 0) {
        setSaveError('No changes to save');
        setIsSaving(false);
        return;
      }

      const res = await fetchWithAuth(`/api/merchant/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update profile');
      }

      const data = await res.json();
      setMerchant(data.data);
      setSaveSuccess(true);

      // Update store and localStorage
      setMerchantInfo((prev: any) => ({ ...prev, ...updates }));
      const saved = localStorage.getItem('blip_merchant');
      if (saved) {
        const parsed = JSON.parse(saved);
        localStorage.setItem('blip_merchant', JSON.stringify({ ...parsed, ...updates }));
      }

      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  const handleChangePassword = async () => {
    const trimmedCurrent = currentPassword.trim();
    const trimmedNew = newPassword.trim();
    const trimmedConfirm = confirmNewPassword.trim();

    if (trimmedNew !== trimmedConfirm) {
      const lenDiff =
        trimmedNew.length !== trimmedConfirm.length
          ? ` (${trimmedNew.length} vs ${trimmedConfirm.length} chars)`
          : '';
      setPasswordError(`Passwords do not match${lenDiff}`);
      return;
    }
    if (trimmedNew.length < 8) {
      setPasswordError('Password must be at least 8 characters');
      return;
    }
    if (trimmedNew.length > 24) {
      setPasswordError('Password must be at most 24 characters');
      return;
    }

    setIsChangingPassword(true);
    setPasswordError('');
    setPasswordSuccess(false);

    try {
      const res = await fetchWithAuth('/api/auth/merchant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'change_password',
          merchant_id: merchantId || merchant?.id,
          current_password: trimmedCurrent,
          new_password: trimmedNew,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Password change failed');
      }

      setPasswordSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setTimeout(() => setPasswordSuccess(false), 3000);
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setIsChangingPassword(false);
    }
  };

  const fetchPaymentMethods = useCallback(async () => {
    const id = merchantId || merchant?.id;
    if (!id) return;
    setIsLoadingMethods(true);
    try {
      const res = await fetchWithAuth(`/api/merchant/${id}/payment-methods`);
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setPaymentMethods(
          json.data.map((m: any) => ({
            id: m.id,
            type: m.type,
            name: m.name,
            details: m.details,
            is_default: !!m.is_default,
          })),
        );
      }
    } catch {
      // Silent fail — user sees empty list
    } finally {
      setIsLoadingMethods(false);
    }
  }, [merchantId, merchant?.id]);

  const handleSetDefaultMethod = async (methodId: string) => {
    const id = merchantId || merchant?.id;
    if (!id) return;
    try {
      const res = await fetchWithAuth(`/api/merchant/${id}/payment-methods`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method_id: methodId }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setPaymentMethods(prev => prev.map(m => ({ ...m, is_default: m.id === methodId })));
      }
    } catch {
      // Silent fail
    }
  };

  const handleDeleteMethod = async (methodId: string) => {
    const id = merchantId || merchant?.id;
    if (!id) return;
    try {
      const res = await fetchWithAuth(
        `/api/merchant/${id}/payment-methods?method_id=${methodId}`,
        { method: 'DELETE' },
      );
      const json = await res.json();
      if (res.ok && json.success) {
        setPaymentMethods(prev => prev.filter(m => m.id !== methodId));
      }
    } catch {
      // Silent fail
    }
  };

  // Fetch merchant payment methods when Payments tab opens
  useEffect(() => {
    if (activeTab === 'payments') {
      fetchPaymentMethods();
    }
  }, [activeTab, fetchPaymentMethods]);

  const handleAddBank = async () => {
    if (!newBank.bank_name || !newBank.account_name || !newBank.iban) return;
    setIsAddingBank(true);
    try {
      const id = merchantId || merchant?.id;
      const res = await fetchWithAuth(`/api/users/${id}/bank-accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newBank),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setBankAccounts(prev => [...prev, data.data]);
          setNewBank({ bank_name: '', account_name: '', iban: '' });
          setShowAddBank(false);
        }
      }
    } catch (err) {
      console.error('Failed to add bank:', err);
    } finally {
      setIsAddingBank(false);
    }
  };

  const handleDeleteBank = async (bankId: string) => {
    try {
      const id = merchantId || merchant?.id;
      const res = await fetchWithAuth(`/api/users/${id}/bank-accounts?bank_id=${bankId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setBankAccounts(prev => prev.filter(b => b.id !== bankId));
      }
    } catch {}
  };

  const handleSaveNotifications = () => {
    localStorage.setItem('blip_notif_settings', JSON.stringify(notifSettings));
    localStorage.setItem('blip_sound_enabled', String(notifSettings.sound));
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2000);
  };

  const handleCopyField = async (text: string, field: string) => {
    await copyToClipboard(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleLogout = async () => {
    // Best-effort: revoke server-side session so the refresh cookie can't
    // resurrect the token. Don't block on failure — local logout still works.
    try {
      await fetchWithAuth('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
    } catch { /* offline / network error — proceed with local logout */ }

    try {
      useMerchantStore.getState().setSessionToken(null);
      useMerchantStore.getState().setMerchantId?.(null);
      useMerchantStore.getState().setMerchantInfo?.(null as any);
    } catch { /* store not hydrated */ }
    try {
      localStorage.removeItem('blip_merchant');
      localStorage.removeItem('merchant_info');
      sessionStorage.removeItem('blip_session_token');
    } catch { /* SSR */ }
    window.location.href = '/merchant';
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background text-white flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-white/40" />
      </div>
    );
  }

  const tabs: { id: SettingsTab; label: string; icon: any }[] = [
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'account', label: 'Account', icon: Shield },
    { id: 'security', label: 'Security', icon: Lock },
    { id: 'theme', label: 'Theme', icon: Palette },
    { id: 'payments', label: 'Payments', icon: CreditCard },
    { id: 'notifications', label: 'Alerts', icon: Bell },
    { id: 'liquidity', label: 'Liquidity', icon: Droplets },
    { id: 'reputation', label: 'Reputation', icon: Trophy },
    { id: 'ledger', label: 'Wallet Ledger', icon: BookOpen },
  ];

  return (
    <div className="min-h-screen bg-background text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm border-b border-white/[0.05]">
        <div className="h-[50px] flex items-center px-4 gap-3 max-w-5xl mx-auto">
          <Link
            href="/merchant"
            className="flex items-center gap-2 text-white/60 hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-[13px] font-medium hidden sm:inline">Dashboard</span>
          </Link>

          <div className="flex-1 flex items-center justify-center">
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-white/40" />
              <h1 className="text-[15px] font-bold">Settings</h1>
            </div>
          </div>

          <div className="w-16" />
        </div>
      </header>

      <div className="max-w-5xl mx-auto flex flex-col md:flex-row min-h-[calc(100vh-50px)]">
        {/* Sidebar Tabs */}
        <nav className="md:w-56 md:border-r border-white/[0.05] md:py-4 md:px-2 shrink-0">
          {/* Mobile: horizontal scroll tabs */}
          <div className="flex md:flex-col gap-1 overflow-x-auto px-3 py-2 md:p-0 scrollbar-hide">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all whitespace-nowrap ${
                    activeTab === tab.id
                      ? 'bg-white/[0.08] text-white'
                      : 'text-white/40 hover:text-foreground/60 hover:bg-card'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {tab.label}
                </button>
              );
            })}

            <div className="hidden md:block mt-auto pt-8">
              <button
                onClick={handleLogout}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-medium text-red-400/70 hover:text-[var(--color-error)] hover:bg-[var(--color-error)]/[0.06] transition-all w-full"
              >
                <LogOut className="w-4 h-4" />
                Logout
              </button>
            </div>
          </div>
        </nav>

        {/* Content */}
        <main className="flex-1 p-4 md:p-6 pb-24 md:pb-6">
          {/* Success/Error banners */}
          {saveSuccess && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4 flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-sm text-emerald-400"
            >
              <Check className="w-4 h-4" />
              Changes saved successfully
            </motion.div>
          )}

          {saveError && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4 flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400"
            >
              <AlertCircle className="w-4 h-4" />
              {saveError}
            </motion.div>
          )}

          {/* Profile Tab */}
          {activeTab === 'profile' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-bold mb-1">Profile</h2>
                <p className="text-sm text-white/40">Manage how you appear to other traders</p>
              </div>

              {/* Avatar */}
              <div className="bg-white/[0.02] rounded-2xl border border-white/[0.06] p-5">
                <label className="text-xs text-white/40 font-mono uppercase tracking-wider mb-3 block">Avatar</label>
                <div className="flex items-center gap-4 mb-4">
                  <div className="relative w-16 h-16 rounded-full border-2 border-white/20 overflow-hidden shrink-0">
                    {selectedAvatar ? (
                      <img src={selectedAvatar} alt="Avatar" className="absolute inset-0 w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-white/5 text-2xl">
                        {displayName?.charAt(0)?.toUpperCase() || '?'}
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="text-sm text-white/70">Choose from preset avatars below</p>
                    <p className="text-xs text-white/30 mt-0.5">Click any avatar to select it</p>
                  </div>
                </div>
                <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-12 gap-2">
                  {PRESET_AVATARS.map((url, i) => (
                    <button
                      key={i}
                      onClick={() => setSelectedAvatar(url)}
                      className={`relative aspect-square rounded-full overflow-hidden border-2 transition-all ${
                        selectedAvatar === url
                          ? 'border-primary ring-2 ring-primary/30 scale-110'
                          : 'border-white/10 hover:border-border-strong'
                      }`}
                    >
                      <img src={url} alt={`Avatar ${i + 1}`} className="absolute inset-0 w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>

              {/* Display Name & Business */}
              <div className="bg-white/[0.02] rounded-2xl border border-white/[0.06] p-5 space-y-4">
                <div>
                  <label className="text-xs text-white/40 font-mono uppercase tracking-wider mb-2 block">Display Name</label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Your display name"
                    maxLength={50}
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 outline-none focus:border-primary/30 transition-colors"
                  />
                </div>

                <div>
                  <label className="text-xs text-white/40 font-mono uppercase tracking-wider mb-2 block">Business Name</label>
                  <input
                    type="text"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    placeholder="Your business name (optional)"
                    maxLength={100}
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 outline-none focus:border-primary/30 transition-colors"
                  />
                </div>

                <div>
                  <label className="text-xs text-white/40 font-mono uppercase tracking-wider mb-2 block">Bio</label>
                  <textarea
                    value={bio}
                    onChange={(e) => setBio(e.target.value.slice(0, 200))}
                    placeholder="Tell traders about yourself..."
                    rows={3}
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 outline-none focus:border-primary/30 resize-none transition-colors"
                  />
                  <span className="text-[10px] text-white/20 font-mono mt-1 block text-right">{bio.length}/200</span>
                </div>

                <div>
                  <label className="text-xs text-white/40 font-mono uppercase tracking-wider mb-2 block">Phone</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+971 50 123 4567"
                    maxLength={20}
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 outline-none focus:border-primary/30 transition-colors"
                  />
                </div>
              </div>

              {/* Save Button */}
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={handleSaveProfile}
                disabled={isSaving}
                className="w-full py-3 rounded-xl bg-primary text-background font-bold text-sm hover:bg-primary transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isSaving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : saveSuccess ? (
                  <Check className="w-4 h-4" />
                ) : null}
                {isSaving ? 'Saving...' : saveSuccess ? 'Saved!' : 'Save Changes'}
              </motion.button>

              {/* View Public Profile Link */}
              {merchantId && (
                <Link
                  href={`/merchant/profile/${merchantId}`}
                  className="flex items-center justify-center gap-2 text-sm text-white/40 hover:text-foreground/60 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  View your public profile
                </Link>
              )}
            </div>
          )}

          {/* Account Tab */}
          {activeTab === 'account' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-bold mb-1">Account</h2>
                <p className="text-sm text-white/40">Account details and trading stats</p>
              </div>

              {/* Account Info */}
              <div className="bg-white/[0.02] rounded-2xl border border-white/[0.06] p-5 space-y-3">
                <label className="text-xs text-white/40 font-mono uppercase tracking-wider mb-2 block">Account Information</label>

                {/* Username */}
                <div className="flex items-center justify-between py-2 border-b border-white/[0.04]">
                  <div>
                    <p className="text-xs text-white/30">Username</p>
                    <p className="text-sm text-white/80 font-mono">{merchant?.username || '—'}</p>
                  </div>
                </div>

                {/* Email */}
                <div className="flex items-center justify-between py-2 border-b border-white/[0.04]">
                  <div>
                    <p className="text-xs text-white/30">Email</p>
                    <p className="text-sm text-white/80">{merchant?.email || 'Not set'}</p>
                  </div>
                </div>

                {/* Merchant ID */}
                <div className="flex items-center justify-between py-2 border-b border-white/[0.04]">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-white/30">Merchant ID</p>
                    <p className="text-sm text-white/50 font-mono truncate">{merchant?.id || merchantId || '—'}</p>
                  </div>
                  <button
                    onClick={() => handleCopyField(merchant?.id || merchantId || '', 'merchant_id')}
                    className="p-1.5 hover:bg-card rounded-lg transition-colors shrink-0 ml-2"
                  >
                    {copiedField === 'merchant_id' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-white/30" />
                    )}
                  </button>
                </div>

                {/* Wallet */}
                <div className="flex items-center justify-between py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-white/30">Wallet Address</p>
                    <p className="text-sm text-white/50 font-mono truncate">
                      {merchant?.wallet_address || 'Not connected'}
                    </p>
                  </div>
                  {merchant?.wallet_address && (
                    <button
                      onClick={() => handleCopyField(merchant.wallet_address, 'wallet')}
                      className="p-1.5 hover:bg-card rounded-lg transition-colors shrink-0 ml-2"
                    >
                      {copiedField === 'wallet' ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-white/30" />
                      )}
                    </button>
                  )}
                </div>
              </div>

              {/* Stats */}
              <div className="bg-white/[0.02] rounded-2xl border border-white/[0.06] p-5">
                <label className="text-xs text-white/40 font-mono uppercase tracking-wider mb-3 block">Trading Stats</label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.04]">
                    <p className="text-[10px] text-white/30 font-mono uppercase">Total Trades</p>
                    <p className="text-lg font-bold text-white/80 font-mono">{merchant?.total_trades || 0}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.04]">
                    <p className="text-[10px] text-white/30 font-mono uppercase">Rating</p>
                    <p className="text-lg font-bold text-white/80 font-mono">{parseFloat(String(merchant?.rating || 5)).toFixed(2)}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.04]">
                    <p className="text-[10px] text-white/30 font-mono uppercase">Status</p>
                    <p className={`text-lg font-bold font-mono ${merchant?.status === 'active' ? 'text-emerald-400' : 'text-red-400'}`}>
                      {merchant?.status || 'active'}
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.04]">
                    <p className="text-[10px] text-white/30 font-mono uppercase">Joined</p>
                    <p className="text-sm font-bold text-white/60 font-mono">
                      {merchant?.created_at ? new Date(merchant.created_at).toLocaleDateString() : '—'}
                    </p>
                  </div>
                </div>
              </div>

            </div>
          )}

          {/* Security Tab */}
          {activeTab === 'security' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-bold mb-1">Security</h2>
                <p className="text-sm text-white/40">Password, two-factor authentication, and sessions</p>
              </div>

              {/* Change Password */}
              <div className="bg-white/[0.02] rounded-2xl border border-white/[0.06] p-5 space-y-4">
                <label className="text-xs text-white/40 font-mono uppercase tracking-wider mb-2 block">Change Password</label>

                {passwordError && (
                  <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400">
                    <AlertCircle className="w-4 h-4" />
                    {passwordError}
                  </div>
                )}

                {passwordSuccess && (
                  <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-sm text-emerald-400">
                    <Check className="w-4 h-4" />
                    Password changed successfully
                  </div>
                )}

                <div className="relative">
                  <input
                    type={showCurrentPassword ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Current password"
                    maxLength={24}
                    autoComplete="off"
                    className="w-full bg-foreground/[0.04] border border-foreground/[0.08] rounded-xl px-4 py-3 pr-10 text-sm text-foreground placeholder:text-foreground/30 outline-none focus:border-primary/30 transition-colors"
                  />
                  <button
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 z-10 text-foreground/60 hover:text-foreground"
                  >
                    {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                <div className="relative">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="New password (8–24 chars)"
                    maxLength={24}
                    autoComplete="new-password"
                    className="w-full bg-foreground/[0.04] border border-foreground/[0.08] rounded-xl px-4 py-3 pr-10 text-sm text-foreground placeholder:text-foreground/30 outline-none focus:border-primary/30 transition-colors"
                  />
                  <button
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 z-10 text-foreground/60 hover:text-foreground"
                  >
                    {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                <div className="relative">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    placeholder="Confirm new password"
                    maxLength={24}
                    autoComplete="new-password"
                    className="w-full bg-foreground/[0.04] border border-foreground/[0.08] rounded-xl px-4 py-3 pr-10 text-sm text-foreground placeholder:text-foreground/30 outline-none focus:border-primary/30 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 z-10 text-foreground/60 hover:text-foreground"
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                <button
                  onClick={handleChangePassword}
                  disabled={isChangingPassword || !currentPassword || !newPassword || !confirmNewPassword}
                  className="w-full py-3 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white/80 font-medium text-sm hover:bg-accent-subtle transition-colors disabled:opacity-30 flex items-center justify-center gap-2"
                >
                  {isChangingPassword && <Loader2 className="w-4 h-4 animate-spin" />}
                  {isChangingPassword ? 'Changing...' : 'Change Password'}
                </button>
              </div>

              {/* Two-Factor Authentication */}
              <TwoFactorSection merchantId={merchantId} />

              {/* Active Sessions */}
              <ActiveSessionsSection />

              {/* Danger Zone */}
              <div className="bg-red-500/[0.03] rounded-2xl border border-red-500/[0.08] p-5">
                <label className="text-xs text-red-400/60 font-mono uppercase tracking-wider mb-3 block">Danger Zone</label>
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 font-medium text-sm hover:bg-[var(--color-error)]/20 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Log Out
                </button>
              </div>
            </div>
          )}

          {/* Theme Tab */}
          {activeTab === 'theme' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-bold mb-1">Theme</h2>
                <p className="text-sm text-white/40">Customize the look of your dashboard</p>
              </div>

              <ThemeSection />
            </div>
          )}

          {/* Payments Tab */}
          {activeTab === 'payments' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-bold mb-1">Payment Methods</h2>
                <p className="text-sm text-white/40">
                  Bank, card, crypto, cash and mobile methods used to send or receive funds
                </p>
              </div>

              <div className="space-y-3">
                {isLoadingMethods && paymentMethods.length === 0 ? (
                  <div className="bg-white/[0.02] rounded-2xl border border-white/[0.06] p-8 text-center">
                    <Loader2 className="w-5 h-5 text-white/20 mx-auto animate-spin" />
                    <p className="text-xs text-white/30 mt-3">Loading payment methods…</p>
                  </div>
                ) : paymentMethods.length === 0 ? (
                  <div className="bg-white/[0.02] rounded-2xl border border-white/[0.06] p-8 text-center">
                    <CreditCard className="w-10 h-10 text-white/10 mx-auto mb-3" />
                    <p className="text-sm text-white/40 mb-4">No payment methods added yet</p>
                    <button
                      onClick={() => setIsPaymentModalOpen(true)}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/10 border border-primary/20 text-sm text-primary font-medium hover:bg-primary/20 transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                      Add Payment Method
                    </button>
                  </div>
                ) : (
                  <>
                    {paymentMethods.map((method) => {
                      const meta = PM_TYPE_META[method.type] || PM_TYPE_META.bank;
                      const Icon = meta.Icon;
                      return (
                        <div
                          key={method.id}
                          className={`rounded-2xl border p-4 transition-colors ${
                            method.is_default
                              ? 'bg-gradient-to-r from-primary/[0.06] to-transparent border-primary/20'
                              : 'bg-white/[0.02] border-white/[0.06]'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${meta.gradient} border ${meta.border} flex items-center justify-center shrink-0`}>
                                <Icon className={`w-5 h-5 ${meta.text}`} />
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-medium text-white/80 truncate">{method.name}</p>
                                  <span className="text-[9px] font-bold font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.06] text-white/40">
                                    {meta.label}
                                  </span>
                                  {method.is_default && (
                                    <span className="flex items-center gap-1 px-1.5 py-0.5 bg-primary/10 border border-primary/20 rounded-md">
                                      <Star className="w-2.5 h-2.5 text-primary fill-primary" />
                                      <span className="text-[9px] text-primary font-bold uppercase tracking-wider">Default</span>
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-white/30 font-mono mt-0.5 truncate">{method.details}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {!method.is_default && (
                                <button
                                  onClick={() => handleSetDefaultMethod(method.id)}
                                  className="p-2 text-white/20 hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                                  title="Set as default"
                                >
                                  <Star className="w-4 h-4" />
                                </button>
                              )}
                              <button
                                onClick={() => handleDeleteMethod(method.id)}
                                className="p-2 text-white/20 hover:text-[var(--color-error)] hover:bg-[var(--color-error)]/10 rounded-lg transition-colors"
                                title="Remove"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    <button
                      onClick={() => setIsPaymentModalOpen(true)}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-white/[0.08] text-sm text-white/30 hover:text-foreground/50 hover:border-border-strong transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                      Add Payment Method
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Notifications Tab */}
          {activeTab === 'notifications' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-bold mb-1">Notifications</h2>
                <p className="text-sm text-white/40">Configure alerts and sounds</p>
              </div>

              <div className="bg-white/[0.02] rounded-2xl border border-white/[0.06] p-5 space-y-1">
                {[
                  { key: 'sound' as const, label: 'Sound Effects', desc: 'Play sounds for new orders and messages' },
                  { key: 'orderAlerts' as const, label: 'Order Alerts', desc: 'Get notified about new and updated orders' },
                  { key: 'chatMessages' as const, label: 'Chat Messages', desc: 'Notifications for incoming messages' },
                  { key: 'systemUpdates' as const, label: 'System Updates', desc: 'Platform news and maintenance alerts' },
                ].map((item) => (
                  <div key={item.key} className="flex items-center justify-between py-3 border-b border-white/[0.04] last:border-0">
                    <div>
                      <p className="text-sm text-white/80">{item.label}</p>
                      <p className="text-xs text-white/30 mt-0.5">{item.desc}</p>
                    </div>
                    <button
                      onClick={() => setNotifSettings(prev => ({ ...prev, [item.key]: !prev[item.key] }))}
                      className={`w-11 h-6 rounded-full transition-all relative ${
                        notifSettings[item.key]
                          ? 'bg-primary'
                          : 'bg-white/[0.08]'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full bg-white shadow-sm absolute top-0.5 transition-all ${
                        notifSettings[item.key] ? 'left-[22px]' : 'left-0.5'
                      }`} />
                    </button>
                  </div>
                ))}
              </div>

              <button
                onClick={handleSaveNotifications}
                className="w-full py-3 rounded-xl bg-primary text-background font-bold text-sm hover:bg-primary transition-colors flex items-center justify-center gap-2"
              >
                Save Preferences
              </button>
            </div>
          )}

          {/* Liquidity Tab */}
          {activeTab === 'liquidity' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-bold mb-1">Liquidity Provider</h2>
                <p className="text-sm text-white/40">Earn fees by providing liquidity for other traders</p>
              </div>

              <div className="bg-white/[0.02] rounded-2xl border border-white/[0.06] p-5">
                <CorridorProviderSettings merchantId={merchantId || null} />
              </div>
            </div>
          )}

          {activeTab === 'reputation' && (
            <ReputationTab merchantId={merchantId} />
          )}

          {activeTab === 'ledger' && (merchantId || merchant?.id) && (
            <div>
              <h2 className="text-lg font-bold mb-1">Wallet Ledger</h2>
              <p className="text-sm text-white/40 mb-6">View your complete USDT transaction history with running balances.</p>
              <WalletLedger merchantId={merchantId || merchant?.id} />
            </div>
          )}

          {/* Mobile Logout */}
          <div className="md:hidden mt-8 pt-6 border-t border-white/[0.04]">
            <button
              onClick={handleLogout}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 font-medium text-sm hover:bg-[var(--color-error)]/20 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Log Out
            </button>

            <p className="text-center text-[10px] text-white/15 mt-4 font-mono">
              Blip Money v1.0
            </p>
          </div>
        </main>
      </div>

      <PaymentMethodModal
        isOpen={isPaymentModalOpen}
        onClose={() => {
          setIsPaymentModalOpen(false);
          fetchPaymentMethods();
        }}
        merchantId={merchantId || merchant?.id || ''}
      />
    </div>
  );
}

// ============================================
// REPUTATION TAB COMPONENT
// ============================================

function ReputationTab({ merchantId }: { merchantId: string | null }) {
  const [repData, setRepData] = useState<any>(null);
  const [repLoading, setRepLoading] = useState(true);

  useEffect(() => {
    const id = merchantId || JSON.parse(localStorage.getItem('blip_merchant') || '{}')?.id;
    if (!id) {
      setRepLoading(false);
      return;
    }
    setRepLoading(true);
    fetch(`/api/reputation?entityId=${id}&entityType=merchant`)
      .then(r => r.json())
      .then(data => {
        if (data.success && data.data) {
          setRepData(data.data);
        }
      })
      .catch(err => console.error('Reputation fetch error:', err))
      .finally(() => setRepLoading(false));
  }, [merchantId]);

  const score = repData?.score?.total_score ?? 0;
  const tier = repData?.score?.tier ?? 'newcomer';
  const badges = repData?.score?.badges ?? [];

  const tierLabels: Record<string, string> = {
    diamond: 'Diamond', platinum: 'Platinum', gold: 'Gold',
    silver: 'Silver', bronze: 'Bronze', newcomer: 'Newcomer',
  };

  const getColor = (s: number) => {
    if (s >= 900) return '#06b6d4';
    if (s >= 800) return '#3b82f6';
    if (s >= 600) return '#22c55e';
    if (s >= 400) return '#eab308';
    if (s >= 200) return '#f97316';
    return '#ef4444';
  };

  const segments = [
    { start: 0, end: 20, color: '#ef4444', label: 'Poor', offset: 30 },
    { start: 20, end: 40, color: '#f97316', label: 'Fair', offset: 24 },
    { start: 40, end: 60, color: '#eab308', label: 'Good', offset: 24 },
    { start: 60, end: 80, color: '#22c55e', label: 'V.Good', offset: 28 },
    { start: 80, end: 100, color: '#06b6d4', label: 'Excellent', offset: 42 },
  ];

  const breakdownMap: Record<string, { label: string; key: string }> = {
    execution_score: { label: 'Reliability', key: 'execution_score' },
    volume_score: { label: 'Volume', key: 'volume_score' },
    consistency_score: { label: 'Speed', key: 'consistency_score' },
    trust_score: { label: 'Liquidity', key: 'trust_score' },
    review_score: { label: 'Trust', key: 'review_score' },
  };

  if (repLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-white/30" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold mb-1">Reputation Score</h2>
        <p className="text-sm text-white/40">Your reputation based on trading history, speed, and trust</p>
      </div>

      {/* Gauge */}
      <div className="bg-white/[0.02] rounded-2xl border border-white/[0.06] p-6">
        <div className="flex flex-col items-center">
          <div className="relative" style={{ width: 340, height: 200 }}>
            <svg viewBox="0 0 340 200" className="w-full h-full" overflow="visible">
              {segments.map((seg, i) => {
                const cx = 170, cy = 170, r = 120;
                const startAngle = Math.PI + (seg.start / 100) * Math.PI;
                const endAngle = Math.PI + (seg.end / 100) * Math.PI;
                const x1 = cx + r * Math.cos(startAngle);
                const y1 = cy + r * Math.sin(startAngle);
                const x2 = cx + r * Math.cos(endAngle);
                const y2 = cy + r * Math.sin(endAngle);
                const midAngle = Math.PI + ((seg.start + seg.end) / 200) * Math.PI;
                const lx = cx + (r + seg.offset) * Math.cos(midAngle);
                const ly = cy + (r + seg.offset) * Math.sin(midAngle);
                return (
                  <g key={i}>
                    <path d={`M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`}
                      fill="none" stroke={seg.color} strokeWidth="24" strokeLinecap="butt" opacity={0.9} />
                    <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
                      fontSize="10" fontWeight="600" fill={seg.color} opacity={0.85}>
                      {seg.label}
                    </text>
                  </g>
                );
              })}

              {/* Needle */}
              {(() => {
                const cx = 170, cy = 170;
                const pct = Math.min(100, Math.max(0, score / 10));
                const angle = Math.PI + (pct / 100) * Math.PI;
                const len = 90;
                const tipX = cx + len * Math.cos(angle);
                const tipY = cy + len * Math.sin(angle);
                const bw = 7;
                const pa = angle + Math.PI / 2;
                const b1x = cx + bw * Math.cos(pa), b1y = cy + bw * Math.sin(pa);
                const b2x = cx - bw * Math.cos(pa), b2y = cy - bw * Math.sin(pa);
                const tl = 18;
                const tailX = cx - tl * Math.cos(angle), tailY = cy - tl * Math.sin(angle);
                return (
                  <g>
                    <defs>
                      <filter id="ns" x="-20%" y="-20%" width="140%" height="140%">
                        <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="#000" floodOpacity="0.4" />
                      </filter>
                    </defs>
                    <polygon points={`${tipX},${tipY} ${b1x},${b1y} ${tailX},${tailY} ${b2x},${b2y}`}
                      fill={getColor(score)} filter="url(#ns)" opacity={0.95} />
                    <circle cx={cx} cy={cy} r="12" fill={getColor(score)} filter="url(#ns)" />
                    <circle cx={cx} cy={cy} r="6" fill="var(--background, #0a0a0a)" />
                    <circle cx={cx} cy={cy} r="2.5" fill={getColor(score)} opacity={0.6} />
                  </g>
                );
              })()}

              <text x="42" y="185" fontSize="10" fill="white" opacity={0.3} fontFamily="monospace">0</text>
              <text x="286" y="185" fontSize="10" fill="white" opacity={0.3} fontFamily="monospace">1000</text>
            </svg>
          </div>

          {/* Score */}
          <div className="flex flex-col items-center -mt-2">
            <span className="text-5xl font-black" style={{ color: getColor(score) }}>
              {score}
            </span>
            <span className="text-sm font-bold mt-1" style={{ color: getColor(score) }}>
              {tierLabels[tier] || tier}
            </span>
          </div>
        </div>

        {/* Badges */}
        {badges.length > 0 && (
          <div className="flex flex-wrap justify-center gap-2 mt-4">
            {badges.map((b: string) => (
              <span key={b} className="px-3 py-1 rounded-full text-[11px] font-medium bg-white/[0.06] border border-white/[0.08] text-white/60">
                {b.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Breakdown */}
      <div className="bg-white/[0.02] rounded-2xl border border-white/[0.06] p-5">
        <h3 className="text-xs font-bold text-white/40 uppercase tracking-wider mb-4">Score Breakdown</h3>
        <div className="space-y-3">
          {Object.entries(breakdownMap).map(([key, { label }]) => {
            const val = repData?.score?.[key] ?? 0;
            return (
              <div key={key}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-white/60">{label}</span>
                  <span className="text-sm font-bold text-white/80">{val} / 100</span>
                </div>
                <div className="h-2 rounded-full bg-white/[0.06]">
                  <div className="h-full rounded-full transition-all" style={{
                    width: `${Math.min(100, val)}%`,
                    backgroundColor: getColor(val * 10),
                  }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white/[0.02] rounded-xl border border-white/[0.06] p-4 text-center">
          <p className="text-2xl font-bold text-white/80">{repData?.score?.total_score ?? 0}</p>
          <p className="text-[11px] text-white/30 mt-1">Score</p>
        </div>
        <div className="bg-white/[0.02] rounded-xl border border-white/[0.06] p-4 text-center">
          <p className="text-2xl font-bold text-white/80">{tierLabels[tier]}</p>
          <p className="text-[11px] text-white/30 mt-1">Tier</p>
        </div>
        <div className="bg-white/[0.02] rounded-xl border border-white/[0.06] p-4 text-center">
          <p className="text-2xl font-bold text-white/80">{repData?.rank ?? '—'}</p>
          <p className="text-[11px] text-white/30 mt-1">Rank</p>
        </div>
        <div className="bg-white/[0.02] rounded-xl border border-white/[0.06] p-4 text-center">
          <p className="text-2xl font-bold text-white/80">{badges.length}</p>
          <p className="text-[11px] text-white/30 mt-1">Badges</p>
        </div>
      </div>

      {/* Progress to next tier */}
      {repData?.progress && (
        <div className="bg-white/[0.02] rounded-2xl border border-white/[0.06] p-5">
          <h3 className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">Progress to Next Tier</h3>
          <p className="text-sm text-white/60 mb-3">
            {repData.progress.pointsNeeded > 0
              ? `${repData.progress.pointsNeeded} points to ${tierLabels[repData.progress.nextTier] || repData.progress.nextTier}`
              : 'Maximum tier reached!'}
          </p>
          <div className="h-3 rounded-full bg-white/[0.06]">
            <div className="h-full rounded-full bg-primary transition-all" style={{
              width: `${Math.min(100, repData.progress.progressPercent ?? 0)}%`,
            }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Active Sessions Component ────────────────────────────────────────

interface SessionData {
  id: string;
  device: string | null;
  ip: string | null;
  browser: string | null;
  browserVersion: string | null;
  os: string | null;
  osVersion: string | null;
  deviceName: string | null;
  deviceType: 'mobile' | 'tablet' | 'desktop';
  lastUsed: string;
  createdAt: string;
  expiresAt: string;
}

function TwoFactorSection({ merchantId }: { merchantId: string | null }) {
  const [is2FAEnabled, setIs2FAEnabled] = useState(false);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [step, setStep] = useState<'idle' | 'setup' | 'verify' | 'backup' | 'disable' | 'regenerate'>('idle');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [manualSecret, setManualSecret] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const [showDisablePassword, setShowDisablePassword] = useState(false);
  const [disableCode, setDisableCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [backupCodesAcked, setBackupCodesAcked] = useState(false);
  const [regenCode, setRegenCode] = useState('');

  // Fetch 2FA status on mount (with timeout)
  useEffect(() => {
    if (!merchantId) { setIsLoadingStatus(false); return; }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    fetchWithAuth('/api/2fa/status', { signal: controller.signal })
      .then(res => res.json())
      .then(data => {
        if (data.success) setIs2FAEnabled(data.data?.enabled ?? false);
      })
      .catch(() => {})
      .finally(() => { clearTimeout(timeout); setIsLoadingStatus(false); });
  }, [merchantId]);

  const handleSetup = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await fetchWithAuth('/api/2fa/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountName: merchantId?.slice(0, 8) }),
      });
      const data = await res.json();
      if (data.success) {
        setQrDataUrl(data.data.qrDataUrl);
        setManualSecret(data.data.secret);
        setStep('verify');
      } else {
        setError(data.error || 'Failed to start 2FA setup');
      }
    } catch {
      setError('Network error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerify = async () => {
    if (!/^\d{6}$/.test(otpCode)) { setError('Enter a 6-digit code'); return; }
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await fetchWithAuth('/api/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: otpCode }),
      });
      const data = await res.json();
      if (data.success) {
        setIs2FAEnabled(true);
        setOtpCode('');
        // Show recovery codes returned by the API — user MUST save them
        if (Array.isArray(data.data?.backupCodes) && data.data.backupCodes.length > 0) {
          setBackupCodes(data.data.backupCodes);
          setBackupCodesAcked(false);
          setStep('backup');
        } else {
          setStep('idle');
          setSuccess('Two-factor authentication enabled!');
          setTimeout(() => setSuccess(null), 4000);
        }
      } else {
        setError(data.error || 'Invalid code');
      }
    } catch {
      setError('Network error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDownloadCodes = () => {
    if (backupCodes.length === 0) return;
    const text = [
      'Blip Money — 2FA Recovery Codes',
      '',
      'Each code can be used ONCE if you lose access to your authenticator app.',
      'Keep this file somewhere safe (password manager / printed copy).',
      '',
      ...backupCodes,
      '',
      `Generated: ${new Date().toISOString()}`,
    ].join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `blip-money-2fa-recovery-codes-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopyCodes = async () => {
    if (backupCodes.length === 0) return;
    try {
      await navigator.clipboard.writeText(backupCodes.join('\n'));
      setSuccess('Recovery codes copied to clipboard');
      setTimeout(() => setSuccess(null), 3000);
    } catch {
      setError('Failed to copy. Please select and copy manually.');
    }
  };

  const handleRegenerate = async () => {
    if (!/^\d{6}$/.test(regenCode)) { setError('Enter a 6-digit code'); return; }
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await fetchWithAuth('/api/2fa/regenerate-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: regenCode }),
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.data?.backupCodes)) {
        setBackupCodes(data.data.backupCodes);
        setBackupCodesAcked(false);
        setRegenCode('');
        setStep('backup');
      } else {
        setError(data.error || 'Failed to regenerate codes');
      }
    } catch {
      setError('Network error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDisable = async () => {
    if (!/^\d{6}$/.test(disableCode)) { setError('Enter a 6-digit code'); return; }
    if (!disablePassword) { setError('Password is required'); return; }
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await fetchWithAuth('/api/2fa/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: disablePassword, code: disableCode }),
      });
      const data = await res.json();
      if (data.success) {
        setIs2FAEnabled(false);
        setStep('idle');
        setSuccess('Two-factor authentication disabled.');
        setDisablePassword('');
        setDisableCode('');
        setTimeout(() => setSuccess(null), 4000);
      } else {
        setError(data.error || 'Failed to disable 2FA');
      }
    } catch {
      setError('Network error');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoadingStatus) {
    return (
      <div className="bg-white/[0.02] rounded-2xl border border-white/[0.06] p-5 flex items-center justify-center">
        <Loader2 className="w-4 h-4 animate-spin text-white/30" />
      </div>
    );
  }

  return (
    <div className="bg-white/[0.02] rounded-2xl border border-white/[0.06] p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <label className="text-xs text-white/40 font-mono uppercase tracking-wider block">Two-Factor Authentication</label>
          <p className="text-[11px] text-white/25 mt-0.5">Secure your account with Google Authenticator</p>
        </div>
        <div className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
          is2FAEnabled
            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
            : 'bg-white/[0.04] text-white/30 border border-white/[0.06]'
        }`}>
          {is2FAEnabled ? 'ENABLED' : 'OFF'}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-sm text-emerald-400">
          <Check className="w-4 h-4 shrink-0" />
          {success}
        </div>
      )}

      {/* Idle — show enable/disable button */}
      {step === 'idle' && (
        is2FAEnabled ? (
          <div className="space-y-2">
            <button
              onClick={() => { setStep('regenerate'); setError(null); setRegenCode(''); }}
              className="w-full py-3 rounded-xl bg-foreground/[0.04] border border-foreground/[0.08] text-foreground/80 font-medium text-sm hover:bg-foreground/[0.08] transition-colors flex items-center justify-center gap-2"
            >
              <Shield className="w-4 h-4" />
              Regenerate Recovery Codes
            </button>
            <button
              onClick={() => { setStep('disable'); setError(null); }}
              className="w-full py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 font-medium text-sm hover:bg-[var(--color-error)]/20 transition-colors flex items-center justify-center gap-2"
            >
              <Shield className="w-4 h-4" />
              Disable 2FA
            </button>
          </div>
        ) : (
          <button
            onClick={handleSetup}
            disabled={isSubmitting}
            className="w-full py-3 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white/80 font-medium text-sm hover:bg-accent-subtle transition-colors disabled:opacity-30 flex items-center justify-center gap-2"
          >
            {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
            {isSubmitting ? 'Setting up...' : 'Enable 2FA'}
          </button>
        )
      )}

      {/* Backup recovery codes — shown ONCE after successful enable / regen */}
      {step === 'backup' && (
        <div className="space-y-3">
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300">
            <p className="font-bold mb-1">Save these recovery codes</p>
            <p className="text-amber-300/80">
              Each code can be used <span className="font-bold">once</span> if you lose access to your authenticator app.
              They will not be shown again.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 p-3 rounded-xl bg-foreground/[0.04] border border-foreground/[0.08]">
            {backupCodes.map((c, i) => (
              <div
                key={i}
                className="text-sm font-mono tabular-nums text-foreground/90 text-center py-1.5 px-2 bg-foreground/[0.04] rounded"
              >
                {c}
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleDownloadCodes}
              className="flex-1 py-2.5 rounded-xl bg-foreground/[0.06] border border-foreground/[0.10] text-foreground/80 font-medium text-xs hover:bg-foreground/[0.10] transition-colors flex items-center justify-center gap-1.5"
            >
              <Shield className="w-3.5 h-3.5" />
              Download .txt
            </button>
            <button
              onClick={handleCopyCodes}
              className="flex-1 py-2.5 rounded-xl bg-foreground/[0.06] border border-foreground/[0.10] text-foreground/80 font-medium text-xs hover:bg-foreground/[0.10] transition-colors flex items-center justify-center gap-1.5"
            >
              <Check className="w-3.5 h-3.5" />
              Copy
            </button>
          </div>

          <label className="flex items-center gap-2 text-xs text-foreground/60 cursor-pointer">
            <input
              type="checkbox"
              checked={backupCodesAcked}
              onChange={(e) => setBackupCodesAcked(e.target.checked)}
              className="w-3.5 h-3.5 accent-primary"
            />
            I have saved my recovery codes in a safe place
          </label>

          <button
            onClick={() => {
              setStep('idle');
              setBackupCodes([]);
              setBackupCodesAcked(false);
              setSuccess('Two-factor authentication enabled!');
              setTimeout(() => setSuccess(null), 4000);
            }}
            disabled={!backupCodesAcked}
            className="w-full py-3 rounded-xl bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 font-medium text-sm hover:bg-emerald-500/25 transition-colors disabled:opacity-30 flex items-center justify-center gap-2"
          >
            <Check className="w-4 h-4" />
            Done
          </button>
        </div>
      )}

      {/* Regenerate codes — require fresh OTP */}
      {step === 'regenerate' && (
        <div className="space-y-3">
          <p className="text-xs text-foreground/50">
            Enter your current authenticator code to generate new recovery codes.
            Old codes will be invalidated.
          </p>
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={regenCode}
            onChange={(e) => setRegenCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="6-digit authenticator code"
            className="w-full bg-foreground/[0.04] border border-foreground/[0.08] rounded-xl px-4 py-3 text-sm text-foreground text-center font-mono tracking-[0.3em] placeholder:text-foreground/30 placeholder:tracking-normal outline-none focus:border-primary/30 transition-colors"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={() => { setStep('idle'); setRegenCode(''); setError(null); }}
              className="flex-1 py-3 rounded-xl bg-foreground/[0.04] border border-foreground/[0.06] text-foreground/50 font-medium text-sm hover:bg-foreground/[0.08] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleRegenerate}
              disabled={isSubmitting || regenCode.length !== 6}
              className="flex-1 py-3 rounded-xl bg-primary/15 border border-primary/25 text-primary font-medium text-sm hover:bg-primary/25 transition-colors disabled:opacity-30 flex items-center justify-center gap-2"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
              {isSubmitting ? 'Generating...' : 'Generate New Codes'}
            </button>
          </div>
        </div>
      )}

      {/* Setup — show QR code and verify */}
      {step === 'verify' && (
        <div className="space-y-4">
          <div className="text-xs text-white/50 space-y-1">
            <p>1. Open <span className="text-white/70 font-medium">Google Authenticator</span> on your phone</p>
            <p>2. Scan the QR code below or enter the key manually</p>
            <p>3. Enter the 6-digit code to confirm</p>
          </div>

          {/* QR Code */}
          <div className="flex justify-center py-3">
            <div className="bg-white rounded-xl p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} alt="2FA QR Code" className="w-[180px] h-[180px]" />
            </div>
          </div>

          {/* Manual Key */}
          <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] p-3">
            <p className="text-[10px] text-white/30 font-mono uppercase tracking-wider mb-1">Manual Entry Key</p>
            <p className="text-sm text-white/80 font-mono break-all select-all">{manualSecret}</p>
          </div>

          {/* OTP Input */}
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={otpCode}
            onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="Enter 6-digit code"
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white text-center font-mono tracking-[0.3em] placeholder:text-white/20 placeholder:tracking-normal outline-none focus:border-primary/30 transition-colors"
            autoFocus
          />

          <div className="flex gap-2">
            <button
              onClick={() => { setStep('idle'); setError(null); setOtpCode(''); }}
              className="flex-1 py-3 rounded-xl bg-white/[0.04] border border-white/[0.06] text-white/50 font-medium text-sm hover:bg-accent-subtle transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleVerify}
              disabled={isSubmitting || otpCode.length !== 6}
              className="flex-1 py-3 rounded-xl bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 font-medium text-sm hover:bg-emerald-500/25 transition-colors disabled:opacity-30 flex items-center justify-center gap-2"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {isSubmitting ? 'Verifying...' : 'Confirm'}
            </button>
          </div>
        </div>
      )}

      {/* Disable — require password + OTP */}
      {step === 'disable' && (
        <div className="space-y-3">
          <p className="text-xs text-white/40">Enter your password and current authenticator code to disable 2FA.</p>

          <div className="relative">
            <input
              type={showDisablePassword ? 'text' : 'password'}
              value={disablePassword}
              onChange={(e) => setDisablePassword(e.target.value)}
              placeholder="Current password"
              autoComplete="current-password"
              className="w-full bg-foreground/[0.04] border border-foreground/[0.08] rounded-xl px-4 py-3 pr-10 text-sm text-foreground placeholder:text-foreground/30 outline-none focus:border-primary/30 transition-colors"
            />
            <button
              type="button"
              onClick={() => setShowDisablePassword(!showDisablePassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 z-10 text-foreground/60 hover:text-foreground"
            >
              {showDisablePassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={disableCode}
            onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="6-digit authenticator code"
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white text-center font-mono tracking-[0.3em] placeholder:text-white/20 placeholder:tracking-normal outline-none focus:border-primary/30 transition-colors"
          />

          <div className="flex gap-2">
            <button
              onClick={() => { setStep('idle'); setError(null); setDisablePassword(''); setDisableCode(''); }}
              className="flex-1 py-3 rounded-xl bg-white/[0.04] border border-white/[0.06] text-white/50 font-medium text-sm hover:bg-accent-subtle transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleDisable}
              disabled={isSubmitting || !disablePassword || disableCode.length !== 6}
              className="flex-1 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 font-medium text-sm hover:bg-[var(--color-error)]/20 transition-colors disabled:opacity-30 flex items-center justify-center gap-2"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
              {isSubmitting ? 'Disabling...' : 'Disable 2FA'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ActiveSessionsSection() {
  const [sessions, setSessions] = useState<SessionData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRevoking, setIsRevoking] = useState<string | null>(null);
  const [isRevokingAll, setIsRevokingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth('/api/auth/sessions');
      const data = await res.json();
      if (data.success) {
        setSessions(data.data || []);
      } else {
        setError(data.error || 'Failed to load sessions');
      }
    } catch {
      setError('Failed to load sessions');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const handleRevoke = async (sessionId: string) => {
    setIsRevoking(sessionId);
    try {
      const res = await fetchWithAuth(`/api/auth/sessions?session_id=${sessionId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setSessions(prev => prev.filter(s => s.id !== sessionId));
      }
    } catch {
      // ignore
    } finally {
      setIsRevoking(null);
    }
  };

  const handleRevokeAll = async () => {
    if (!confirm('Log out of ALL devices including this one? You will need to log in again.')) {
      return;
    }
    setIsRevokingAll(true);
    try {
      const res = await fetchWithAuth('/api/auth/sessions', { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        // Wipe ALL local merchant state — token, store, localStorage —
        // because every session was just revoked server-side. The next
        // navigation must force a fresh login.
        try {
          useMerchantStore.getState().setSessionToken(null);
          useMerchantStore.getState().setMerchantId?.(null);
          useMerchantStore.getState().setMerchantInfo?.(null as any);
        } catch { /* store not hydrated */ }
        try {
          localStorage.removeItem('blip_merchant');
          localStorage.removeItem('merchant_info');
          sessionStorage.removeItem('blip_session_token');
        } catch { /* SSR */ }
        // Hard navigation so the new page tree boots without any cached
        // auth context, which is exactly what we want after a global logout.
        window.location.href = '/merchant?logged_out=all';
      } else {
        alert(data.error || 'Failed to log out of all devices. Please try again.');
        setIsRevokingAll(false);
      }
    } catch {
      alert('Network error. Please check your connection and try again.');
      setIsRevokingAll(false);
    }
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    return `${diffDay}d ago`;
  };

  return (
    <div className="bg-white/[0.02] rounded-2xl border border-white/[0.06] p-5 space-y-4">
      <div className="flex items-center justify-between">
        <label className="text-xs text-white/40 font-mono uppercase tracking-wider">Active Sessions</label>
        {sessions.length > 1 && (
          <button
            onClick={handleRevokeAll}
            disabled={isRevokingAll}
            className="text-[10px] text-red-400/70 hover:text-[var(--color-error)] font-medium transition-colors flex items-center gap-1"
          >
            {isRevokingAll ? <Loader2 className="w-3 h-3 animate-spin" /> : <LogOut className="w-3 h-3" />}
            Logout All Devices
          </button>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 text-white/20 animate-spin" />
        </div>
      )}

      {error && !isLoading && (
        <p className="text-xs text-white/30 text-center py-4">{error}</p>
      )}

      {!isLoading && !error && sessions.length === 0 && (
        <p className="text-xs text-white/30 text-center py-4">No active sessions</p>
      )}

      {!isLoading && sessions.length > 0 && (
        <div className="space-y-2">
          {sessions.map((session, idx) => {
            const isCurrent = idx === 0;
            const isMobile = session.deviceType === 'mobile' || session.deviceType === 'tablet';
            const browserLabel = session.browser
              ? `${session.browser}${session.browserVersion ? ` ${session.browserVersion}` : ''}`
              : session.device || 'Unknown Browser';
            const osLabel = session.os
              ? `${session.os}${session.osVersion ? ` ${session.osVersion}` : ''}`
              : null;
            const deviceLabel = session.deviceName || session.device || 'Unknown Device';

            return (
              <div
                key={session.id}
                className={`p-4 rounded-xl border ${isCurrent ? 'bg-primary/[0.05] border-primary/20' : 'bg-white/[0.03] border-white/[0.04]'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    {/* Device icon */}
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${isCurrent ? 'bg-primary/10' : 'bg-white/[0.06]'}`}>
                      {isMobile
                        ? <Smartphone className={`w-5 h-5 ${isCurrent ? 'text-primary' : 'text-white/40'}`} />
                        : <Monitor className={`w-5 h-5 ${isCurrent ? 'text-primary' : 'text-white/40'}`} />
                      }
                    </div>
                    <div className="min-w-0 flex-1">
                      {/* Row 1: Browser + Current badge */}
                      <div className="flex items-center gap-2">
                        <p className="text-[13px] font-semibold text-white/85 truncate">{browserLabel}</p>
                        {isCurrent && (
                          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-primary/15 text-primary tracking-wide">CURRENT</span>
                        )}
                      </div>

                      {/* Row 2: OS + Device */}
                      <div className="flex items-center gap-2 mt-1">
                        {osLabel && (
                          <span className="text-[11px] text-white/50 font-medium">{osLabel}</span>
                        )}
                        {osLabel && deviceLabel && <span className="text-white/15">·</span>}
                        <span className="text-[11px] text-white/35">{deviceLabel}</span>
                      </div>

                      {/* Row 3: IP + Times */}
                      <div className="flex items-center gap-3 mt-1.5 text-[10px] text-white/30">
                        {session.ip && (
                          <span className="flex items-center gap-1">
                            <Globe className="w-3 h-3 text-white/20" />
                            <span className="font-mono">{session.ip}</span>
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <span className={`w-1.5 h-1.5 rounded-full ${isCurrent ? 'bg-green-400 animate-pulse' : 'bg-white/20'}`} />
                          Active {formatTime(session.lastUsed)}
                        </span>
                        <span>Created {formatTime(session.createdAt)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Revoke button */}
                  {!isCurrent && (
                    <button
                      onClick={() => handleRevoke(session.id)}
                      disabled={isRevoking === session.id}
                      className="px-3 py-1.5 rounded-lg text-[10px] font-medium bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-[var(--color-error)]/20 transition-colors flex-shrink-0 flex items-center gap-1.5 mt-1"
                    >
                      {isRevoking === session.id
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : <LogOut className="w-3 h-3" />
                      }
                      Revoke
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Theme Section Component ──────────────────────────────────────────

const THEME_PREVIEWS: Record<string, { bg: string; sidebar: string; card: string; accent: string; text: string; muted: string }> = {
  dark:    { bg: '#000000', sidebar: '#060606', card: '#0c0c0c', accent: '#F97316', text: '#ffffff', muted: '#525252' },
  navy:    { bg: '#0B1120', sidebar: '#131D35', card: '#161E31', accent: '#38BDF8', text: '#F1F5F9', muted: '#94A3B8' },
  emerald: { bg: '#050705', sidebar: '#0A120E', card: '#0D1410', accent: '#10B981', text: '#ECFDF5', muted: '#6B7280' },
  orchid:  { bg: '#1A1A2E', sidebar: '#16213E', card: '#1F2B4D', accent: '#E94560', text: '#FFFFFF', muted: '#94A3B8' },
  gold:    { bg: '#1C1C1C', sidebar: '#252525', card: '#2D2D2D', accent: '#D4AF37', text: '#E0E0E0', muted: '#888888' },
  clean:   { bg: '#FFFFFF', sidebar: '#F9FAFB', card: '#F3F4F6', accent: '#3B82F6', text: '#111827', muted: '#6B7280' },
  light:   { bg: '#FDF6E3', sidebar: '#EEE8D5', card: '#E0DAC8', accent: '#268BD2', text: '#073642', muted: '#586E75' },
};

function ThemePreviewCard({ colors, isActive }: { colors: typeof THEME_PREVIEWS['dark']; isActive: boolean }) {
  return (
    <div className={`rounded-lg overflow-hidden border-2 transition-all ${isActive ? 'border-[var(--primary)] ring-2 ring-[var(--primary)]/20' : 'border-border hover:border-border-strong'}`}>
      <div className="flex h-[72px]" style={{ backgroundColor: colors.bg }}>
        <div className="w-[28%] flex flex-col p-1 gap-0.5" style={{ backgroundColor: colors.sidebar }}>
          <div className="h-1.5 w-8 rounded-full" style={{ backgroundColor: colors.muted, opacity: 0.4 }} />
          <div className="h-6 rounded" style={{ backgroundColor: colors.card }} />
          <div className="flex gap-1 mt-auto">
            <div className="flex-1 h-3 rounded" style={{ backgroundColor: colors.accent }} />
            <div className="flex-1 h-3 rounded" style={{ backgroundColor: colors.card, border: `1px solid ${colors.muted}33` }} />
          </div>
        </div>
        <div className="flex-1 flex flex-col p-1 gap-0.5">
          <div className="h-1.5 w-12 rounded-full" style={{ backgroundColor: colors.muted, opacity: 0.3 }} />
          <div className="flex-1 rounded" style={{ backgroundColor: colors.card }} />
          <div className="flex gap-0.5">
            <div className="h-2 flex-1 rounded-full" style={{ backgroundColor: colors.accent, opacity: 0.2 }} />
            <div className="h-2 flex-1 rounded-full" style={{ backgroundColor: colors.card }} />
          </div>
        </div>
        <div className="w-[25%] flex flex-col p-1 gap-0.5">
          <div className="h-1.5 w-8 rounded-full" style={{ backgroundColor: colors.muted, opacity: 0.3 }} />
          <div className="space-y-0.5 flex-1">
            <div className="h-2 rounded" style={{ backgroundColor: colors.card }} />
            <div className="h-2 rounded" style={{ backgroundColor: colors.card }} />
            <div className="h-2 rounded" style={{ backgroundColor: colors.card }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ThemeSection() {
  const { theme, setTheme } = useTheme();
  const [previewing, setPreviewing] = useState<Theme | null>(null);
  const originalThemeRef = useRef<Theme>(theme);

  const handlePreview = (themeId: Theme) => {
    if (!previewing) {
      originalThemeRef.current = theme;
    }
    setPreviewing(themeId);
    setTheme(themeId);
  };

  const handleApply = () => {
    setPreviewing(null);
  };

  const handleCancel = () => {
    setTheme(originalThemeRef.current);
    setPreviewing(null);
  };

  const handleSelect = (themeId: Theme) => {
    if (previewing) setPreviewing(null);
    setTheme(themeId);
  };

  return (
    <div className="bg-white/[0.02] rounded-2xl border border-white/[0.06] p-5 space-y-4">
      <div>
        <label className="text-xs text-white/40 font-mono uppercase tracking-wider block">Theme</label>
        <p className="text-[11px] text-white/25 mt-1">Customize the look of your dashboard. Only you see this.</p>
      </div>

      {previewing && (
        <div className="flex items-center justify-between px-3 py-2 rounded-xl" style={{ backgroundColor: 'var(--primary-dim)' }}>
          <span className="text-xs text-white/70">
            Previewing <span className="font-semibold" style={{ color: 'var(--primary)' }}>{THEMES.find(t => t.id === previewing)?.label}</span>
          </span>
          <div className="flex gap-2">
            <button onClick={handleApply} className="px-3 py-1 rounded-lg text-[11px] font-medium text-background" style={{ backgroundColor: 'var(--primary)' }}>
              Apply
            </button>
            <button onClick={handleCancel} className="px-3 py-1 rounded-lg text-[11px] font-medium bg-white/[0.06] text-white/60 hover:text-foreground transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        {THEMES.map(t => {
          const colors = THEME_PREVIEWS[t.id];
          const isActive = (previewing || theme) === t.id;
          return (
            <div key={t.id} className="space-y-1.5">
              <button onClick={() => handleSelect(t.id)} className="w-full text-left cursor-pointer">
                <ThemePreviewCard colors={colors} isActive={isActive} />
              </button>
              <div className="flex items-center justify-between px-0.5">
                <div className="flex items-center gap-1.5">
                  <div className={`w-3 h-3 rounded-full border-2 flex items-center justify-center transition-colors`}
                    style={{ borderColor: isActive ? 'var(--primary)' : 'rgba(255,255,255,0.2)' }}>
                    {isActive && <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--primary)' }} />}
                  </div>
                  <span className={`text-[10px] font-medium ${isActive ? 'text-white/90' : 'text-white/40'}`}>
                    {t.label}
                  </span>
                </div>
                {!isActive && (
                  <button onClick={() => handlePreview(t.id)} className="text-[9px] text-white/30 hover:text-foreground/60 font-medium transition-colors">
                    Preview
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
