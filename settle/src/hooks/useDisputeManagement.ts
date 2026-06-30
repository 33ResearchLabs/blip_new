"use client";

import { useState, useCallback } from "react";
import type { ComplianceMember } from "./useComplianceAuth";
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
import { txAnchoredKey } from '@/lib/api/idempotencyKeys';

interface DisputeOrder {
  id: string;
  orderNumber: string;
  type: "buy" | "sell";
  paymentMethod: "bank" | "cash";
  cryptoAmount: number;
  fiatAmount: number;
  cryptoCurrency: string;
  fiatCurrency: string;
  rate: number;
  orderStatus: string;
  createdAt: string;
  expiresAt: string;
  lifecycle?: Array<{
    status: string;
    fromStatus: string | null;
    actorType: string;
    timestamp: string;
    deltaMs: number;
    deltaFormatted: string;
  }>;
  dispute: {
    id: string;
    status: string;
    reason: string;
    description: string;
    initiatedBy: "user" | "merchant";
    createdAt: string;
    resolvedAt: string | null;
    resolutionNotes: string | null;
  } | null;
  user: {
    id: string;
    name: string;
    wallet: string;
    rating: number;
    trades: number;
  };
  merchant: {
    id: string;
    name: string;
    wallet: string;
    rating: number;
    trades: number;
  };
  isM2M?: boolean;
  escrow?: {
    txHash: string;
    tradeId: number;
    creatorWallet: string;
  } | null;
  buyerMerchant?: {
    id: string;
    name: string;
    wallet: string;
    rating: number;
    trades: number;
  } | null;
}

interface ResolveForm {
  resolution: "" | "user" | "merchant" | "split";
  notes: string;
  splitUser: number;
  splitMerchant: number;
}

interface SolanaWalletForDispute {
  connected: boolean;
  walletAddress: string | null;
  resolveDispute: (params: {
    creatorPubkey: string;
    tradeId: number;
    resolution: "release_to_buyer" | "refund_to_seller";
  }) => Promise<{ txHash: string; success: boolean }>;
  refundEscrow: (params: {
    creatorPubkey: string;
    tradeId: number;
  }) => Promise<{ txHash: string; success: boolean }>;
}

interface UseDisputeManagementReturn {
  disputes: DisputeOrder[];
  showResolveModal: boolean;
  setShowResolveModal: React.Dispatch<React.SetStateAction<boolean>>;
  selectedDispute: DisputeOrder | null;
  setSelectedDispute: React.Dispatch<React.SetStateAction<DisputeOrder | null>>;
  resolveForm: ResolveForm;
  setResolveForm: React.Dispatch<React.SetStateAction<ResolveForm>>;
  isProcessingOnChain: boolean;
  fetchDisputes: () => Promise<void>;
  startInvestigating: (orderId: string) => Promise<void>;
  resolveDispute: () => Promise<void>;
  finalizeDispute: () => Promise<void>;
  refundDepositor: (dispute: DisputeOrder) => Promise<void>;
  getDisputeReasonInfo: (reason: string | undefined) => { icon: string; label: string; color: string };
}

