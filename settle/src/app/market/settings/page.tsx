"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { copyToClipboard } from "@/lib/clipboard";
import { useOnboarding } from "@/contexts/OnboardingContext";
import {
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
  Pencil,
  Zap,
  Droplets,
  Monitor,
  Smartphone,
  Globe,
  Palette,
  Lock,
  Trophy,
  BookOpen,
  AtSign,
  X,
  HelpCircle,
} from "lucide-react";
import { MerchantSupportSheet } from "@/components/merchant/MerchantSupportSheet";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMerchantStore } from "@/stores/merchantStore";
import { CorridorProviderSettings } from "@/components/merchant/CorridorProviderSettings";
import { MerchantNavbar } from "@/components/merchant/MerchantNavbar";
import { WalletLedger } from "@/components/merchant/WalletLedger";
import { PaymentMethodModal, PaymentMethodInlineForm } from "@/components/merchant/PaymentMethodModal";
import { PhoneVerificationModal } from "@/components/merchant/PhoneVerificationModal";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { useCorridorPrices } from "@/hooks/useCorridorPrices";
import { clearAuthStorageOnLogout } from "@/lib/auth/logoutCleanup";
import { useTheme, THEMES, type Theme } from "@/context/ThemeContext";
import {
  Building2,
  Wallet as WalletIconLucide,
  DollarSign,
  Star,
  Mail,
  IdCard,
  Activity,
  Calendar,
  Volume2,
  ShoppingCart,
  MessageCircle,
  Save,
  ShieldCheck,
  BarChart3,
  PieChart,
  Database,
  Heart,
  Medal,
  Award,
  Clock,
  TrendingUp,
} from "lucide-react";

type MerchantPaymentMethod = {
  id: string;
  type: "bank" | "cash" | "crypto" | "card" | "mobile" | "upi";
  name: string;
  details: string;
  is_default: boolean;
};

const PM_TYPE_META: Record<
  MerchantPaymentMethod["type"],
  { label: string; Icon: any; gradient: string; border: string; text: string }
> = {
  bank: {
    label: "Bank Account",
    Icon: Building2,
    gradient: "from-white/[0.06] to-white/[0.02]",
    border: "border-white/[0.12]",
    text: "text-white/60",
  },
  cash: {
    label: "Cash Meeting",
    Icon: DollarSign,
    gradient: "from-white/[0.06] to-white/[0.02]",
    border: "border-white/[0.12]",
    text: "text-white/60",
  },
  crypto: {
    label: "Crypto Wallet",
    Icon: WalletIconLucide,
    gradient: "from-white/[0.06] to-white/[0.02]",
    border: "border-white/[0.12]",
    text: "text-white/60",
  },
  card: {
    label: "Card",
    Icon: CreditCard,
    gradient: "from-white/[0.06] to-white/[0.02]",
    border: "border-white/[0.12]",
    text: "text-white/60",
  },
  mobile: {
    label: "Mobile Money",
    Icon: Smartphone,
    gradient: "from-white/[0.06] to-white/[0.02]",
    border: "border-white/[0.12]",
    text: "text-white/60",
  },
  upi: {
    label: "UPI",
    Icon: Smartphone,
    gradient: "from-white/[0.06] to-white/[0.02]",
    border: "border-white/[0.12]",
    text: "text-white/60",
  },
};

// Avatar presets (same as profile modal)
const PRESET_AVATARS = [
  "https://api.dicebear.com/9.x/adventurer/svg?seed=Felix",
  "https://api.dicebear.com/9.x/adventurer/svg?seed=Aneka",
  "https://api.dicebear.com/9.x/adventurer/svg?seed=Max",
  "https://api.dicebear.com/9.x/adventurer/svg?seed=Luna",
  "https://api.dicebear.com/9.x/adventurer/svg?seed=Charlie",
  "https://api.dicebear.com/9.x/adventurer/svg?seed=Bella",
  "https://api.dicebear.com/9.x/adventurer/svg?seed=Oliver",
  "https://api.dicebear.com/9.x/adventurer/svg?seed=Milo",
  "https://api.dicebear.com/9.x/adventurer/svg?seed=Sophie",
  "https://api.dicebear.com/9.x/adventurer/svg?seed=Leo",
  "https://api.dicebear.com/9.x/avataaars/svg?seed=John",
  "https://api.dicebear.com/9.x/avataaars/svg?seed=Sarah",
  "https://api.dicebear.com/9.x/avataaars/svg?seed=Mike",
  "https://api.dicebear.com/9.x/avataaars/svg?seed=Emma",
  "https://api.dicebear.com/9.x/avataaars/svg?seed=David",
  "https://api.dicebear.com/9.x/avataaars/svg?seed=Alice",
  "https://api.dicebear.com/9.x/bottts/svg?seed=Robot1",
  "https://api.dicebear.com/9.x/bottts/svg?seed=Robot2",
  "https://api.dicebear.com/9.x/bottts/svg?seed=Robot3",
  "https://api.dicebear.com/9.x/bottts/svg?seed=Robot4",
  "https://api.dicebear.com/9.x/pixel-art/svg?seed=Pixel1",
  "https://api.dicebear.com/9.x/pixel-art/svg?seed=Pixel2",
  "https://api.dicebear.com/9.x/pixel-art/svg?seed=Pixel3",
  "https://api.dicebear.com/9.x/pixel-art/svg?seed=Pixel4",
];

type SettingsTab =
  | "profile"
  | "account"
  | "security"
  | "theme"
  | "payments"
  | "rates"
  | "notifications"
  | "liquidity"
  | "reputation"
  | "ledger";

