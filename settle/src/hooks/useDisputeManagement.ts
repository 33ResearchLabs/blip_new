"use client";

import { useState, useCallback } from "react";
import type { ComplianceMember } from "./useComplianceAuth";
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';

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
    tradeId: string;
    resolution: "release_to_buyer" | "refund_to_seller";
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

      if (res.ok) {
        const resolutionText =
          resolveForm.resolution === "user"
            ? "in favor of user"
            : resolveForm.resolution === "merchant"
              ? "in favor of merchant"
              : "with split";
        addNotification("resolution", `Dispute #${selectedDispute.orderNumber} resolved ${resolutionText}`, selectedDispute.id);
        setShowResolveModal(false);
        setSelectedDispute(null);
        setResolveForm({ resolution: "", notes: "", splitUser: 50, splitMerchant: 50 });
        fetchDisputes();
      }
    } catch (error) {
      console.error("Failed to resolve dispute:", error);
    }
  };

  // Finalize dispute - forcibly resolve and handle escrow
  const finalizeDispute = async () => {
    if (!member || !selectedDispute || !resolveForm.resolution) return;

    const canDoOnChain = member.wallet_address && solanaWallet.connected && solanaWallet.walletAddress === member.wallet_address;

    try {
      const res = await fetchWithAuth(`/api/compliance/disputes/${selectedDispute.id}/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resolution: resolveForm.resolution,
          notes: resolveForm.notes,
          complianceId: member.id,
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        // If wallet-connected and there's escrow to process, attempt on-chain action
        if (canDoOnChain && data.data?.escrowDetails) {
          setIsProcessingOnChain(true);
          const escrow = data.data.escrowDetails;

          try {
            if (resolveForm.resolution === "user" || resolveForm.resolution === "merchant") {
              const resolutionType = resolveForm.resolution === "user" ? "release_to_buyer" : "refund_to_seller";
              addNotification("system", `Resolving dispute on-chain (${resolutionType})...`, selectedDispute.id);

              const result = await solanaWallet.resolveDispute({
                creatorPubkey: escrow.escrow_creator_wallet,
                tradeId: escrow.escrow_trade_id,
                resolution: resolutionType,
              });

              if (result.success && result.txHash) {
                addNotification("resolution", `On-chain dispute resolved: ${result.txHash.slice(0, 8)}...`, selectedDispute.id);

                await fetchWithAuth(`/api/orders/${selectedDispute.id}/escrow`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    tx_hash: result.txHash,
                    actor_type: "system",
                    actor_id: member.id,
                  }),
                });
              } else {
                throw new Error("Dispute resolution failed");
              }
            }
          } catch (chainError) {
            console.error("[Compliance] On-chain operation failed:", chainError);
            const errorMsg = chainError instanceof Error ? chainError.message : "Unknown error";
            if (errorMsg.includes("authority") || errorMsg.includes("signer") || errorMsg.includes("constraint")) {
              addNotification("dispute", `On-chain failed: Wallet may not have program authority. Manual processing required.`, selectedDispute.id);
            } else {
              addNotification("dispute", `On-chain operation failed: ${errorMsg}`, selectedDispute.id);
            }
            console.log("[Compliance] Escrow details for manual processing:", escrow);
          } finally {
            setIsProcessingOnChain(false);
          }
        } else if (data.data?.escrowDetails) {
          console.log("[Compliance] Escrow details for manual processing:", data.data.escrowDetails);
          addNotification("system", `Escrow details logged to console for manual processing`, selectedDispute.id);
        }

        const resolutionText =
          resolveForm.resolution === "user"
            ? "in favor of user (escrow released)"
            : resolveForm.resolution === "merchant"
              ? "in favor of merchant (escrow refunded)"
              : "with split";
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
    getDisputeReasonInfo,
  };
}

export type { DisputeOrder, ResolveForm };
