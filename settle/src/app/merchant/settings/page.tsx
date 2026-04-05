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
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMerchantStore } from '@/stores/merchantStore';
import { CorridorProviderSettings } from '@/components/merchant/CorridorProviderSettings';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
import { useTheme, THEMES, type Theme } from '@/context/ThemeContext';

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

type SettingsTab = 'profile' | 'account' | 'security' | 'theme' | 'payments' | 'notifications' | 'liquidity' | 'reputation';

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
    if (newPassword !== confirmNewPassword) {
      setPasswordError('Passwords do not match');
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters');
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
          current_password: currentPassword,
          new_password: newPassword,
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

  const handleLogout = () => {
    localStorage.removeItem('blip_merchant');
    localStorage.removeItem('merchant_info');
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
  ];

  return (
    <div className="min-h-screen bg-background text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-2xl border-b border-white/[0.05]">
        <div className="h-[50px] flex items-center px-4 gap-3 max-w-5xl mx-auto">
          <Link
            href="/merchant"
            className="flex items-center gap-2 text-white/60 hover:text-white transition-colors"
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
                      : 'text-white/40 hover:text-white/60 hover:bg-white/[0.03]'
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
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-medium text-red-400/70 hover:text-red-400 hover:bg-red-500/[0.06] transition-all w-full"
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
                          : 'border-white/10 hover:border-white/30'
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
                className="w-full py-3 rounded-xl bg-primary text-black font-bold text-sm hover:bg-primary transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
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
                  className="flex items-center justify-center gap-2 text-sm text-white/40 hover:text-white/60 transition-colors"
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
                    className="p-1.5 hover:bg-white/[0.06] rounded-lg transition-colors shrink-0 ml-2"
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
                      className="p-1.5 hover:bg-white/[0.06] rounded-lg transition-colors shrink-0 ml-2"
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
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 pr-10 text-sm text-white placeholder:text-white/20 outline-none focus:border-primary/30 transition-colors"
                  />
                  <button
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-white/30 hover:text-white/50"
                  >
                    {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                <div className="relative">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="New password (min 6 chars)"
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 pr-10 text-sm text-white placeholder:text-white/20 outline-none focus:border-primary/30 transition-colors"
                  />
                  <button
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-white/30 hover:text-white/50"
                  >
                    {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                <input
                  type="password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  placeholder="Confirm new password"
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 outline-none focus:border-primary/30 transition-colors"
                />

                <button
                  onClick={handleChangePassword}
                  disabled={isChangingPassword || !currentPassword || !newPassword || !confirmNewPassword}
                  className="w-full py-3 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white/80 font-medium text-sm hover:bg-white/[0.10] transition-colors disabled:opacity-30 flex items-center justify-center gap-2"
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
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 font-medium text-sm hover:bg-red-500/20 transition-colors"
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
                <p className="text-sm text-white/40">Manage your bank accounts for fiat transfers</p>
              </div>

              {/* Existing Bank Accounts */}
              <div className="space-y-3">
                {bankAccounts.length === 0 && !showAddBank && (
                  <div className="bg-white/[0.02] rounded-2xl border border-white/[0.06] p-8 text-center">
                    <CreditCard className="w-10 h-10 text-white/10 mx-auto mb-3" />
                    <p className="text-sm text-white/40 mb-4">No bank accounts added yet</p>
                    <button
                      onClick={() => setShowAddBank(true)}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/10 border border-primary/20 text-sm text-primary font-medium hover:bg-primary/20 transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                      Add Bank Account
                    </button>
                  </div>
                )}

                {bankAccounts.map((bank) => (
                  <div key={bank.id} className="bg-white/[0.02] rounded-2xl border border-white/[0.06] p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-white/[0.06] flex items-center justify-center">
                          <CreditCard className="w-5 h-5 text-white/40" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-white/80">{bank.bank_name}</p>
                          <p className="text-xs text-white/40">{bank.account_name}</p>
                          <p className="text-xs text-white/30 font-mono mt-0.5">{bank.iban}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteBank(bank.id)}
                        className="p-2 text-white/20 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}

                {bankAccounts.length > 0 && !showAddBank && (
                  <button
                    onClick={() => setShowAddBank(true)}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-white/[0.08] text-sm text-white/30 hover:text-white/50 hover:border-white/[0.12] transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    Add Another Account
                  </button>
                )}
              </div>

              {/* Add Bank Form */}
              {showAddBank && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white/[0.02] rounded-2xl border border-white/[0.06] p-5 space-y-4"
                >
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-white/40 font-mono uppercase tracking-wider">Add Bank Account</label>
                    <button
                      onClick={() => setShowAddBank(false)}
                      className="text-xs text-white/30 hover:text-white/50 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>

                  <input
                    type="text"
                    value={newBank.bank_name}
                    onChange={(e) => setNewBank(prev => ({ ...prev, bank_name: e.target.value }))}
                    placeholder="Bank name (e.g. Emirates NBD)"
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 outline-none focus:border-primary/30 transition-colors"
                  />

                  <input
                    type="text"
                    value={newBank.account_name}
                    onChange={(e) => setNewBank(prev => ({ ...prev, account_name: e.target.value }))}
                    placeholder="Account holder name"
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 outline-none focus:border-primary/30 transition-colors"
                  />

                  <input
                    type="text"
                    value={newBank.iban}
                    onChange={(e) => setNewBank(prev => ({ ...prev, iban: e.target.value.toUpperCase() }))}
                    placeholder="IBAN (e.g. AE07033...)"
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white font-mono placeholder:text-white/20 outline-none focus:border-primary/30 transition-colors"
                  />

                  <button
                    onClick={handleAddBank}
                    disabled={isAddingBank || !newBank.bank_name || !newBank.account_name || !newBank.iban}
                    className="w-full py-3 rounded-xl bg-primary text-black font-bold text-sm hover:bg-primary transition-colors disabled:opacity-30 flex items-center justify-center gap-2"
                  >
                    {isAddingBank && <Loader2 className="w-4 h-4 animate-spin" />}
                    {isAddingBank ? 'Adding...' : 'Add Bank Account'}
                  </button>
                </motion.div>
              )}
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
                className="w-full py-3 rounded-xl bg-primary text-black font-bold text-sm hover:bg-primary transition-colors flex items-center justify-center gap-2"
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

          {/* Mobile Logout */}
          <div className="md:hidden mt-8 pt-6 border-t border-white/[0.04]">
            <button
              onClick={handleLogout}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 font-medium text-sm hover:bg-red-500/20 transition-colors"
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
  lastUsed: string;
  createdAt: string;
  expiresAt: string;
}

function TwoFactorSection({ merchantId }: { merchantId: string | null }) {
  const [is2FAEnabled, setIs2FAEnabled] = useState(false);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [step, setStep] = useState<'idle' | 'setup' | 'verify' | 'disable'>('idle');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [manualSecret, setManualSecret] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
        setStep('idle');
        setSuccess('Two-factor authentication enabled!');
        setOtpCode('');
        setTimeout(() => setSuccess(null), 4000);
      } else {
        setError(data.error || 'Invalid code');
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
          <button
            onClick={() => { setStep('disable'); setError(null); }}
            className="w-full py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 font-medium text-sm hover:bg-red-500/20 transition-colors flex items-center justify-center gap-2"
          >
            <Shield className="w-4 h-4" />
            Disable 2FA
          </button>
        ) : (
          <button
            onClick={handleSetup}
            disabled={isSubmitting}
            className="w-full py-3 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white/80 font-medium text-sm hover:bg-white/[0.10] transition-colors disabled:opacity-30 flex items-center justify-center gap-2"
          >
            {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
            {isSubmitting ? 'Setting up...' : 'Enable 2FA'}
          </button>
        )
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
              className="flex-1 py-3 rounded-xl bg-white/[0.04] border border-white/[0.06] text-white/50 font-medium text-sm hover:bg-white/[0.08] transition-colors"
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

          <input
            type="password"
            value={disablePassword}
            onChange={(e) => setDisablePassword(e.target.value)}
            placeholder="Current password"
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 outline-none focus:border-primary/30 transition-colors"
          />

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
              className="flex-1 py-3 rounded-xl bg-white/[0.04] border border-white/[0.06] text-white/50 font-medium text-sm hover:bg-white/[0.08] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleDisable}
              disabled={isSubmitting || !disablePassword || disableCode.length !== 6}
              className="flex-1 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 font-medium text-sm hover:bg-red-500/20 transition-colors disabled:opacity-30 flex items-center justify-center gap-2"
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
    setIsRevokingAll(true);
    try {
      const res = await fetchWithAuth('/api/auth/sessions', { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setSessions([]);
      }
    } catch {
      // ignore
    } finally {
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
            className="text-[10px] text-red-400/70 hover:text-red-400 font-medium transition-colors flex items-center gap-1"
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
            return (
              <div
                key={session.id}
                className={`p-3 rounded-xl border ${isCurrent ? 'bg-primary/[0.05] border-primary/20' : 'bg-white/[0.03] border-white/[0.04]'}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${isCurrent ? 'bg-primary/10' : 'bg-white/[0.06]'}`}>
                      {session.device?.includes('Mobile') || session.device?.includes('iPhone') || session.device?.includes('Android')
                        ? <Smartphone className={`w-4 h-4 ${isCurrent ? 'text-primary' : 'text-white/40'}`} />
                        : <Monitor className={`w-4 h-4 ${isCurrent ? 'text-primary' : 'text-white/40'}`} />
                      }
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-medium text-white/80 truncate">{session.device || 'Unknown Device'}</p>
                        {isCurrent && (
                          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">Current</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-[10px] text-white/35">
                        {session.ip && (
                          <span className="flex items-center gap-1">
                            <Globe className="w-2.5 h-2.5" />
                            {session.ip}
                          </span>
                        )}
                        <span>Active {formatTime(session.lastUsed)}</span>
                        <span>Created {formatTime(session.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                  {!isCurrent && (
                    <button
                      onClick={() => handleRevoke(session.id)}
                      disabled={isRevoking === session.id}
                      className="px-3 py-1.5 rounded-lg text-[10px] font-medium bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors flex-shrink-0 flex items-center gap-1.5"
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
    <div className={`rounded-lg overflow-hidden border-2 transition-all ${isActive ? 'border-[var(--primary)] ring-2 ring-[var(--primary)]/20' : 'border-white/[0.08] hover:border-white/[0.15]'}`}>
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
            <button onClick={handleApply} className="px-3 py-1 rounded-lg text-[11px] font-medium text-black" style={{ backgroundColor: 'var(--primary)' }}>
              Apply
            </button>
            <button onClick={handleCancel} className="px-3 py-1 rounded-lg text-[11px] font-medium bg-white/[0.06] text-white/60 hover:text-white transition-colors">
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
                  <button onClick={() => handlePreview(t.id)} className="text-[9px] text-white/30 hover:text-white/60 font-medium transition-colors">
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