export default function MerchantSettingsPage({
  onClose,
  onOpenWallet,
}: { onClose?: () => void; onOpenWallet?: () => void } = {}) {
  const router = useRouter();
  const merchantId = useMerchantStore((s) => s.merchantId);
  const merchantInfo = useMerchantStore((s) => s.merchantInfo);
  const setMerchantInfo = useMerchantStore((s) => s.setMerchantInfo);
  const isLoggedIn = useMerchantStore((s) => s.isLoggedIn);

  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    (searchParams.get("tab") as SettingsTab) || "profile"
  );
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(!merchantInfo);
  const [merchant, setMerchant] = useState<any>(merchantInfo ?? null);

  // Profile form — seeded from store so the page renders instantly on first open
  const [displayName, setDisplayName] = useState<string>(
    (merchantInfo as any)?.display_name || "",
  );
  const [bio, setBio] = useState<string>((merchantInfo as any)?.bio || "");
  const [buyRate, setBuyRate] = useState<string>((merchantInfo as any)?.buy_rate?.toString() || "");
  const [sellRate, setSellRate] = useState<string>((merchantInfo as any)?.sell_rate?.toString() || "");
  const [rateSaving, setRateSaving] = useState(false);
  const [rateSaved, setRateSaved] = useState(false);
  const [rateError, setRateError] = useState<string | null>(null);
  const corridorPrices = useCorridorPrices();
  const [phone, setPhone] = useState<string>(
    (merchantInfo as any)?.phone || "",
  );
  const [phoneVerified, setPhoneVerified] = useState<boolean>(
    Boolean((merchantInfo as any)?.phone_verified),
  );
  const [showPhoneVerify, setShowPhoneVerify] = useState(false);
  const [showSupportSheet, setShowSupportSheet] = useState(false);
  const [selectedAvatar, setSelectedAvatar] = useState<string | null>(
    (merchantInfo as any)?.avatar_url || null,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState("");

  // First-time username editor (Account tab). Visible only when the
  // merchant doesn't yet have a username — once set it falls back to
  // the read-only display. Uses PATCH /api/merchant/username (token-
  // auth, no wallet signature required) with the same live-availability
  // check the onboarding modal had.
  // Onboarding signal — when usernameSet is false, we treat the username
  // as "not yet claimed" even if merchants.username has an auto-generated
  // value. Surfaces the editable form so the merchant can run the
  // PATCH /api/merchant/username that flips username_customized_at.
  const { status: onboardingStatus, refresh: refreshOnboarding } = useOnboarding();
  const usernameClaimed = onboardingStatus?.conditions?.usernameSet ?? false;

  const [usernameInput, setUsernameInput] = useState("");

  // If the merchant already has an auto-generated username but hasn't
  // claimed/customized it, prefill the input so they can just hit Set
  // to flip username_customized_at (the onboarding gate). The form
  // would otherwise look empty even though the displayed username is
  // already valid — confusing UX.
  useEffect(() => {
    if (!usernameClaimed && merchant?.username && usernameInput === "") {
      setUsernameInput(merchant.username);
    }
  }, [usernameClaimed, merchant?.username, usernameInput]);
  const [usernameAvailability, setUsernameAvailability] = useState<
    | { kind: "idle" }
    | { kind: "checking" }
    | { kind: "available" }
    | { kind: "unavailable"; reason: string }
  >({ kind: "idle" });
  const [usernameSaving, setUsernameSaving] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  // Flips the read-only username row (text + pen icon) into the editable
  // input + Save form. Default false so a username already on file renders
  // as a quiet read-only row by default — matching the Display Name pattern.
  const [isEditingUsername, setIsEditingUsername] = useState(false);

  const RESERVED_USERNAMES = [
    'blip', 'blipmoney', 'blipapp', 'blip_money', 'blip_app',
    'blipsupport', 'blipceo', 'blipteam', 'blipofficial', 'bliphelp',
    'blip_support', 'blip_ceo', 'blip_team', 'blip_official', 'blip_help',
    'support', 'admin', 'help', 'official', 'team', 'staff', 'mod',
    'moderator', 'customercare', 'customer_care',
  ];

  useEffect(() => {
    const trimmed = usernameInput.trim();
    if (trimmed.length === 0) {
      setUsernameAvailability({ kind: "idle" });
      return;
    }
    if (trimmed.length < 4) {
      setUsernameAvailability({ kind: "unavailable", reason: "At least 4 characters required" });
      return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
      setUsernameAvailability({ kind: "unavailable", reason: "Letters, numbers and underscores only" });
      return;
    }
    if (RESERVED_USERNAMES.includes(trimmed.toLowerCase())) {
      setUsernameAvailability({ kind: "unavailable", reason: "This username is reserved" });
      return;
    }
    setUsernameAvailability({ kind: "checking" });
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await fetchWithAuth(
          `/api/merchant/username?check=${encodeURIComponent(trimmed)}`,
        );
        if (cancelled) return;
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
          setUsernameAvailability({
            kind: "unavailable",
            reason: json?.error || "Could not verify",
          });
          return;
        }
        if (json.data?.available) {
          setUsernameAvailability({ kind: "available" });
        } else {
          setUsernameAvailability({
            kind: "unavailable",
            reason: json.data?.reason || "Username already taken",
          });
        }
      } catch {
        if (!cancelled)
          setUsernameAvailability({
            kind: "unavailable",
            reason: "Network error",
          });
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [usernameInput]);

  const saveUsername = useCallback(async () => {
    const trimmed = usernameInput.trim();
    if (
      usernameSaving ||
      usernameAvailability.kind !== "available" ||
      trimmed.length === 0
    )
      return;
    setUsernameError(null);
    setUsernameSaving(true);
    try {
      const res = await fetchWithAuth("/api/merchant/username", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: trimmed }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setUsernameError(
          json?.error || json?.errors?.[0] || "Failed to save username",
        );
        return;
      }
      // Sync display_name + business_name to the new username so both
      // fields always show the same value — one name, no divergence.
      const id = merchantId || merchant?.id;
      if (id) {
        await fetchWithAuth(`/api/merchant/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ display_name: trimmed, business_name: trimmed }),
        }).catch(() => null);
      }
      setMerchant((prev: any) => (prev ? { ...prev, username: trimmed, display_name: trimmed } : prev));
      setMerchantInfo((prev: any) =>
        prev ? { ...prev, username: trimmed, display_name: trimmed } : prev,
      );
      setDisplayName(trimmed);
      setUsernameInput("");
      setUsernameAvailability({ kind: "idle" });
      setIsEditingUsername(false);
      void refreshOnboarding();
    } catch {
      setUsernameError("Network error — try again.");
    } finally {
      setUsernameSaving(false);
    }
  }, [usernameInput, usernameAvailability, usernameSaving, setMerchantInfo, refreshOnboarding]);

  // Password change
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  // Reputation
  const [repData, setRepData] = useState<any>(null);
  const [repLoading, setRepLoading] = useState(false);

  // Payment methods
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [showAddBank, setShowAddBank] = useState(false);
  const [newBank, setNewBank] = useState({
    bank_name: "",
    account_name: "",
    iban: "",
  });
  const [isAddingBank, setIsAddingBank] = useState(false);

  // Merchant payment methods (multi-type: bank / cash / crypto / card / mobile)
  const [paymentMethods, setPaymentMethods] = useState<MerchantPaymentMethod[]>(
    [],
  );
  const [isLoadingMethods, setIsLoadingMethods] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  // The full method object that PaymentMethodModal should open in edit
  // mode. `null` means the modal opens in add mode. Set when the merchant
  // clicks the Pencil on a row, cleared when the modal closes.
  const [editingPaymentMethod, setEditingPaymentMethod] = useState<MerchantPaymentMethod | null>(null);

  // Notifications
  const [notifSettings, setNotifSettings] = useState({
    sound: true,
    orderAlerts: true,
    chatMessages: true,
    systemUpdates: true,
  });

  // Copied state
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Redirect if not logged in.
  //
  // Auth state is whatever the cookie-bound /api/auth/me restore wrote to
  // the store on app boot (see useDashboardAuth). No localStorage probe —
  // identity is the cookie's signed token, not anything the client wrote.
  useEffect(() => {
    if (!merchantId && !isLoggedIn) {
      router.replace("/market/login");
    }
  }, [merchantId, isLoggedIn, router]);

  // Fetch merchant data
  const fetchMerchant = useCallback(async () => {
    // Identity comes from the store (populated by useDashboardAuth's
    // /api/auth/me restore). When it's missing we just skip — the redirect
    // effect above will bounce the user to /merchant/login.
    const id = merchantId;
    if (!id) return;

    try {
      const res = await fetchWithAuth(`/api/merchant/${id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setMerchant(data.data);
          setDisplayName(data.data.display_name || "");
          setBio(data.data.bio || "");
          if (data.data.buy_rate != null) setBuyRate(String(data.data.buy_rate));
          if (data.data.sell_rate != null) setSellRate(String(data.data.sell_rate));
          setPhone(data.data.phone || "");
          setPhoneVerified(Boolean(data.data.phone_verified));
          setSelectedAvatar(data.data.avatar_url || null);
        }
      }
    } catch (err) {
      console.error("Failed to fetch merchant:", err);
    } finally {
      setIsLoading(false);
    }
  }, [merchantId]);

  useEffect(() => {
    fetchMerchant();
  }, [fetchMerchant]);

  // Load notification settings from localStorage and sync sound pref into
  // the runtime store. Without the store sync, useSounds (which gates on
  // merchantStore.soundEnabled) ignored the saved preference entirely.
  useEffect(() => {
    let soundFromSaved: boolean | null = null;
    const saved = localStorage.getItem("blip_notif_settings");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setNotifSettings(parsed);
        if (typeof parsed?.sound === "boolean") soundFromSaved = parsed.sound;
      } catch {}
    }

    const soundPref = localStorage.getItem("blip_sound_enabled");
    if (soundPref !== null) {
      const v = soundPref === "true";
      setNotifSettings((prev) => ({ ...prev, sound: v }));
      soundFromSaved = v;
    }

    if (soundFromSaved !== null) {
      useMerchantStore.getState().setSoundEnabled(soundFromSaved);
    }
  }, []);

  // Fetch bank accounts
  useEffect(() => {
    const fetchBanks = async () => {
      const id = merchantId;
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
    setSaveError("");
    setSaveSuccess(false);

    try {
      const updates: any = {};
      if (displayName !== (merchant?.display_name || "")) {
        updates.display_name = displayName;
        updates.business_name = displayName;
      }
      if (bio !== (merchant?.bio || "")) updates.bio = bio;
      if (phone !== (merchant?.phone || "")) updates.phone = phone;
      if (selectedAvatar && selectedAvatar !== merchant?.avatar_url)
        updates.avatar_url = selectedAvatar;

      if (Object.keys(updates).length === 0) {
        setSaveError("No changes to save");
        setIsSaving(false);
        return;
      }

      const res = await fetchWithAuth(`/api/merchant/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update profile");
      }

      const data = await res.json();
      setMerchant(data.data);
      // Saving a changed phone clears verification server-side (see
      // updateMerchant); mirror that here so the "Verified" badge drops
      // immediately instead of vouching for an unconfirmed number.
      setPhoneVerified(Boolean(data.data?.phone_verified));
      setSaveSuccess(true);

      // Update the in-memory store. The durable copy is the row in the
      // merchants table that the API call above just updated; on next load
      // /api/auth/me re-reads it from the DB. No localStorage mirror.
      setMerchantInfo((prev: any) => ({ ...prev, ...updates }));

      void refreshOnboarding();

      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveRates = async () => {
    const id = merchantId || merchant?.id;
    if (!id) return;
    const buy = parseFloat(buyRate);
    const sell = parseFloat(sellRate);
    if (isNaN(buy) || buy < 50 || buy > 200) { setRateError("Buy rate must be between 50 and 200"); return; }
    if (isNaN(sell) || sell < 50 || sell > 200) { setRateError("Sell rate must be between 50 and 200"); return; }
    if (sell < buy) { setRateError("Sell rate should be ≥ buy rate"); return; }
    setRateSaving(true); setRateError(null);
    try {
      const res = await fetchWithAuth(`/api/merchant/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buy_rate: buy, sell_rate: sell }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Failed to save rates"); }
      const data = await res.json();
      setMerchant(data.data);
      setMerchantInfo((prev: any) => ({ ...prev, buy_rate: buy, sell_rate: sell }));
      setRateSaved(true);
      setTimeout(() => setRateSaved(false), 3000);
    } catch (err) {
      setRateError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setRateSaving(false);
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
          : "";
      setPasswordError(`Passwords do not match${lenDiff}`);
      return;
    }
    if (trimmedNew.length < 8) {
      setPasswordError("Password must be at least 8 characters");
      return;
    }
    if (trimmedNew.length > 24) {
      setPasswordError("Password must be at most 24 characters");
      return;
    }

    setIsChangingPassword(true);
    setPasswordError("");
    setPasswordSuccess(false);

    try {
      const res = await fetchWithAuth("/api/auth/merchant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "change_password",
          merchant_id: merchantId || merchant?.id,
          current_password: trimmedCurrent,
          new_password: trimmedNew,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Password change failed");
      }

      setPasswordSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      setTimeout(() => setPasswordSuccess(false), 3000);
    } catch (err) {
      setPasswordError(
        err instanceof Error ? err.message : "Failed to change password",
      );
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
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method_id: methodId }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setPaymentMethods((prev) =>
          prev.map((m) => ({ ...m, is_default: m.id === methodId })),
        );
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
        { method: "DELETE" },
      );
      const json = await res.json();
      if (res.ok && json.success) {
        setPaymentMethods((prev) => prev.filter((m) => m.id !== methodId));
      }
    } catch {
      // Silent fail
    }
  };

  // Pencil click → open the rich PaymentMethodModal in edit mode pre-filled
  // with this method. The modal handles validation, parsing, and the PUT.
  const startEditMethod = (method: MerchantPaymentMethod) => {
    // Settings page uses an inline right-rail form (PaymentMethodInlineForm)
    // — clicking Edit on a row just hands the method to that form via state.
    // The modal wrapper still exists for callers outside Settings that
    // depend on it, so we don't open it here.
    setEditingPaymentMethod(method);
  };

  // Fetch merchant payment methods when Payments tab opens
  useEffect(() => {
    if (activeTab === "payments") {
      fetchPaymentMethods();
    }
  }, [activeTab, fetchPaymentMethods]);

  const handleAddBank = async () => {
    if (!newBank.bank_name || !newBank.account_name || !newBank.iban) return;
    setIsAddingBank(true);
    try {
      const id = merchantId || merchant?.id;
      const res = await fetchWithAuth(`/api/users/${id}/bank-accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newBank),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setBankAccounts((prev) => [...prev, data.data]);
          setNewBank({ bank_name: "", account_name: "", iban: "" });
          setShowAddBank(false);
        }
      }
    } catch (err) {
      console.error("Failed to add bank:", err);
    } finally {
      setIsAddingBank(false);
    }
  };

  const handleDeleteBank = async (bankId: string) => {
    try {
      const id = merchantId || merchant?.id;
      const res = await fetchWithAuth(
        `/api/users/${id}/bank-accounts?bank_id=${bankId}`,
        {
          method: "DELETE",
        },
      );
      if (res.ok) {
        setBankAccounts((prev) => prev.filter((b) => b.id !== bankId));
      }
    } catch {}
  };

  const handleSaveNotifications = () => {
    localStorage.setItem("blip_notif_settings", JSON.stringify(notifSettings));
    localStorage.setItem("blip_sound_enabled", String(notifSettings.sound));
    // Apply sound pref to the runtime store immediately so the change
    // takes effect without a page reload.
    useMerchantStore.getState().setSoundEnabled(notifSettings.sound);
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
      await fetchWithAuth("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
    } catch {
      /* offline / network error — proceed with local logout */
    }

    try {
      // In-memory mirrors only — the durable auth state was the cookie
      // pair, which the /api/auth/logout call above just cleared.
      useMerchantStore.getState().setSessionToken(null);
      useMerchantStore.getState().setMerchantId?.(null);
      useMerchantStore.getState().setMerchantInfo?.(null as any);
    } catch {
      /* store not hydrated */
    }
    // Sweep auth/identity keys + any unlocked wallet session material
    // before the redirect. The merchant's encrypted blob stays in place
    // for re-unlock on next login.
    clearAuthStorageOnLogout();
    window.location.href = "/market";
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background text-white flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-white/40" />
      </div>
    );
  }

  // Tabs are split into two groups so the sidebar can render `ACCOUNT` and
  // `PREFERENCES` section headers (matching the design system mock the
  // settings page is converging on). Order within each group is preserved
  // from before — Profile first under Account, Alerts first under Prefs.
  const accountTabs: { id: SettingsTab; label: string; icon: any }[] = [
    { id: "profile", label: "Profile", icon: User },
    { id: "account", label: "Account", icon: Shield },
    { id: "security", label: "Security", icon: Lock },
    { id: "theme", label: "Theme", icon: Palette },
    { id: "payments", label: "Payments", icon: CreditCard },
  ];
  const preferenceTabs: { id: SettingsTab; label: string; icon: any }[] = [
    { id: "notifications", label: "Alerts", icon: Bell },
    { id: "liquidity", label: "Liquidity", icon: Droplets },
    { id: "reputation", label: "Reputation", icon: Trophy },
  ];
  const tabs = [...accountTabs, ...preferenceTabs];

  return (
    <div className="min-h-screen bg-background text-white">
      <MerchantNavbar
        activePage="settings"
        merchantInfo={merchantInfo}
        onLogout={handleLogout}
        mobileTitle="Settings"
        onOpenSettings={
          onClose
            ? () => {
                /* already in settings */
              }
            : undefined
        }
        onOpenWallet={onOpenWallet}
        onNavLinkClick={onClose}
        onBack={onClose ?? (() => router.push("/market"))}
      />

      {/* Constrained layout — capped at 1080px and centered to match the
          wallet "main" view's max-w-[1080px]. Prior version was full-bleed
          which felt sparse next to the wallet page sitting at a tighter
          width. Sidebar still gets its fixed 240px column; the rest goes
          to content. */}
      <div className="w-full max-w-[1080px] mx-auto flex flex-col lg:flex-row min-h-[calc(100vh-50px)]">
        {/* Sidebar Tabs — sticky on desktop so it stays visible while the
            content area scrolls. Anchored at top-[50px] (the height of the
            MerchantNavbar) and capped at the viewport so very long sidebars
            scroll internally instead of pushing the page taller. */}
        <nav className="lg:w-60 lg:border-r border-white/[0.05] lg:py-6 lg:px-3 shrink-0 flex flex-col lg:sticky lg:top-[50px] lg:self-start lg:h-[calc(100vh-50px)] lg:overflow-y-auto">
          {/* Mobile: iOS-style grouped list — each row opens a bottom-sheet */}
          <div className="flex lg:hidden flex-col gap-6 px-4 py-4 pb-28">
            {/* Profile header card */}
            <button
              onClick={() => { setActiveTab("profile"); setMobileSheetOpen(true); }}
              className="flex items-center gap-4 p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06] active:bg-white/[0.06] transition-colors text-left w-full"
            >
              <div className="w-12 h-12 rounded-full bg-white/[0.06] border border-white/[0.08] flex items-center justify-center shrink-0 overflow-hidden">
                {merchant?.avatar_url ? (
                  <img src={merchant.avatar_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-lg font-bold text-white/60">
                    {(merchant?.username || merchant?.display_name || "?").charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-semibold text-white truncate">
                  {merchant?.username || merchant?.display_name || "Set up profile"}
                </p>
                <p className="text-[12px] text-white/40 truncate">{merchant?.email || ""}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-white/20 shrink-0" />
            </button>

            {/* Account section */}
            <div>
              <p className="text-[11px] font-semibold text-white/30 uppercase tracking-widest px-1 mb-2">Account</p>
              <div className="rounded-2xl border border-white/[0.06] overflow-hidden divide-y divide-white/[0.04]">
                {accountTabs.filter(t => t.id !== "profile").map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => { setActiveTab(tab.id); setMobileSheetOpen(true); }}
                      className="flex items-center gap-3.5 w-full px-4 py-3.5 bg-white/[0.02] active:bg-white/[0.06] transition-colors text-left"
                    >
                      <div className="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center shrink-0">
                        <Icon className="w-4 h-4 text-white/60" />
                      </div>
                      <span className="flex-1 text-[14px] text-white/80">{tab.label}</span>
                      <ChevronRight className="w-4 h-4 text-white/20" />
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Preferences section */}
            <div>
              <p className="text-[11px] font-semibold text-white/30 uppercase tracking-widest px-1 mb-2">Preferences</p>
              <div className="rounded-2xl border border-white/[0.06] overflow-hidden divide-y divide-white/[0.04]">
                {preferenceTabs.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => { setActiveTab(tab.id); setMobileSheetOpen(true); }}
                      className="flex items-center gap-3.5 w-full px-4 py-3.5 bg-white/[0.02] active:bg-white/[0.06] transition-colors text-left"
                    >
                      <div className="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center shrink-0">
                        <Icon className="w-4 h-4 text-white/60" />
                      </div>
                      <span className="flex-1 text-[14px] text-white/80">{tab.label}</span>
                      <ChevronRight className="w-4 h-4 text-white/20" />
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Logout */}
            <div className="rounded-2xl border border-white/[0.06] overflow-hidden">
              <button
                onClick={handleLogout}
                className="flex items-center gap-3.5 w-full px-4 py-3.5 bg-white/[0.02] active:bg-white/[0.06] transition-colors text-left"
              >
                <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center shrink-0">
                  <LogOut className="w-4 h-4 text-red-400" />
                </div>
                <span className="flex-1 text-[14px] text-red-400">Log Out</span>
              </button>
            </div>
          </div>

          {/* Desktop: grouped sidebar — ACCOUNT then PREFERENCES, with the
              Logout pinned at the bottom via mt-auto. */}
          <div className="hidden lg:flex lg:flex-col gap-1 flex-1">
            <p className="px-3 mb-2 text-[10px] font-bold tracking-[0.18em] text-white/30 uppercase">
              Account
            </p>
            {accountTabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all whitespace-nowrap ${
                    activeTab === tab.id
                      ? "bg-white/[0.08] text-white"
                      : "text-white/40 hover:text-foreground/60 hover:bg-card"
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {tab.label}
                </button>
              );
            })}

            <p className="px-3 mt-5 mb-2 text-[10px] font-bold tracking-[0.18em] text-white/30 uppercase">
              Preferences
            </p>
            {preferenceTabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all whitespace-nowrap ${
                    activeTab === tab.id
                      ? "bg-white/[0.08] text-white"
                      : "text-white/40 hover:text-foreground/60 hover:bg-card"
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {tab.label}
                </button>
              );
            })}

            <div className="mt-auto pt-6 space-y-3">
              <button
                onClick={() => setShowSupportSheet(true)}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-medium text-white/40 hover:text-foreground/60 hover:bg-card transition-all w-full"
              >
                <HelpCircle className="w-4 h-4" />
                Support
              </button>
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

        {/* Mobile: scrim behind the sheet */}
        <AnimatePresence>
          {mobileSheetOpen && (
            <motion.div
              className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileSheetOpen(false)}
            />
          )}
        </AnimatePresence>

        {/* Content — desktop: inline flex column. Mobile: slides up as a bottom-sheet. */}
        <motion.main
          className={`flex-1 max-w-[1100px] w-full overflow-y-auto
            lg:p-8 lg:pb-8 lg:static lg:z-auto lg:bg-transparent lg:rounded-none lg:border-none lg:max-h-none lg:translate-y-0 lg:block
            fixed inset-x-0 bottom-0 z-50 rounded-t-3xl bg-[#0e0e10] border-t border-white/[0.08]
            ${mobileSheetOpen ? 'flex flex-col' : 'hidden lg:flex'}`}
          style={{ maxHeight: mobileSheetOpen ? "92vh" : undefined }}
          initial={false}
          animate={mobileSheetOpen ? { y: 0 } : { y: "100%" }}
          transition={{ type: "spring", stiffness: 360, damping: 36 }}
        >
          {/* Mobile sheet header — hidden on desktop */}
          <div className="lg:hidden flex items-center px-5 pt-5 pb-3 border-b border-white/[0.05] shrink-0 relative">
            <div className="absolute left-1/2 -translate-x-1/2 top-2 w-8 h-1 rounded-full bg-white/20" />
            <p className="text-[15px] font-semibold text-white flex-1 text-center">
              {tabs.find(t => t.id === activeTab)?.label}
            </p>
            <button onClick={() => setMobileSheetOpen(false)} className="p-1.5 rounded-lg text-white/40 hover:text-white/70">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto lg:overflow-visible p-5 lg:p-8 pb-10 lg:pb-16">
          {/* Success/Error banners */}
          {saveSuccess && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4 flex items-center gap-2 p-3 bg-white/[0.06] border border-white/[0.09] rounded-xl text-sm text-[#f5f5f7]"
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
          {activeTab === "profile" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-bold mb-1">Profile</h2>
                <p className="text-sm text-white/40">
                  Manage how you appear to other traders
                </p>
              </div>

              {/* Avatar */}
              <div className="bg-white/[0.02] rounded-2xl border border-white/[0.06] p-5">
                <label className="text-xs text-white/40 font-mono uppercase tracking-wider mb-3 block">
                  Avatar
                </label>
                <div className="flex items-center gap-4 mb-4">
                  <div className="relative w-16 h-16 rounded-full border-2 border-white/20 overflow-hidden shrink-0">
                    {selectedAvatar ? (
                      <img
                        src={selectedAvatar}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : null}
                    <div className="w-full h-full flex items-center justify-center bg-white/5 text-2xl">
                      {displayName?.charAt(0)?.toUpperCase() || "?"}
                    </div>
                  </div>
                  <div>
                    <p className="text-sm text-white/70">
                      Choose from preset avatars below
                    </p>
                    <p className="text-xs text-white/30 mt-0.5">
                      Click any avatar to select it
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-12 gap-2">
                  {PRESET_AVATARS.map((url, i) => (
                    <button
                      key={i}
                      onClick={() => setSelectedAvatar(url)}
                      className={`relative aspect-square rounded-full overflow-hidden border-2 transition-all ${
                        selectedAvatar === url
                          ? "border-white/60 ring-2 ring-white/20 scale-110"
                          : "border-white/10 hover:border-border-strong"
                      }`}
                    >
                      <img
                        src={url}
                        alt={`Avatar ${i + 1}`}
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-white/[0.02] rounded-2xl border border-white/[0.06] p-5 space-y-4">
                <div>
                  <label className="text-xs text-white/40 font-mono uppercase tracking-wider mb-2 block">
                    Name
                  </label>
                  <div className="flex items-center gap-2 bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3">
                    <span className="text-sm text-white flex-1">{merchant?.username || displayName || "—"}</span>
                    <button
                      type="button"
                      onClick={() => setActiveTab("account")}
                      className="text-[11px] text-white/30 hover:text-white/60 transition-colors"
                    >
                      Change in Account
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-xs text-white/40 font-mono uppercase tracking-wider mb-2 block">
                    Bio
                  </label>
                  <textarea
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    maxLength={200}
                    placeholder="Tell traders about yourself..."
                    rows={3}
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 outline-none focus:border-white/30 resize-none transition-colors"
                  />
                  <span className="text-[10px] text-white/20 font-mono mt-1 block text-right">
                    {bio.length}/200
                  </span>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs text-white/40 font-mono uppercase tracking-wider block">
                      Phone
                    </label>
                    {/* Badge shows only when the number in the field is the one
                        that was actually verified — editing it (before re-verify
                        + save) hides the badge so it never vouches for a number
                        that hasn't been confirmed. */}
                    {phoneVerified &&
                    phone.trim() !== "" &&
                    phone.trim() === ((merchant?.phone as string) || "").trim() ? (
                      <span className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-white/70">
                        <ShieldCheck className="w-3 h-3" />
                        Verified
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setShowPhoneVerify(true)}
                        className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-[#f5f5f7] hover:opacity-80 transition-opacity"
                      >
                        <Smartphone className="w-3 h-3" />
                        Verify
                      </button>
                    )}
                  </div>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+971 50 123 4567"
                    maxLength={20}
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 outline-none focus:border-white/[0.12] transition-colors"
                  />
                </div>
              </div>

              {/* Save Button */}
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={handleSaveProfile}
                disabled={isSaving}
                className="w-full py-3 rounded-xl bg-[#f5f5f7] text-[#0b0b0c] font-bold text-sm hover:bg-white transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isSaving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : saveSuccess ? (
                  <Check className="w-4 h-4" />
                ) : null}
                {isSaving
                  ? "Saving..."
                  : saveSuccess
                    ? "Saved!"
                    : "Save Changes"}
              </motion.button>

              {/* View Public Profile Link */}
              {merchantId && (
                <Link
                  href={`/market/profile/${merchantId}`}
                  className="flex items-center justify-center gap-2 text-sm text-white/40 hover:text-foreground/60 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  View your public profile
                </Link>
              )}
            </div>
          )}

          {/* Account Tab */}
          {activeTab === "account" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold mb-1">Account</h2>
                <p className="text-sm text-white/40">
                  Account details and trading stats
                </p>
              </div>

              {/* Account Info — each row has a leading icon tile, label/value
                  body, and a trailing edit (username/email) or copy (id/wallet)
                  affordance. Matches the wider rhythm of the new settings
                  layout. */}
              <div className="bg-white/[0.02] rounded-2xl border border-white/[0.06] p-5 space-y-1">
                <p className="text-[11px] text-white/40 font-mono uppercase tracking-[0.18em] mb-3">
                  Account Information
                </p>

                {/* Display Name — the public-facing name shown in chat,
                    order cards, and merchant lists. Editable, but the
                    editor lives on the Profile tab; the pencil here jumps
                    there instead of duplicating the form. Falls back to
                    the live `displayName` state in case the merchant
                    just edited it on the Profile tab and merchant store
                    hasn't refreshed yet. */}
                <div className="flex items-center gap-4 py-3 border-b border-white/[0.04]">
                  <div className="w-9 h-9 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center shrink-0">
                    <User className="w-4 h-4 text-white/60" />
                  </div>
                  <p className="flex-1 text-[13px] text-white/60">Display Name</p>
                  <p className="text-[13px] text-white font-medium truncate max-w-[40ch]">
                    {merchant?.display_name || displayName || "—"}
                  </p>
                  <button
                    aria-label="Edit display name"
                    onClick={() => setActiveTab("profile")}
                    className="p-1.5 hover:bg-white/[0.06] rounded-lg transition-colors text-white/40 hover:text-white/70"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Username — editable until the merchant runs the
                    customize-username flow (which flips
                    merchants.username_customized_at). PATCH /api/merchant/username
                    writes the new value AND sets that flag so the onboarding
                    checklist's Profile Setup step ticks complete on the
                    next status refresh. After the flag is set the row
                    collapses back to the read-only display (we keep the
                    historical "set once" UX — username changes after that
                    are a support / wallet-signature flow).

                    Important: an auto-generated `username` at signup is NOT
                    the same as a customized one. Show the form whenever
                    usernameClaimed (from onboarding status) is false, even
                    if `merchant.username` already has a value — otherwise
                    the merchant can never tick step 1 complete. */}
                {merchant?.username && !isEditingUsername ? (
                  // Read-only row — matches the Display Name pattern: label,
                  // value, copy, edit pen. Tapping the pen seeds the input
                  // with the current value and flips into edit mode.
                  <div className="flex items-center gap-4 py-3 border-b border-white/[0.04]">
                    <div className="w-9 h-9 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center shrink-0">
                      <AtSign className="w-4 h-4 text-white/60" />
                    </div>
                    <p className="flex-1 text-[13px] text-white/60">Username</p>
                    <p className="text-[13px] text-white font-medium truncate max-w-[40ch]">
                      {merchant.username}
                    </p>
                    <button
                      aria-label="Copy username"
                      onClick={() =>
                        handleCopyField(merchant.username, "username")
                      }
                      className="p-1.5 hover:bg-white/[0.06] rounded-lg transition-colors text-white/40 hover:text-white/70"
                    >
                      {copiedField === "username" ? (
                        <Check className="w-3.5 h-3.5 text-[#f5f5f7]" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <button
                      aria-label="Edit username"
                      onClick={() => {
                        setUsernameInput(merchant.username);
                        setUsernameError(null);
                        setIsEditingUsername(true);
                      }}
                      className="p-1.5 hover:bg-white/[0.06] rounded-lg transition-colors text-white/40 hover:text-white/70"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="py-3 border-b border-white/[0.04]">
                    <div className="flex items-center gap-4">
                      <div className="w-9 h-9 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center shrink-0">
                        <AtSign className="w-4 h-4 text-white/60" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] text-white/60 mb-1.5">
                          Username
                        </p>
                        <div className="relative">
                          <input
                            type="text"
                            value={usernameInput}
                            onChange={(e) => setUsernameInput(e.target.value)}
                            placeholder="pick a username"
                            maxLength={20}
                            className={`w-full bg-black/40 border rounded-lg px-3 py-2 pr-9 text-[13px] text-white placeholder-white/30 focus:outline-none transition-colors ${
                              usernameAvailability.kind === "available"
                                ? "border-white/[0.09]"
                                : usernameAvailability.kind === "unavailable"
                                ? "border-red-500/60"
                                : "border-white/10 focus:border-white/30"
                            }`}
                          />
                          <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
                            {usernameAvailability.kind === "checking" && (
                              <Loader2 className="w-3.5 h-3.5 text-white/40 animate-spin" />
                            )}
                            {usernameAvailability.kind === "available" && (
                              <Check className="w-3.5 h-3.5 text-[#f5f5f7]" />
                            )}
                            {usernameAvailability.kind === "unavailable" && (
                              <X className="w-3.5 h-3.5 text-red-400" />
                            )}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3 mt-1.5 min-h-[16px]">
                          <p
                            className={`text-[11px] ${
                              usernameAvailability.kind === "available"
                                ? "text-[#f5f5f7]"
                                : usernameAvailability.kind === "unavailable"
                                ? "text-red-400"
                                : "text-white/40"
                            }`}
                          >
                            {usernameAvailability.kind === "available" &&
                              "Available"}
                            {usernameAvailability.kind === "unavailable" &&
                              usernameAvailability.reason}
                            {usernameAvailability.kind === "idle" &&
                              "Letters, numbers and underscores. 4–20 chars."}
                            {usernameAvailability.kind === "checking" &&
                              "Checking…"}
                          </p>
                          {usernameError && (
                            <p className="text-[11px] text-red-400">
                              {usernameError}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {isEditingUsername && (
                          <button
                            type="button"
                            onClick={() => {
                              setIsEditingUsername(false);
                              setUsernameInput("");
                              setUsernameError(null);
                              setUsernameAvailability({ kind: "idle" });
                            }}
                            disabled={usernameSaving}
                            className="inline-flex items-center px-3 py-2 text-[12px] font-medium rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-white/70 disabled:opacity-40"
                          >
                            Cancel
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void saveUsername()}
                          disabled={
                            usernameSaving ||
                            usernameAvailability.kind !== "available"
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold rounded-lg bg-white text-black disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {usernameSaving && (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          )}
                          Save
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Email — also read-only via this UI. Email change requires
                    a verification round-trip that doesn't exist server-side
                    yet, so we render the value with a copy affordance only.
                    When/if email-change ships, swap Copy back for an inline
                    editor + verification flow. */}
                <div className="flex items-center gap-4 py-3 border-b border-white/[0.04]">
                  <div className="w-9 h-9 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center shrink-0">
                    <Mail className="w-4 h-4 text-white/60" />
                  </div>
                  <p className="flex-1 text-[13px] text-white/60">Email</p>
                  <p className="text-[13px] text-white font-medium truncate max-w-[40ch]">
                    {merchant?.email || "Not set"}
                  </p>
                  {merchant?.email ? (
                    <button
                      aria-label="Copy email"
                      onClick={() =>
                        handleCopyField(merchant.email, "email")
                      }
                      className="p-1.5 hover:bg-white/[0.06] rounded-lg transition-colors text-white/40 hover:text-white/70"
                    >
                      {copiedField === "email" ? (
                        <Check className="w-3.5 h-3.5 text-[#f5f5f7]" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  ) : (
                    <span className="w-7" />
                  )}
                </div>

                {/* Merchant ID */}
                <div className="flex items-center gap-4 py-3 border-b border-white/[0.04]">
                  <div className="w-9 h-9 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center shrink-0">
                    <IdCard className="w-4 h-4 text-white/60" />
                  </div>
                  <p className="flex-1 text-[13px] text-white/60">Merchant ID</p>
                  <p className="text-[13px] text-white font-mono truncate max-w-[40ch]">
                    {merchant?.id || merchantId || "—"}
                  </p>
                  <button
                    aria-label="Copy merchant id"
                    onClick={() =>
                      handleCopyField(
                        merchant?.id || merchantId || "",
                        "merchant_id",
                      )
                    }
                    className="p-1.5 hover:bg-white/[0.06] rounded-lg transition-colors text-white/40 hover:text-white/70"
                  >
                    {copiedField === "merchant_id" ? (
                      <Check className="w-3.5 h-3.5 text-[#f5f5f7]" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>

                {/* Wallet */}
                <div className="flex items-center gap-4 py-3 border-b border-white/[0.04]">
                  <div className="w-9 h-9 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center shrink-0">
                    <Wallet className="w-4 h-4 text-white/60" />
                  </div>
                  <p className="flex-1 text-[13px] text-white/60">Wallet Address</p>
                  <p className="text-[13px] text-white font-mono truncate max-w-[40ch]">
                    {merchant?.wallet_address || "Not connected"}
                  </p>
                  {merchant?.wallet_address ? (
                    <button
                      aria-label="Copy wallet address"
                      onClick={() =>
                        handleCopyField(merchant.wallet_address, "wallet")
                      }
                      className="p-1.5 hover:bg-white/[0.06] rounded-lg transition-colors text-white/40 hover:text-white/70"
                    >
                      {copiedField === "wallet" ? (
                        <Check className="w-3.5 h-3.5 text-[#f5f5f7]" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  ) : (
                    <span className="w-7" />
                  )}
                </div>

                {/* Joined — surfaces created_at right here in the Account
                    Information section. Previously this lived as a
                    separate tile in the Status grid below, which made it
                    easy to miss. Single source of truth now. */}
                <div className="flex items-center gap-4 py-3">
                  <div className="w-9 h-9 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center shrink-0">
                    <Calendar className="w-4 h-4 text-white/60" />
                  </div>
                  <p className="flex-1 text-[13px] text-white/60">Joined</p>
                  <p className="text-[13px] text-white font-medium truncate max-w-[40ch]">
                    {merchant?.created_at
                      ? new Date(merchant.created_at).toLocaleDateString(
                          undefined,
                          { month: "short", day: "numeric", year: "numeric" },
                        )
                      : "—"}
                  </p>
                  <span className="w-7" />
                </div>
              </div>

              {/* Trading Stats — each cell pairs an icon tile (left) with a
                  label/value stack (right), with one accent value (rating
                  stars / verified badge / etc) on the trailing edge. */}
              <div className="bg-white/[0.02] rounded-2xl border border-white/[0.06] p-5">
                <p className="text-[11px] text-white/40 font-mono uppercase tracking-[0.18em] mb-3">
                  Trading Stats
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* Total Trades */}
                  <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.05] flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-transparent flex items-center justify-center shrink-0">
                      <Activity className="w-4 h-4 text-white" />
                    </div>
                    <div className="flex-1">
                      <p className="text-[10px] text-white/40 font-mono uppercase tracking-wider mb-0.5">
                        Total Trades
                      </p>
                      <p className="text-2xl font-bold text-white tabular-nums leading-none">
                        {merchant?.total_trades || 0}
                      </p>
                    </div>
                  </div>

                  {/* Rating */}
                  <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.05] flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-transparent flex items-center justify-center shrink-0">
                      <Star className="w-4 h-4 text-white fill-white" />
                    </div>
                    <div className="flex-1">
                      <p className="text-[10px] text-white/40 font-mono uppercase tracking-wider mb-0.5">
                        Rating
                      </p>
                      <p className="text-2xl font-bold text-white tabular-nums leading-none">
                        {parseFloat(String(merchant?.rating || 5)).toFixed(2)}
                      </p>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <Star
                          key={s}
                          className={`w-3.5 h-3.5 ${
                            s <= Math.round(parseFloat(String(merchant?.rating || 5)))
                              ? "fill-white/50 text-[#f5f5f7]"
                              : "text-white/15"
                          }`}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Status */}
                  <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.05] flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-transparent flex items-center justify-center shrink-0">
                      <Activity className="w-4 h-4 text-white" />
                    </div>
                    <div className="flex-1">
                      <p className="text-[10px] text-white/40 font-mono uppercase tracking-wider mb-0.5">
                        Status
                      </p>
                      <p
                        className={`text-lg font-bold leading-none ${
                          merchant?.status === "active"
                            ? "text-[#f5f5f7]"
                            : "text-red-400"
                        }`}
                      >
                        {(merchant?.status || "active").charAt(0).toUpperCase() +
                          (merchant?.status || "active").slice(1)}
                      </p>
                    </div>
                    {merchant?.status === "active" && (
                      <span className="flex items-center gap-1.5 text-[11px] text-[#f5f5f7] font-medium shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-white/[0.08]" />
                        Verified
                      </span>
                    )}
                  </div>

                  {/* Joined tile removed — moved up to Account
                      Information section so it's not duplicated. */}
                </div>
              </div>
            </div>
          )}

          {/* Security Tab */}
          {activeTab === "security" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-bold mb-1">Security</h2>
                <p className="text-sm text-white/40">
                  Password, two-factor authentication, and sessions
                </p>
              </div>

              {/* Change Password */}
              <div className="bg-white/[0.02] rounded-2xl border border-white/[0.06] p-5 space-y-4">
                <label className="text-xs text-white/40 font-mono uppercase tracking-wider mb-2 block">
                  Change Password
                </label>

                {passwordError && (
                  <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400">
                    <AlertCircle className="w-4 h-4" />
                    {passwordError}
                  </div>
                )}

                {passwordSuccess && (
                  <div className="flex items-center gap-2 p-3 bg-white/[0.06] border border-white/[0.09] rounded-xl text-sm text-[#f5f5f7]">
                    <Check className="w-4 h-4" />
                    Password changed successfully
                  </div>
                )}

                <div className="relative">
                  <input
                    type={showCurrentPassword ? "text" : "password"}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Current password"
                    maxLength={24}
                    autoComplete="off"
                    className="w-full bg-foreground/[0.04] border border-foreground/[0.08] rounded-xl px-4 py-3 pr-10 text-sm text-foreground placeholder:text-foreground/30 outline-none focus:border-white/[0.12] transition-colors"
                  />
                  <button
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 z-10 text-foreground/60 hover:text-foreground"
                  >
                    {showCurrentPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>

                <div className="relative">
                  <input
                    type={showNewPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="New password (8–24 chars)"
                    maxLength={24}
                    autoComplete="new-password"
                    className="w-full bg-foreground/[0.04] border border-foreground/[0.08] rounded-xl px-4 py-3 pr-10 text-sm text-foreground placeholder:text-foreground/30 outline-none focus:border-white/[0.12] transition-colors"
                  />
                  <button
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 z-10 text-foreground/60 hover:text-foreground"
                  >
                    {showNewPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>

                <div className="relative">
                  <input
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    placeholder="Confirm new password"
                    maxLength={24}
                    autoComplete="new-password"
                    className="w-full bg-foreground/[0.04] border border-foreground/[0.08] rounded-xl px-4 py-3 pr-10 text-sm text-foreground placeholder:text-foreground/30 outline-none focus:border-white/[0.12] transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 z-10 text-foreground/60 hover:text-foreground"
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>

                <button
                  onClick={handleChangePassword}
                  disabled={
                    isChangingPassword ||
                    !currentPassword ||
                    !newPassword ||
                    !confirmNewPassword
                  }
                  className="w-full py-3 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white/80 font-medium text-sm hover:bg-accent-subtle transition-colors disabled:opacity-30 flex items-center justify-center gap-2"
                >
                  {isChangingPassword && (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  )}
                  {isChangingPassword ? "Changing..." : "Change Password"}
                </button>
              </div>

              {/* Two-Factor Authentication */}
              <TwoFactorSection merchantId={merchantId} />

              {/* Active Sessions */}
              <ActiveSessionsSection />

              {/* Danger Zone */}
              {/* <div className="bg-red-500/[0.03] rounded-2xl border border-red-500/[0.08] p-5">
                <label className="text-xs text-red-400/60 font-mono uppercase tracking-wider mb-3 block">Danger Zone</label>
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 font-medium text-sm hover:bg-[var(--color-error)]/20 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Log Out
                </button>
              </div> */}
            </div>
          )}

          {/* Theme Tab */}
          {activeTab === "theme" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-bold mb-1">Theme</h2>
                <p className="text-sm text-white/40">
                  Customize the look of your dashboard
                </p>
              </div>

              <ThemeSection />
            </div>
          )}

          {/* Payments Tab — two-column: list on the left, persistent inline
              add/edit form on the right. Replaces the old "click to open
              modal" flow with a single screen where the form is always in
              view, matching the design mock. The modal is still mounted
              below for backwards compat (other surfaces may trigger it via
              setIsPaymentModalOpen) but Settings doesn't use that path. */}
          {activeTab === "payments" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* LEFT — list / empty state */}
              <div>
                <h2 className="text-2xl font-bold mb-1">Payment Methods</h2>
                <p className="text-sm text-white/40 mb-5">
                  Bank, card, crypto, cash and mobile methods used to send or
                  receive funds
                </p>

                {isLoadingMethods && paymentMethods.length === 0 ? (
                  <div className="bg-white/[0.02] rounded-2xl border border-white/[0.06] p-12 text-center">
                    <Loader2 className="w-5 h-5 text-white/20 mx-auto animate-spin" />
                    <p className="text-xs text-white/30 mt-3">
                      Loading payment methods…
                    </p>
                  </div>
                ) : paymentMethods.length === 0 ? (
                  <div className="bg-white/[0.02] rounded-2xl border border-white/[0.06] py-16 px-8 text-center min-h-[400px] flex flex-col items-center justify-center">
                    <div className="w-20 h-20 mx-auto rounded-full bg-white/[0.04] border border-white/[0.06] flex items-center justify-center mb-5">
                      <CreditCard className="w-9 h-9 text-white/30" />
                    </div>
                    <p className="text-base font-medium text-white mb-1">
                      No payment methods added yet
                    </p>
                    <p className="text-[13px] text-white/40">
                      Use the form on the right to add one.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {paymentMethods.map((method) => {
                      const meta =
                        PM_TYPE_META[method.type] || PM_TYPE_META.bank;
                      const Icon = meta.Icon;
                      const isBeingEdited = editingPaymentMethod?.id === method.id;
                      return (
                        <div
                          key={method.id}
                          className={`rounded-2xl border p-4 transition-colors overflow-hidden ${
                            isBeingEdited
                              ? "bg-white/[0.06] border-white/[0.12] ring-1 ring-white/20"
                              : method.is_default
                                ? "bg-gradient-to-r from-white/80/[0.06] to-transparent border-white/[0.12]"
                                : "bg-white/[0.02] border-white/[0.06]"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <div
                                className={`w-10 h-10 rounded-xl bg-gradient-to-br ${meta.gradient} border ${meta.border} flex items-center justify-center shrink-0`}
                              >
                                <Icon className={`w-5 h-5 ${meta.text}`} />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                                  <p className="text-sm font-medium text-white/80 truncate min-w-0">
                                    {method.name}
                                  </p>
                                  <span className="text-[9px] font-bold font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.06] text-white/40">
                                    {meta.label}
                                  </span>
                                  {method.is_default && (
                                    <span className="flex items-center gap-1 px-1.5 py-0.5 bg-white/[0.06] border border-white/[0.12] rounded-md">
                                      <Star className="w-2.5 h-2.5 text-[#f5f5f7] fill-white/50" />
                                      <span className="text-[9px] text-[#f5f5f7] font-bold uppercase tracking-wider">
                                        Default
                                      </span>
                                    </span>
                                  )}
                                  {isBeingEdited && (
                                    <span className="text-[9px] text-[#f5f5f7] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/[0.12]">
                                      Editing
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-white/30 font-mono mt-0.5 truncate">
                                  {method.details}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {!method.is_default && (
                                <button
                                  onClick={() =>
                                    handleSetDefaultMethod(method.id)
                                  }
                                  className="p-2 text-white/20 hover:text-white hover:bg-white/[0.08] rounded-lg transition-colors"
                                  title="Set as default"
                                >
                                  <Star className="w-4 h-4" />
                                </button>
                              )}
                              <button
                                onClick={() => startEditMethod(method)}
                                className="p-2 text-white/20 hover:text-white hover:bg-white/[0.08] rounded-lg transition-colors"
                                title="Edit"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
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
                  </div>
                )}
              </div>

              {/* RIGHT — always-visible add/edit form. The same component is
                  used for both: when `editingPaymentMethod` is null it shows
                  the Add UI; when set it switches to Edit mode for that row.
                  Cancel from edit clears the parent's edit state and the
                  form falls back to Add. */}
              <div className="lg:sticky lg:top-6 self-start">
                {(merchantId || merchant?.id) ? (
                  <PaymentMethodInlineForm
                    merchantId={(merchantId || merchant?.id) as string}
                    methodCount={paymentMethods.length}
                    editingMethod={editingPaymentMethod}
                    onCancel={
                      editingPaymentMethod
                        ? () => setEditingPaymentMethod(null)
                        : undefined
                    }
                    onSaved={(saved, isEdit) => {
                      if (isEdit) {
                        setPaymentMethods((prev) =>
                          prev.map((m) =>
                            m.id === saved.id
                              ? { ...m, name: saved.name, details: saved.details }
                              : m,
                          ),
                        );
                        setEditingPaymentMethod(null);
                      } else {
                        setPaymentMethods((prev) => [...prev, saved]);
                      }
                    }}
                  />
                ) : (
                  <div className="bg-white/[0.02] rounded-2xl border border-white/[0.06] p-6 text-center text-sm text-white/40">
                    Loading merchant…
                  </div>
                )}
              </div>
            </div>
          )}


          {/* Notifications Tab */}
          {activeTab === "notifications" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold mb-1">Notifications</h2>
                <p className="text-sm text-white/40">
                  Configure alerts and sounds
                </p>
              </div>

              {/* Each preference row pairs a leading icon tile (chosen to
                  visually match the action — speaker/cart/bubble/bell) with
                  label + description + toggle. Same data + handlers as before,
                  just restructured rows. */}
              <div className="bg-white/[0.02] rounded-2xl border border-white/[0.06] p-2">
                {(
                  [
                    {
                      key: "sound" as const,
                      label: "Sound Effects",
                      desc: "Play sounds for new orders and messages.",
                      Icon: Volume2,
                    },
                    {
                      key: "orderAlerts" as const,
                      label: "Order Alerts",
                      desc: "Get notified about new and updated orders.",
                      Icon: ShoppingCart,
                    },
                    {
                      key: "chatMessages" as const,
                      label: "Chat Messages",
                      desc: "Notifications for incoming messages.",
                      Icon: MessageCircle,
                    },
                    {
                      key: "systemUpdates" as const,
                      label: "System Updates",
                      desc: "Platform news and maintenance alerts.",
                      Icon: Bell,
                    },
                  ] as const
                ).map((item, idx, arr) => {
                  const Icon = item.Icon;
                  const on = notifSettings[item.key];
                  return (
                    <div
                      key={item.key}
                      className={`flex items-center gap-4 px-4 py-4 ${
                        idx < arr.length - 1
                          ? "border-b border-white/[0.04]"
                          : ""
                      }`}
                    >
                      <div className="w-11 h-11 rounded-full bg-white/[0.04] border border-white/[0.06] flex items-center justify-center shrink-0">
                        <Icon className="w-5 h-5 text-white/70" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-bold text-white">
                          {item.label}
                        </p>
                        <p className="text-[12px] text-white/40 mt-0.5">
                          {item.desc}
                        </p>
                      </div>
                      <button
                        role="switch"
                        aria-checked={on}
                        onClick={() =>
                          setNotifSettings((prev) => ({
                            ...prev,
                            [item.key]: !prev[item.key],
                          }))
                        }
                        className={`w-12 h-6 rounded-full transition-all relative shrink-0 ${
                          on ? "bg-[#f5f5f7]" : "bg-white/[0.10]"
                        }`}
                      >
                        <div
                          className={`w-5 h-5 rounded-full shadow-sm absolute top-0.5 transition-all ${
                            on ? "left-[26px] bg-background" : "left-0.5 bg-white"
                          }`}
                        />
                      </button>
                    </div>
                  );
                })}
              </div>

              <button
                onClick={handleSaveNotifications}
                className="w-full py-3.5 rounded-xl bg-[#f5f5f7] text-[#0b0b0c] font-bold text-sm hover:bg-white transition-colors flex items-center justify-center gap-2"
              >
                <Save className="w-4 h-4" />
                Save Preferences
              </button>

              <div className="flex items-center justify-center gap-1.5 text-[12px] text-white/30">
                <ShieldCheck className="w-3.5 h-3.5" />
                Your preferences are securely saved
              </div>
            </div>
          )}

          {/* Liquidity Tab */}
          {activeTab === "liquidity" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold mb-1">Liquidity Provider</h2>
                <p className="text-sm text-white/40">
                  Earn fees by providing liquidity for other traders
                </p>
              </div>

              {/* CorridorProviderSettings now owns its own header row +
                  description, so the wrapper card is just the chrome. */}
              <div className="bg-white/[0.02] rounded-2xl border border-white/[0.06] p-6">
                <CorridorProviderSettings merchantId={merchantId || null} />
              </div>

              {/* Trust row — four-up feature highlights matching the LP mock. */}
              <div className="bg-white/[0.02] rounded-2xl border border-white/[0.06] p-4 grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  {
                    Icon: ShieldCheck,
                    title: "Secure & Reliable",
                    desc: "Trusted by thousands of traders",
                  },
                  {
                    Icon: BarChart3,
                    title: "Competitive Fees",
                    desc: "Set your fee and earn on every trade",
                  },
                  {
                    Icon: Zap,
                    title: "Instant Matching",
                    desc: "Get matched with active traders",
                  },
                  {
                    Icon: PieChart,
                    title: "Real-time Analytics",
                    desc: "Track performance and earnings",
                  },
                ].map(({ Icon, title, desc }) => (
                  <div key={title} className="flex items-start gap-3">
                    <Icon className="w-5 h-5 text-[#f5f5f7] shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-[13px] font-bold text-white leading-tight">
                        {title}
                      </p>
                      <p className="text-[11px] text-white/40 mt-0.5 leading-snug">
                        {desc}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === "reputation" && (
            <ReputationTab merchantId={merchantId} />
          )}

          </div>
        </motion.main>
      </div>

      <PaymentMethodModal
        isOpen={isPaymentModalOpen}
        onClose={() => {
          setIsPaymentModalOpen(false);
          setEditingPaymentMethod(null);
          fetchPaymentMethods();
        }}
        merchantId={merchantId || merchant?.id || ""}
        editingMethod={editingPaymentMethod}
      />

      <PhoneVerificationModal
        isOpen={showPhoneVerify}
        onClose={() => setShowPhoneVerify(false)}
        currentPhone={phone}
        onVerified={(verifiedPhone) => {
          // Reflect the verified number everywhere the badge logic reads from,
          // so the green "Verified" badge appears immediately without a reload.
          setPhone(verifiedPhone);
          setPhoneVerified(true);
          setMerchant((prev: any) => ({
            ...prev,
            phone: verifiedPhone,
            phone_verified: true,
          }));
          setMerchantInfo((prev: any) => ({
            ...prev,
            phone: verifiedPhone,
            phone_verified: true,
          }));
        }}
      />

      <MerchantSupportSheet
        open={showSupportSheet}
        onClose={() => setShowSupportSheet(false)}
        merchantId={merchantInfo?.id}
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
    const id = merchantId;
    if (!id) {
      setRepLoading(false);
      return;
    }
    setRepLoading(true);
    fetch(`/api/reputation?entityId=${id}&entityType=merchant`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.data) {
          setRepData(data.data);
        }
      })
      .catch((err) => console.error("Reputation fetch error:", err))
      .finally(() => setRepLoading(false));
  }, [merchantId]);

  const score = repData?.score?.total_score ?? 0;
  const tier = repData?.score?.tier ?? "newcomer";
  const badges = repData?.score?.badges ?? [];

  const tierLabels: Record<string, string> = {
    diamond: "Diamond",
    platinum: "Platinum",
    gold: "Gold",
    silver: "Silver",
    bronze: "Bronze",
    newcomer: "Newcomer",
  };

  const getColor = (s: number) => {
    if (s >= 900) return "#06b6d4";
    if (s >= 800) return "#3b82f6";
    if (s >= 600) return "#22c55e";
    if (s >= 400) return "#eab308";
    if (s >= 200) return "#f97316";
    return "#ef4444";
  };

  const segments = [
    { start: 0, end: 20, color: "#ef4444", label: "Poor", offset: 30 },
    { start: 20, end: 40, color: "#f97316", label: "Fair", offset: 24 },
    { start: 40, end: 60, color: "#eab308", label: "Good", offset: 24 },
    { start: 60, end: 80, color: "#22c55e", label: "V.Good", offset: 28 },
    { start: 80, end: 100, color: "#06b6d4", label: "Excellent", offset: 42 },
  ];

  // Each breakdown line has an icon tile + description so the card reads as
  // "what is this, what does it measure" rather than just a number. Order
  // matches the API's score keys; copy mirrors the reputation mock.
  const breakdownMap: Record<
    string,
    { label: string; desc: string; key: string; Icon: any }
  > = {
    execution_score: {
      label: "Reliability",
      desc: "Consistent and successful trades",
      key: "execution_score",
      Icon: ShieldCheck,
    },
    volume_score: {
      label: "Volume",
      desc: "Total trading volume",
      key: "volume_score",
      Icon: Database,
    },
    consistency_score: {
      label: "Speed",
      desc: "Order completion speed",
      key: "consistency_score",
      Icon: Zap,
    },
    trust_score: {
      label: "Liquidity",
      desc: "Providing liquidity to the market",
      key: "trust_score",
      Icon: Droplets,
    },
    review_score: {
      label: "Trust",
      desc: "Positive feedback and dispute-free trades",
      key: "review_score",
      Icon: Heart,
    },
  };

  if (repLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-white/30" />
      </div>
    );
  }

  // Standing label keyed off score band — shown next to "Your Score" so the
  // merchant has a quick word to anchor the number. Threshold values mirror
  // getColor() so the label matches the gauge tint.
  const standing =
    score >= 800
      ? "Excellent standing"
      : score >= 600
        ? "Very good standing"
        : score >= 400
          ? "Good standing"
          : score >= 200
            ? "Fair standing"
            : "Poor standing";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-1">Reputation Score</h2>
        <p className="text-sm text-white/40">
          Your reputation based on trading history, speed, and trust
        </p>
      </div>

      {/* Gauge card — "Your Score" tile on the left, gauge on the right.
          Stacks on mobile so the gauge is never squeezed. Badges live INSIDE
          the gauge column so they sit centered under the score, not under
          the wider outer card (which would visually pull them left of the
          gauge because of the Your-Score tile on the left). */}
      <div className="bg-white/[0.02] rounded-2xl border border-white/[0.06] p-4">
        <div className="flex flex-col md:flex-row md:items-center gap-4">
          <div className="md:w-[180px] shrink-0">
            <div className="w-10 h-10 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center mb-2">
              <Trophy className="w-4 h-4 text-[#f5f5f7]" />
            </div>
            <p className="text-[14px] font-bold text-white">Your Score</p>
            <p className="text-[11px] text-[#f5f5f7] flex items-center gap-1.5 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-white/[0.08]" />
              {standing}
            </p>
            <p className="text-[10px] text-white/30 flex items-center gap-1.5 mt-2">
              <Clock className="w-3 h-3" />
              Updated just now
            </p>
          </div>

          <div className="flex-1 flex flex-col items-center min-w-0">
            <div className="relative" style={{ width: 280, height: 170 }}>
            <svg
              viewBox="0 0 340 200"
              className="w-full h-full"
              overflow="visible"
            >
              {segments.map((seg, i) => {
                const cx = 170,
                  cy = 170,
                  r = 120;
                const startAngle = Math.PI + (seg.start / 100) * Math.PI;
                const endAngle = Math.PI + (seg.end / 100) * Math.PI;
                const x1 = cx + r * Math.cos(startAngle);
                const y1 = cy + r * Math.sin(startAngle);
                const x2 = cx + r * Math.cos(endAngle);
                const y2 = cy + r * Math.sin(endAngle);
                const midAngle =
                  Math.PI + ((seg.start + seg.end) / 200) * Math.PI;
                const lx = cx + (r + seg.offset) * Math.cos(midAngle);
                const ly = cy + (r + seg.offset) * Math.sin(midAngle);
                return (
                  <g key={i}>
                    <path
                      d={`M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`}
                      fill="none"
                      stroke={seg.color}
                      strokeWidth="24"
                      strokeLinecap="butt"
                      opacity={0.9}
                    />
                    <text
                      x={lx}
                      y={ly}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize="10"
                      fontWeight="600"
                      fill={seg.color}
                      opacity={0.85}
                    >
                      {seg.label}
                    </text>
                  </g>
                );
              })}

              {/* Needle */}
              {(() => {
                const cx = 170,
                  cy = 170;
                const pct = Math.min(100, Math.max(0, score / 10));
                const angle = Math.PI + (pct / 100) * Math.PI;
                const len = 90;
                const tipX = cx + len * Math.cos(angle);
                const tipY = cy + len * Math.sin(angle);
                const bw = 7;
                const pa = angle + Math.PI / 2;
                const b1x = cx + bw * Math.cos(pa),
                  b1y = cy + bw * Math.sin(pa);
                const b2x = cx - bw * Math.cos(pa),
                  b2y = cy - bw * Math.sin(pa);
                const tl = 18;
                const tailX = cx - tl * Math.cos(angle),
                  tailY = cy - tl * Math.sin(angle);
                return (
                  <g>
                    <defs>
                      <filter
                        id="ns"
                        x="-20%"
                        y="-20%"
                        width="140%"
                        height="140%"
                      >
                        <feDropShadow
                          dx="0"
                          dy="1"
                          stdDeviation="2"
                          floodColor="#000"
                          floodOpacity="0.4"
                        />
                      </filter>
                    </defs>
                    <polygon
                      points={`${tipX},${tipY} ${b1x},${b1y} ${tailX},${tailY} ${b2x},${b2y}`}
                      fill={getColor(score)}
                      filter="url(#ns)"
                      opacity={0.95}
                    />
                    <circle
                      cx={cx}
                      cy={cy}
                      r="12"
                      fill={getColor(score)}
                      filter="url(#ns)"
                    />
                    <circle
                      cx={cx}
                      cy={cy}
                      r="6"
                      fill="var(--background, #0a0a0a)"
                    />
                    <circle
                      cx={cx}
                      cy={cy}
                      r="2.5"
                      fill={getColor(score)}
                      opacity={0.6}
                    />
                  </g>
                );
              })()}

              <text
                x="42"
                y="185"
                fontSize="10"
                fill="white"
                opacity={0.3}
                fontFamily="monospace"
              >
                0
              </text>
              <text
                x="286"
                y="185"
                fontSize="10"
                fill="white"
                opacity={0.3}
                fontFamily="monospace"
              >
                1000
              </text>
            </svg>
          </div>

          {/* Score */}
          <div className="flex flex-col items-center -mt-2">
            <span
              className="text-4xl font-black"
              style={{ color: getColor(score) }}
            >
              {score}
            </span>
            <span
              className="text-[13px] font-bold mt-0.5"
              style={{ color: getColor(score) }}
            >
              {tierLabels[tier] || tier}
            </span>
          </div>

          {/* Badges — sit inside the gauge column so they center under the
              score instead of spanning the full card (which would pull them
              left of the gauge because of the Your-Score tile). */}
          {badges.length > 0 && (
            <div className="flex flex-wrap justify-center gap-1.5 mt-3 max-w-[320px]">
              {badges.map((b: string) => (
                <span
                  key={b}
                  className="px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-white/[0.06] border border-white/[0.08] text-white/60"
                >
                  {b.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          )}
          </div>
        </div>
      </div>

      {/* Breakdown — each row has an icon tile + label/desc on the left,
          score on the right, and a colored bar underneath. The bar color
          tracks getColor(val * 10) so a low row reads red and a high row
          reads green at a glance. */}
      <div className="bg-white/[0.02] rounded-2xl border border-white/[0.06] p-5">
        <h3 className="text-[11px] font-bold text-white/40 uppercase tracking-[0.18em] mb-4">
          Score Breakdown
        </h3>
        <div className="space-y-4">
          {Object.entries(breakdownMap).map(([key, { label, desc, Icon }]) => {
            const val = repData?.score?.[key] ?? 0;
            return (
              <div key={key} className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 text-white/60" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="min-w-0">
                      <p className="text-[14px] font-bold text-white">{label}</p>
                      <p className="text-[11px] text-white/40 leading-tight">{desc}</p>
                    </div>
                    <span
                      className="text-[14px] font-bold tabular-nums shrink-0"
                      style={{ color: getColor(val * 10) }}
                    >
                      {val} <span className="text-white/30 font-normal">/ 100</span>
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/[0.06] mt-1.5">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.min(100, val)}%`,
                        backgroundColor: getColor(val * 10),
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Stats — same four numbers, but each card now has a top icon tile
          for a stronger visual rhythm matching the Reputation mock. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            Icon: Trophy,
            label: "Score",
            value: String(repData?.score?.total_score ?? 0),
          },
          {
            Icon: Medal,
            label: "Tier",
            value: tierLabels[tier] || "—",
          },
          {
            Icon: BarChart3,
            label: "Rank",
            value: String(repData?.rank ?? "—"),
          },
          {
            Icon: Shield,
            label: "Badges",
            value: String(badges.length),
          },
        ].map(({ Icon, label, value }) => (
          <div
            key={label}
            className="bg-white/[0.02] rounded-2xl border border-white/[0.06] p-4 flex flex-col items-center text-center"
          >
            <div className="w-10 h-10 rounded-full bg-white/[0.04] border border-white/[0.06] flex items-center justify-center mb-2">
              <Icon className="w-4 h-4 text-[#f5f5f7]" />
            </div>
            <p className="text-2xl font-bold text-white leading-none">{value}</p>
            <p className="text-[11px] text-white/40 mt-1.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Progress to next tier — icon tile + status line + percentage on the
          right, with a tinted progress bar underneath.
          Reads the real shape returned by /api/reputation:
            progress: { currentTier, nextTier, progress }
          Where `nextTier === null` is the only true signal of "maxed out",
          and `progress` is the 0–100 percent toward the next tier. The
          previous code read `pointsNeeded` and `progressPercent`, which
          don't exist on this object — so a Silver merchant ended up showing
          "Maximum tier reached! 0%" because both reads returned undefined. */}
      {repData?.progress && (() => {
        const pct = Math.min(
          100,
          Math.max(0, Number(repData.progress.progress ?? 0)),
        );
        const isMaxTier = repData.progress.nextTier == null;
        const nextTierLabel = isMaxTier
          ? null
          : tierLabels[repData.progress.nextTier] ||
            repData.progress.nextTier;
        return (
          <div className="bg-white/[0.02] rounded-2xl border border-white/[0.06] p-5">
            <h3 className="text-[11px] font-bold text-white/40 uppercase tracking-[0.18em] mb-3">
              Progress to Next Tier
            </h3>
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-white/[0.04] border border-white/[0.06] flex items-center justify-center shrink-0">
                <Award className="w-5 h-5 text-[#f5f5f7]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-bold text-white">
                  {isMaxTier
                    ? "Maximum tier reached!"
                    : `Next: ${nextTierLabel} tier`}
                </p>
                <p className="text-[12px] text-white/40">
                  {isMaxTier
                    ? "You've reached the highest tier."
                    : `${Math.round(pct)}% of the way to ${nextTierLabel}`}
                </p>
              </div>
              <span className="text-[14px] font-bold text-[#f5f5f7] tabular-nums shrink-0">
                {isMaxTier ? "100%" : `${Math.round(pct)}%`}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-white/[0.06] mt-3">
              <div
                className="h-full rounded-full bg-[#f5f5f7] transition-all"
                style={{ width: `${isMaxTier ? 100 : pct}%` }}
              />
            </div>
          </div>
        );
      })()}
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
  deviceType: "mobile" | "tablet" | "desktop";
  isCurrent?: boolean;
  lastUsed: string;
  createdAt: string;
  expiresAt: string;
}

function TwoFactorSection({ merchantId }: { merchantId: string | null }) {
  const [is2FAEnabled, setIs2FAEnabled] = useState(false);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [step, setStep] = useState<
    "idle" | "setup" | "verify" | "backup" | "disable" | "regenerate"
  >("idle");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [manualSecret, setManualSecret] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [disablePassword, setDisablePassword] = useState("");
  const [showDisablePassword, setShowDisablePassword] = useState(false);
  const [disableCode, setDisableCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [backupCodesAcked, setBackupCodesAcked] = useState(false);
  const [regenCode, setRegenCode] = useState("");

  // Fetch 2FA status on mount (with timeout)
  useEffect(() => {
    if (!merchantId) {
      setIsLoadingStatus(false);
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    fetchWithAuth("/api/2fa/status", { signal: controller.signal })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setIs2FAEnabled(data.data?.enabled ?? false);
      })
      .catch(() => {})
      .finally(() => {
        clearTimeout(timeout);
        setIsLoadingStatus(false);
      });
  }, [merchantId]);

  const handleSetup = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await fetchWithAuth("/api/2fa/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountName: merchantId?.slice(0, 8) }),
      });
      const data = await res.json();
      if (data.success) {
        setQrDataUrl(data.data.qrDataUrl);
        setManualSecret(data.data.secret);
        setStep("verify");
      } else {
        setError(data.error || "Failed to start 2FA setup");
      }
    } catch {
      setError("Network error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerify = async () => {
    if (!/^\d{6}$/.test(otpCode)) {
      setError("Enter a 6-digit code");
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await fetchWithAuth("/api/2fa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: otpCode }),
      });
      const data = await res.json();
      if (data.success) {
        setIs2FAEnabled(true);
        setOtpCode("");
        // Show recovery codes returned by the API — user MUST save them
        if (
          Array.isArray(data.data?.backupCodes) &&
          data.data.backupCodes.length > 0
        ) {
          setBackupCodes(data.data.backupCodes);
          setBackupCodesAcked(false);
          setStep("backup");
        } else {
          setStep("idle");
          setSuccess("Two-factor authentication enabled!");
          setTimeout(() => setSuccess(null), 4000);
        }
      } else {
        setError(data.error || "Invalid code");
      }
    } catch {
      setError("Network error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDownloadCodes = () => {
    if (backupCodes.length === 0) return;
    const text = [
      "Blip Market — 2FA Recovery Codes",
      "",
      "Each code can be used ONCE if you lose access to your authenticator app.",
      "Keep this file somewhere safe (password manager / printed copy).",
      "",
      ...backupCodes,
      "",
      `Generated: ${new Date().toISOString()}`,
    ].join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
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
      await navigator.clipboard.writeText(backupCodes.join("\n"));
      setSuccess("Recovery codes copied to clipboard");
      setTimeout(() => setSuccess(null), 3000);
    } catch {
      setError("Failed to copy. Please select and copy manually.");
    }
  };

  const handleRegenerate = async () => {
    if (!/^\d{6}$/.test(regenCode)) {
      setError("Enter a 6-digit code");
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await fetchWithAuth("/api/2fa/regenerate-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: regenCode }),
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.data?.backupCodes)) {
        setBackupCodes(data.data.backupCodes);
        setBackupCodesAcked(false);
        setRegenCode("");
        setStep("backup");
      } else {
        setError(data.error || "Failed to regenerate codes");
      }
    } catch {
      setError("Network error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDisable = async () => {
    if (!/^\d{6}$/.test(disableCode)) {
      setError("Enter a 6-digit code");
      return;
    }
    if (!disablePassword) {
      setError("Password is required");
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await fetchWithAuth("/api/2fa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: disablePassword, code: disableCode }),
      });
      const data = await res.json();
      if (data.success) {
        setIs2FAEnabled(false);
        setStep("idle");
        setSuccess("Two-factor authentication disabled.");
        setDisablePassword("");
        setDisableCode("");
        setTimeout(() => setSuccess(null), 4000);
      } else {
        setError(data.error || "Failed to disable 2FA");
      }
    } catch {
      setError("Network error");
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
          <label className="text-xs text-white/40 font-mono uppercase tracking-wider block">
            Two-Factor Authentication
          </label>
          <p className="text-[11px] text-white/25 mt-0.5">
            Secure your account with Google Authenticator
          </p>
        </div>
        <div
          className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
            is2FAEnabled
              ? "bg-white/[0.06] text-[#f5f5f7] border border-white/[0.09]"
              : "bg-white/[0.04] text-white/30 border border-white/[0.06]"
          }`}
        >
          {is2FAEnabled ? "ENABLED" : "OFF"}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 p-3 bg-white/[0.06] border border-white/[0.09] rounded-xl text-sm text-[#f5f5f7]">
          <Check className="w-4 h-4 shrink-0" />
          {success}
        </div>
      )}

      {/* Idle — show enable/disable button */}
      {step === "idle" &&
        (is2FAEnabled ? (
          <div className="space-y-2">
            <button
              onClick={() => {
                setStep("regenerate");
                setError(null);
                setRegenCode("");
              }}
              className="w-full py-3 rounded-xl bg-foreground/[0.04] border border-foreground/[0.08] text-foreground/80 font-medium text-sm hover:bg-foreground/[0.08] transition-colors flex items-center justify-center gap-2"
            >
              <Shield className="w-4 h-4" />
              Regenerate Recovery Codes
            </button>
            <button
              onClick={() => {
                setStep("disable");
                setError(null);
              }}
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
            {isSubmitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Shield className="w-4 h-4" />
            )}
            {isSubmitting ? "Setting up..." : "Enable 2FA"}
          </button>
        ))}

      {/* Backup recovery codes — shown ONCE after successful enable / regen */}
      {step === "backup" && (
        <div className="space-y-3">
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300">
            <p className="font-bold mb-1">Save these recovery codes</p>
            <p className="text-amber-300/80">
              Each code can be used <span className="font-bold">once</span> if
              you lose access to your authenticator app. They will not be shown
              again.
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
              setStep("idle");
              setBackupCodes([]);
              setBackupCodesAcked(false);
              setSuccess("Two-factor authentication enabled!");
              setTimeout(() => setSuccess(null), 4000);
            }}
            disabled={!backupCodesAcked}
            className="w-full py-3 rounded-xl bg-white/[0.06] border border-white/[0.09] text-[#f5f5f7] font-medium text-sm hover:bg-white/[0.06] transition-colors disabled:opacity-30 flex items-center justify-center gap-2"
          >
            <Check className="w-4 h-4" />
            Done
          </button>
        </div>
      )}

      {/* Regenerate codes — require fresh OTP */}
      {step === "regenerate" && (
        <div className="space-y-3">
          <p className="text-xs text-foreground/50">
            Enter your current authenticator code to generate new recovery
            codes. Old codes will be invalidated.
          </p>
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={regenCode}
            onChange={(e) =>
              setRegenCode(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
            placeholder="6-digit authenticator code"
            className="w-full bg-foreground/[0.04] border border-foreground/[0.08] rounded-xl px-4 py-3 text-sm text-foreground text-center font-mono tracking-[0.3em] placeholder:text-foreground/30 placeholder:tracking-normal outline-none focus:border-white/[0.12] transition-colors"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={() => {
                setStep("idle");
                setRegenCode("");
                setError(null);
              }}
              className="flex-1 py-3 rounded-xl bg-foreground/[0.04] border border-foreground/[0.06] text-foreground/50 font-medium text-sm hover:bg-foreground/[0.08] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleRegenerate}
              disabled={isSubmitting || regenCode.length !== 6}
              className="flex-1 py-3 rounded-xl bg-white/[0.06] border border-white/[0.12] text-[#f5f5f7] font-medium text-sm hover:bg-white/[0.08] transition-colors disabled:opacity-30 flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Shield className="w-4 h-4" />
              )}
              {isSubmitting ? "Generating..." : "Generate New Codes"}
            </button>
          </div>
        </div>
      )}

      {/* Setup — show QR code and verify */}
      {step === "verify" && (
        <div className="space-y-4">
          <div className="text-xs text-white/50 space-y-1">
            <p>
              1. Open{" "}
              <span className="text-white/70 font-medium">
                Google Authenticator
              </span>{" "}
              on your phone
            </p>
            <p>2. Scan the QR code below or enter the key manually</p>
            <p>3. Enter the 6-digit code to confirm</p>
          </div>

          {/* QR Code */}
          <div className="flex justify-center py-3">
            <div className="bg-white rounded-xl p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrDataUrl}
                alt="2FA QR Code"
                className="w-[180px] h-[180px]"
              />
            </div>
          </div>

          {/* Manual Key */}
          <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] p-3">
            <p className="text-[10px] text-white/30 font-mono uppercase tracking-wider mb-1">
              Manual Entry Key
            </p>
            <p className="text-sm text-white/80 font-mono break-all select-all">
              {manualSecret}
            </p>
          </div>

          {/* OTP Input */}
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={otpCode}
            onChange={(e) =>
              setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
            placeholder="Enter 6-digit code"
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white text-center font-mono tracking-[0.3em] placeholder:text-white/20 placeholder:tracking-normal outline-none focus:border-white/[0.12] transition-colors"
            autoFocus
          />

          <div className="flex gap-2">
            <button
              onClick={() => {
                setStep("idle");
                setError(null);
                setOtpCode("");
              }}
              className="flex-1 py-3 rounded-xl bg-white/[0.04] border border-white/[0.06] text-white/50 font-medium text-sm hover:bg-accent-subtle transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleVerify}
              disabled={isSubmitting || otpCode.length !== 6}
              className="flex-1 py-3 rounded-xl bg-white/[0.06] border border-white/[0.09] text-[#f5f5f7] font-medium text-sm hover:bg-white/[0.06] transition-colors disabled:opacity-30 flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              {isSubmitting ? "Verifying..." : "Confirm"}
            </button>
          </div>
        </div>
      )}

      {/* Disable — require password + OTP */}
      {step === "disable" && (
        <div className="space-y-3">
          <p className="text-xs text-white/40">
            Enter your password and current authenticator code to disable 2FA.
          </p>

          <div className="relative">
            <input
              type={showDisablePassword ? "text" : "password"}
              value={disablePassword}
              onChange={(e) => setDisablePassword(e.target.value)}
              placeholder="Current password"
              autoComplete="current-password"
              className="w-full bg-foreground/[0.04] border border-foreground/[0.08] rounded-xl px-4 py-3 pr-10 text-sm text-foreground placeholder:text-foreground/30 outline-none focus:border-white/[0.12] transition-colors"
            />
            <button
              type="button"
              onClick={() => setShowDisablePassword(!showDisablePassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 z-10 text-foreground/60 hover:text-foreground"
            >
              {showDisablePassword ? (
                <EyeOff className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
            </button>
          </div>

          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={disableCode}
            onChange={(e) =>
              setDisableCode(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
            placeholder="6-digit authenticator code"
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white text-center font-mono tracking-[0.3em] placeholder:text-white/20 placeholder:tracking-normal outline-none focus:border-white/[0.12] transition-colors"
          />

          <div className="flex gap-2">
            <button
              onClick={() => {
                setStep("idle");
                setError(null);
                setDisablePassword("");
                setDisableCode("");
              }}
              className="flex-1 py-3 rounded-xl bg-white/[0.04] border border-white/[0.06] text-white/50 font-medium text-sm hover:bg-accent-subtle transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleDisable}
              disabled={
                isSubmitting || !disablePassword || disableCode.length !== 6
              }
              className="flex-1 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 font-medium text-sm hover:bg-[var(--color-error)]/20 transition-colors disabled:opacity-30 flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Shield className="w-4 h-4" />
              )}
              {isSubmitting ? "Disabling..." : "Disable 2FA"}
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
      const res = await fetchWithAuth("/api/auth/sessions");
      const data = await res.json();
      if (data.success) {
        setSessions(data.data || []);
      } else {
        setError(data.error || "Failed to load sessions");
      }
    } catch {
      setError("Failed to load sessions");
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
      const res = await fetchWithAuth(
        `/api/auth/sessions?session_id=${sessionId}`,
        { method: "DELETE" },
      );
      const data = await res.json();
      if (data.success) {
        setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      }
    } catch {
      // ignore
    } finally {
      setIsRevoking(null);
    }
  };

  const handleRevokeAll = async () => {
    if (
      !confirm(
        "Log out of ALL devices including this one? You will need to log in again.",
      )
    ) {
      return;
    }
    setIsRevokingAll(true);
    try {
      const res = await fetchWithAuth("/api/auth/sessions", {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) {
        // Server revoked every session row — wipe the in-memory mirror so
        // logged-in UI gates flip immediately. The cookie pair was cleared
        // by the same response (DELETE /api/auth/sessions invalidates the
        // current session and the access cookie expires shortly after).
        // No localStorage / sessionStorage to clean — we no longer keep
        // any identity material there.
        try {
          useMerchantStore.getState().setSessionToken(null);
          useMerchantStore.getState().setMerchantId?.(null);
          useMerchantStore.getState().setMerchantInfo?.(null as any);
        } catch {
          /* store not hydrated */
        }
        // Hard navigation so the new page tree boots without any cached
        // auth context, which is exactly what we want after a global logout.
        window.location.href = "/market?logged_out=all";
      } else {
        alert(
          data.error || "Failed to log out of all devices. Please try again.",
        );
        setIsRevokingAll(false);
      }
    } catch {
      alert("Network error. Please check your connection and try again.");
      setIsRevokingAll(false);
    }
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "—";
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "Just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    return `${diffDay}d ago`;
  };

  return (
    <div className="bg-white/[0.02] rounded-2xl border border-white/[0.06] p-5 space-y-4">
      <div className="flex items-center justify-between">
        <label className="text-xs text-white/40 font-mono uppercase tracking-wider">
          Active Sessions
        </label>
        {sessions.length > 1 && (
          <button
            onClick={handleRevokeAll}
            disabled={isRevokingAll}
            className="text-[10px] text-red-400/70 hover:text-[var(--color-error)] font-medium transition-colors flex items-center gap-1"
          >
            {isRevokingAll ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <LogOut className="w-3 h-3" />
            )}
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
        <p className="text-xs text-white/30 text-center py-4">
          No active sessions
        </p>
      )}

      {!isLoading && sessions.length > 0 && (
        <div className="space-y-2">
          {(() => {
            // Identify CURRENT by the server-provided session id. Fall back to
            // the first row only for legacy tokens that carry no session id.
            const currentId = sessions.find((s) => s.isCurrent)?.id ?? null;
            return sessions.map((session, idx) => {
            const isCurrent = currentId ? session.id === currentId : idx === 0;
            const isMobile =
              session.deviceType === "mobile" ||
              session.deviceType === "tablet";
            const browserLabel = session.browser
              ? `${session.browser}${session.browserVersion ? ` ${session.browserVersion}` : ""}`
              : session.device || "Unknown Browser";
            const osLabel = session.os
              ? `${session.os}${session.osVersion ? ` ${session.osVersion}` : ""}`
              : null;
            const deviceLabel =
              session.deviceName || session.device || "Unknown Device";

            return (
              <div
                key={session.id}
                className={`p-4 rounded-xl border ${isCurrent ? "bg-white/[0.06] border-white/[0.12]" : "bg-white/[0.03] border-white/[0.04]"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    {/* Device icon */}
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${isCurrent ? "bg-white/[0.06]" : "bg-white/[0.06]"}`}
                    >
                      {isMobile ? (
                        <Smartphone
                          className={`w-5 h-5 ${isCurrent ? "text-[#f5f5f7]" : "text-white/40"}`}
                        />
                      ) : (
                        <Monitor
                          className={`w-5 h-5 ${isCurrent ? "text-[#f5f5f7]" : "text-white/40"}`}
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      {/* Row 1: Browser + Current badge */}
                      <div className="flex items-center gap-2">
                        <p className="text-[13px] font-semibold text-white/85 truncate">
                          {browserLabel}
                        </p>
                        {isCurrent && (
                          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-white/[0.06] text-[#f5f5f7] tracking-wide">
                            CURRENT
                          </span>
                        )}
                      </div>

                      {/* Row 2: OS + Device */}
                      <div className="flex items-center gap-2 mt-1">
                        {osLabel && (
                          <span className="text-[11px] text-white/50 font-medium">
                            {osLabel}
                          </span>
                        )}
                        {osLabel && deviceLabel && (
                          <span className="text-white/15">·</span>
                        )}
                        <span className="text-[11px] text-white/35">
                          {deviceLabel}
                        </span>
                      </div>

                      {/* Row 3: IP + Times */}
                      <div className="flex items-center gap-3 mt-1.5 text-[10px] text-white/30">
                        <span className="flex items-center gap-1">
                          <Globe className="w-3 h-3 text-white/20" />
                          <span className="font-mono">
                            {session.ip || "Unknown IP"}
                          </span>
                        </span>
                        <span className="flex items-center gap-1">
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${isCurrent ? "bg-white/[0.08] animate-pulse" : "bg-white/20"}`}
                          />
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
                      {isRevoking === session.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <LogOut className="w-3 h-3" />
                      )}
                      Revoke
                    </button>
                  )}
                </div>
              </div>
            );
            });
          })()}
        </div>
      )}
    </div>
  );
}

