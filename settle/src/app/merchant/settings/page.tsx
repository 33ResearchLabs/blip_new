'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
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
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMerchantStore } from '@/stores/merchantStore';
import { CorridorProviderSettings } from '@/components/merchant/CorridorProviderSettings';

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

type SettingsTab = 'profile' | 'account' | 'payments' | 'notifications' | 'liquidity';

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
      const res = await fetch(`/api/merchant/${id}`);
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
        const res = await fetch(`/api/users/${id}/bank-accounts`);
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

      const res = await fetch(`/api/merchant/${id}`, {
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
      const res = await fetch('/api/auth/merchant', {
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
      const res = await fetch(`/api/users/${id}/bank-accounts`, {
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
      const res = await fetch(`/api/users/${id}/bank-accounts?bank_id=${bankId}`, {
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

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
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
      <div className="min-h-screen bg-[#060606] text-white flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-white/40" />
      </div>
    );
  }

  const tabs: { id: SettingsTab; label: string; icon: any }[] = [
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'account', label: 'Account', icon: Shield },
    { id: 'payments', label: 'Payments', icon: CreditCard },
    { id: 'notifications', label: 'Alerts', icon: Bell },
    { id: 'liquidity', label: 'Liquidity', icon: Droplets },
  ];

  return (
    <div className="min-h-screen bg-[#060606] text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-black/60 backdrop-blur-2xl border-b border-white/[0.05]">
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
                  <div className="w-16 h-16 rounded-full border-2 border-white/20 overflow-hidden shrink-0">
                    {selectedAvatar ? (
                      <img src={selectedAvatar} alt="Avatar" className="w-full h-full object-cover" />
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
                      className={`aspect-square rounded-full overflow-hidden border-2 transition-all ${
                        selectedAvatar === url
                          ? 'border-orange-500 ring-2 ring-orange-500/30 scale-110'
                          : 'border-white/10 hover:border-white/30'
                      }`}
                    >
                      <img src={url} alt={`Avatar ${i + 1}`} className="w-full h-full object-cover" />
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
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 outline-none focus:border-orange-500/30 transition-colors"
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
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 outline-none focus:border-orange-500/30 transition-colors"
                  />
                </div>

                <div>
                  <label className="text-xs text-white/40 font-mono uppercase tracking-wider mb-2 block">Bio</label>
                  <textarea
                    value={bio}
                    onChange={(e) => setBio(e.target.value.slice(0, 200))}
                    placeholder="Tell traders about yourself..."
                    rows={3}
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 outline-none focus:border-orange-500/30 resize-none transition-colors"
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
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 outline-none focus:border-orange-500/30 transition-colors"
                  />
                </div>
              </div>

              {/* Save Button */}
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={handleSaveProfile}
                disabled={isSaving}
                className="w-full py-3 rounded-xl bg-orange-500 text-black font-bold text-sm hover:bg-orange-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
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
                <p className="text-sm text-white/40">Account details and security</p>
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
                    onClick={() => copyToClipboard(merchant?.id || merchantId || '', 'merchant_id')}
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
                      onClick={() => copyToClipboard(merchant.wallet_address, 'wallet')}
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
                    <p className="text-lg font-bold text-white/80 font-mono">{merchant?.rating?.toFixed(2) || '5.00'}</p>
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
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 pr-10 text-sm text-white placeholder:text-white/20 outline-none focus:border-orange-500/30 transition-colors"
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
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 pr-10 text-sm text-white placeholder:text-white/20 outline-none focus:border-orange-500/30 transition-colors"
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
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 outline-none focus:border-orange-500/30 transition-colors"
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
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-orange-500/10 border border-orange-500/20 text-sm text-orange-400 font-medium hover:bg-orange-500/20 transition-colors"
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
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 outline-none focus:border-orange-500/30 transition-colors"
                  />

                  <input
                    type="text"
                    value={newBank.account_name}
                    onChange={(e) => setNewBank(prev => ({ ...prev, account_name: e.target.value }))}
                    placeholder="Account holder name"
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 outline-none focus:border-orange-500/30 transition-colors"
                  />

                  <input
                    type="text"
                    value={newBank.iban}
                    onChange={(e) => setNewBank(prev => ({ ...prev, iban: e.target.value.toUpperCase() }))}
                    placeholder="IBAN (e.g. AE07033...)"
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white font-mono placeholder:text-white/20 outline-none focus:border-orange-500/30 transition-colors"
                  />

                  <button
                    onClick={handleAddBank}
                    disabled={isAddingBank || !newBank.bank_name || !newBank.account_name || !newBank.iban}
                    className="w-full py-3 rounded-xl bg-orange-500 text-black font-bold text-sm hover:bg-orange-400 transition-colors disabled:opacity-30 flex items-center justify-center gap-2"
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
                          ? 'bg-orange-500'
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
                className="w-full py-3 rounded-xl bg-orange-500 text-black font-bold text-sm hover:bg-orange-400 transition-colors flex items-center justify-center gap-2"
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
                <p className="text-sm text-white/40">Earn fees by bridging sAED to AED for other traders</p>
              </div>

              <div className="bg-white/[0.02] rounded-2xl border border-white/[0.06] p-5">
                <CorridorProviderSettings merchantId={merchantId || null} />
              </div>
            </div>
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