export function useDisputeManagement(
  member: ComplianceMember | null,
  solanaWallet: SolanaWalletForDispute,
  addNotification: (type: "dispute" | "resolution" | "escalation" | "system", message: string, disputeId?: string) => void,
): UseDisputeManagementReturn {
  const [disputes, setDisputes] = useState<DisputeOrder[]>([]);
  const [showResolveModal, setShowResolveModal] = useState(false);
  const [selectedDispute, setSelectedDispute] = useState<DisputeOrder | null>(null);
  const [resolveForm, setResolveForm] = useState<ResolveForm>({
    resolution: "",
    notes: "",
    splitUser: 50,
    splitMerchant: 50,
  });
  const [isProcessingOnChain, setIsProcessingOnChain] = useState(false);

  // Fetch disputes
  const fetchDisputes = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`/api/compliance/disputes`);
      const data = await res.json();
      if (data.success) {
        setDisputes(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch disputes:", error);
    }
  }, []);

  // Get dispute reason icon and label
  const getDisputeReasonInfo = (reason: string | undefined) => {
    switch (reason) {
      case "payment_not_received":
        return { icon: "\u{1F4B8}", label: "Payment Not Received", color: "text-red-400" };
      case "crypto_not_received":
        return { icon: "\u{1FA99}", label: "Crypto Not Received", color: "text-orange-400" };
      case "wrong_amount":
        return { icon: "\u{1F522}", label: "Wrong Amount", color: "text-blue-400" };
      case "fraud":
        return { icon: "\u{1F6A8}", label: "Fraud", color: "text-red-500" };
      default:
        return { icon: "\u{2753}", label: reason || "Other", color: "text-gray-400" };
    }
  };

  // Start investigating
  const startInvestigating = async (orderId: string) => {
    if (!member) return;

    const dispute = disputes.find((d) => d.id === orderId);

    try {
      const res = await fetchWithAuth(`/api/compliance/disputes/${orderId}/resolve`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "investigating",
          complianceId: member.id,
          notes: "Started investigation",
        }),
      });

      if (res.ok) {
        addNotification("dispute", `Started investigation on dispute #${dispute?.orderNumber || orderId}`, orderId);
        fetchDisputes();
      }
    } catch (error) {
      console.error("Failed to start investigation:", error);
    }
  };

  // Resolve dispute
  const handleResolveDispute = async () => {
    if (!member || !selectedDispute || !resolveForm.resolution) return;

    try {
      const res = await fetchWithAuth(`/api/compliance/disputes/${selectedDispute.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resolution: resolveForm.resolution,
          notes: resolveForm.notes,
          complianceId: member.id,
          splitPercentage:
            resolveForm.resolution === "split"
              ? {
                  user: resolveForm.splitUser,
                  merchant: resolveForm.splitMerchant,
                }
              : undefined,
        }),
      });

      const data = await res.json().catch(() => null);

      if (res.ok && data?.success) {
        const resolutionText =
          resolveForm.resolution === "user"
            ? "in favor of user"
            : resolveForm.resolution === "merchant"
              ? "in favor of merchant"
              : "with split";
        // This endpoint PROPOSES a resolution — both parties must still confirm
        // before it's final (see the /resolve route). Don't claim "resolved".
        addNotification(
          "resolution",
          `Dispute #${selectedDispute.orderNumber} — resolution proposed ${resolutionText}, awaiting confirmation`,
          selectedDispute.id,
        );
        setShowResolveModal(false);
        setSelectedDispute(null);
        setResolveForm({ resolution: "", notes: "", splitUser: 50, splitMerchant: 50 });
        fetchDisputes();
      } else {
        // Surface the failure instead of silently no-op'ing — e.g. 409
        // "Resolution already proposed", 400 invalid/already-resolved, 403/404.
        addNotification(
          "dispute",
          `Failed to propose resolution: ${data?.error || `request failed (${res.status})`}`,
          selectedDispute.id,
        );
      }
    } catch (error) {
      console.error("Failed to resolve dispute:", error);
      addNotification(
        "dispute",
        "Failed to propose resolution. Check your connection and try again.",
        selectedDispute.id,
      );
    }
  };

  // Finalize dispute — blockchain-first: settle on-chain, THEN finalize the DB.
  //
  // Phase-1 ordering fix. Previously the DB was finalized first and the
  // on-chain settlement attempted afterwards (and could be silently skipped),
  // which could mark a dispute "resolved" while funds stayed locked on-chain.
  // Now, for an escrowed order in real mode we settle on-chain FIRST and only
  // finalize the DB with the confirmed tx hash. The human compliance-wallet
  // signature remains the settlement path (fallback) until the backend arbiter
  // lands in Phase 2.
  const finalizeDispute = async () => {
    if (!member || !selectedDispute || !resolveForm.resolution) return;
    if (resolveForm.resolution === "split") {
      addNotification("dispute", "Split resolution is not supported.", selectedDispute.id);
      return;
    }

    const mockMode = process.env.NEXT_PUBLIC_MOCK_MODE === "true";
    const hasOnChainEscrow = !!selectedDispute.escrow?.tradeId;
    const canDoOnChain =
      member.wallet_address &&
      solanaWallet.connected &&
      solanaWallet.walletAddress === member.wallet_address;

    // Real-mode escrowed disputes must settle on-chain before the DB is touched.
    const needsOnChain = hasOnChainEscrow && !mockMode;

    let releaseTxHash: string | undefined;
    let refundTxHash: string | undefined;

    if (needsOnChain) {
      if (!canDoOnChain) {
        addNotification(
          "dispute",
          "Connect your registered compliance wallet to settle this dispute on-chain before finalizing.",
          selectedDispute.id,
        );
        return;
      }
      if (!selectedDispute.escrow?.creatorWallet) {
        addNotification("dispute", "Missing on-chain escrow details for this order.", selectedDispute.id);
        return;
      }

      setIsProcessingOnChain(true);
      try {
        const resolutionType = resolveForm.resolution === "user" ? "release_to_buyer" : "refund_to_seller";
        addNotification("system", `Settling dispute on-chain (${resolutionType})...`, selectedDispute.id);

        const result = await solanaWallet.resolveDispute({
          creatorPubkey: selectedDispute.escrow.creatorWallet,
          tradeId: selectedDispute.escrow.tradeId,
          resolution: resolutionType,
        });

        if (!result.success || !result.txHash) {
          throw new Error("Dispute resolution failed");
        }

        if (resolveForm.resolution === "user") releaseTxHash = result.txHash;
        else refundTxHash = result.txHash;

        addNotification("resolution", `On-chain settled: ${result.txHash.slice(0, 8)}...`, selectedDispute.id);
      } catch (chainError) {
        setIsProcessingOnChain(false);
        const errorMsg = chainError instanceof Error ? chainError.message : "Unknown error";
        const hint =
          errorMsg.includes("authority") || errorMsg.includes("signer") || errorMsg.includes("constraint")
            ? " Your wallet may not be a registered arbiter."
            : "";
        addNotification(
          "dispute",
          `On-chain settlement failed: ${errorMsg}.${hint} Order remains disputed; nothing was finalized.`,
          selectedDispute.id,
        );
        return; // do NOT finalize the DB if on-chain settlement failed
      } finally {
        setIsProcessingOnChain(false);
      }
    }

    try {
      const settledHash = releaseTxHash || refundTxHash;
      const idempotencyKey = settledHash
        ? txAnchoredKey(settledHash, "dispute_finalize")
        : `dispute_finalize:${selectedDispute.id}:${resolveForm.resolution}`;

      const res = await fetchWithAuth(`/api/compliance/disputes/${selectedDispute.id}/finalize`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          resolution: resolveForm.resolution,
          notes: resolveForm.notes,
          complianceId: member.id,
          release_tx_hash: releaseTxHash,
          refund_tx_hash: refundTxHash,
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        const resolutionText =
          resolveForm.resolution === "user"
            ? "in favor of user (escrow released)"
            : "in favor of merchant (escrow refunded)";
        addNotification("resolution", `Dispute #${selectedDispute.orderNumber} FINALIZED ${resolutionText}`, selectedDispute.id);

        setShowResolveModal(false);
        setSelectedDispute(null);
        setResolveForm({ resolution: "", notes: "", splitUser: 50, splitMerchant: 50 });
        fetchDisputes();
      } else {
        console.error("Failed to finalize dispute:", data.error);
        addNotification("dispute", `Failed to finalize: ${data.error}`, selectedDispute.id);
      }
    } catch (error) {
      console.error("Failed to finalize dispute:", error);
      addNotification("dispute", "Failed to finalize dispute. Check your connection and try again.", selectedDispute.id);
    }
  };

  // Refund depositor directly via on-chain refundEscrow (no arbiter needed).
  // Works when escrow is in Funded state (dispute not raised on-chain).
  // The connected wallet must be the original escrow depositor.
  const refundDepositor = async (dispute: DisputeOrder) => {
    if (!dispute.escrow?.tradeId || !dispute.escrow?.creatorWallet) {
      addNotification("dispute", "No on-chain escrow found for this order", dispute.id);
      return;
    }
    if (!solanaWallet.connected) {
      addNotification("dispute", "Connect the depositor's wallet first", dispute.id);
      return;
    }
    setIsProcessingOnChain(true);
    try {
      addNotification("system", "Sending refund to depositor on-chain...", dispute.id);
      const result = await solanaWallet.refundEscrow({
        creatorPubkey: dispute.escrow.creatorWallet,
        tradeId: dispute.escrow.tradeId,
      });
      if (result.success && result.txHash) {
        addNotification("resolution", `Refund sent on-chain: ${result.txHash.slice(0, 8)}...`, dispute.id);
        // Mark order cancelled + record refund tx in DB
        await fetchWithAuth(`/api/orders/${dispute.id}/escrow`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": txAnchoredKey(result.txHash, "depositor_refund"),
          },
          body: JSON.stringify({ tx_hash: result.txHash, action: "refund", actor_type: "compliance", actor_id: member?.id }),
        });
        fetchDisputes();
      }
    } catch (err: any) {
      addNotification("dispute", `Refund failed: ${err?.message || "Unknown error"}`, dispute.id);
    } finally {
      setIsProcessingOnChain(false);
    }
  };

  return {
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
    resolveDispute: handleResolveDispute,
    finalizeDispute,
    refundDepositor,
    getDisputeReasonInfo,
  };
}

export type { DisputeOrder, ResolveForm };