// ── Theme Section Component ──────────────────────────────────────────

const THEME_PREVIEWS: Record<
  string,
  {
    bg: string;
    sidebar: string;
    card: string;
    accent: string;
    text: string;
    muted: string;
  }
> = {
  dark: {
    bg: "#000000",
    sidebar: "#060606",
    card: "#0c0c0c",
    accent: "#F97316",
    text: "#ffffff",
    muted: "#525252",
  },
  mono: {
    bg: "#000000",
    sidebar: "#060606",
    card: "#0c0c0c",
    accent: "#FFFFFF",
    text: "#ffffff",
    muted: "#525252",
  },
  navy: {
    bg: "#0B1120",
    sidebar: "#131D35",
    card: "#161E31",
    accent: "#38BDF8",
    text: "#F1F5F9",
    muted: "#94A3B8",
  },
  emerald: {
    bg: "#050705",
    sidebar: "#0A120E",
    card: "#0D1410",
    accent: "#10B981",
    text: "#ECFDF5",
    muted: "#6B7280",
  },
  orchid: {
    bg: "#1A1A2E",
    sidebar: "#16213E",
    card: "#1F2B4D",
    accent: "#E94560",
    text: "#FFFFFF",
    muted: "#94A3B8",
  },
  gold: {
    bg: "#1C1C1C",
    sidebar: "#252525",
    card: "#2D2D2D",
    accent: "#D4AF37",
    text: "#E0E0E0",
    muted: "#888888",
  },
  clean: {
    bg: "#FFFFFF",
    sidebar: "#F9FAFB",
    card: "#F3F4F6",
    accent: "#3B82F6",
    text: "#111827",
    muted: "#6B7280",
  },
  light: {
    bg: "#FDF6E3",
    sidebar: "#EEE8D5",
    card: "#E0DAC8",
    accent: "#268BD2",
    text: "#073642",
    muted: "#586E75",
  },
};

function ThemePreviewCard({
  colors,
  isActive,
}: {
  colors: (typeof THEME_PREVIEWS)["dark"];
  isActive: boolean;
}) {
  return (
    <div
      className={`rounded-lg overflow-hidden border-2 transition-all ${isActive ? "border-[var(--primary)] ring-2 ring-[var(--primary)]/20" : "border-border hover:border-border-strong"}`}
    >
      <div className="flex h-[72px]" style={{ backgroundColor: colors.bg }}>
        <div
          className="w-[28%] flex flex-col p-1 gap-0.5"
          style={{ backgroundColor: colors.sidebar }}
        >
          <div
            className="h-1.5 w-8 rounded-full"
            style={{ backgroundColor: colors.muted, opacity: 0.4 }}
          />
          <div
            className="h-6 rounded"
            style={{ backgroundColor: colors.card }}
          />
          <div className="flex gap-1 mt-auto">
            <div
              className="flex-1 h-3 rounded"
              style={{ backgroundColor: colors.accent }}
            />
            <div
              className="flex-1 h-3 rounded"
              style={{
                backgroundColor: colors.card,
                border: `1px solid ${colors.muted}33`,
              }}
            />
          </div>
        </div>
        <div className="flex-1 flex flex-col p-1 gap-0.5">
          <div
            className="h-1.5 w-12 rounded-full"
            style={{ backgroundColor: colors.muted, opacity: 0.3 }}
          />
          <div
            className="flex-1 rounded"
            style={{ backgroundColor: colors.card }}
          />
          <div className="flex gap-0.5">
            <div
              className="h-2 flex-1 rounded-full"
              style={{ backgroundColor: colors.accent, opacity: 0.2 }}
            />
            <div
              className="h-2 flex-1 rounded-full"
              style={{ backgroundColor: colors.card }}
            />
          </div>
        </div>
        <div className="w-[25%] flex flex-col p-1 gap-0.5">
          <div
            className="h-1.5 w-8 rounded-full"
            style={{ backgroundColor: colors.muted, opacity: 0.3 }}
          />
          <div className="space-y-0.5 flex-1">
            <div
              className="h-2 rounded"
              style={{ backgroundColor: colors.card }}
            />
            <div
              className="h-2 rounded"
              style={{ backgroundColor: colors.card }}
            />
            <div
              className="h-2 rounded"
              style={{ backgroundColor: colors.card }}
            />
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
        <label className="text-xs text-white/40 font-mono uppercase tracking-wider block">
          Theme
        </label>
        <p className="text-[11px] text-white/25 mt-1">
          Customize the look of your dashboard. Only you see this.
        </p>
      </div>

      {previewing && (
        <div
          className="flex items-center justify-between px-3 py-2 rounded-xl"
          style={{ backgroundColor: "var(--primary-dim)" }}
        >
          <span className="text-xs text-white/70">
            Previewing{" "}
            <span className="font-semibold" style={{ color: "var(--primary)" }}>
              {THEMES.find((t) => t.id === previewing)?.label}
            </span>
          </span>
          <div className="flex gap-2">
            <button
              onClick={handleApply}
              className="px-3 py-1 rounded-lg text-[11px] font-medium text-[#0b0b0c]"
              style={{ backgroundColor: "var(--primary)" }}
            >
              Apply
            </button>
            <button
              onClick={handleCancel}
              className="px-3 py-1 rounded-lg text-[11px] font-medium bg-white/[0.06] text-white/60 hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        {THEMES.map((t) => {
          const colors = THEME_PREVIEWS[t.id];
          const isActive = (previewing || theme) === t.id;
          return (
            <div key={t.id} className="space-y-1.5">
              <button
                onClick={() => handleSelect(t.id)}
                className="w-full text-left cursor-pointer"
              >
                <ThemePreviewCard colors={colors} isActive={isActive} />
              </button>
              <div className="flex items-center justify-between px-0.5">
                <div className="flex items-center gap-1.5">
                  <div
                    className={`w-3 h-3 rounded-full border-2 flex items-center justify-center transition-colors`}
                    style={{
                      borderColor: isActive
                        ? "var(--primary)"
                        : "rgba(255,255,255,0.2)",
                    }}
                  >
                    {isActive && (
                      <div
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: "var(--primary)" }}
                      />
                    )}
                  </div>
                  <span
                    className={`text-[10px] font-medium ${isActive ? "text-white/90" : "text-white/40"}`}
                  >
                    {t.label}
                  </span>
                </div>
                {!isActive && (
                  <button
                    onClick={() => handlePreview(t.id)}
                    className="text-[9px] text-white/30 hover:text-foreground/60 font-medium transition-colors"
                  >
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
