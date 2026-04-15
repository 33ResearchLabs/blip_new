"use client";

import { useState, useCallback, useEffect } from "react";
import type {
  Order,
  OrderStatus,
  OrderStep,
  BankAccount,
} from "@/components/user/screens/types";
import { fetchWithAuth, generateIdempotencyKey } from "@/lib/api/fetchWithAuth";
import { fetchDisputeInfoFromApi } from "@/lib/api/disputeApi";
import { showAlert } from "@/context/ModalContext";
// Simple loading state — no step-by-step progress needed

interface UseUserOrderActionsParams {
  userId: string | null;
  activeOrder: Order | undefined;
  solanaWallet: any;
  playSound: (
    sound:
      | "message"
      | "send"
      | "trade_start"
      | "trade_complete"
      | "notification"
      | "error"
      | "click"
      | "new_order"
      | "order_complete",
  ) => void;
  toast: any;
  showBrowserNotification: (
    title: string,
    body: string,
    orderId?: string,
  ) => void;
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>;
  setIsLoading: (loading: boolean) => void;
  fetchOrders: (uid: string) => Promise<void>;
}

export function useUserOrderActions({
  userId,
  activeOrder,
  solanaWallet,
  playSound,
  toast,
  showBrowserNotification,
  setOrders,
  setIsLoading,
  fetchOrders,
}: UseUserOrderActionsParams) {
  // Helper: optimistically update an order AND clear action buttons instantly.
  // This prevents the "toast fires but old button still visible" problem.
  const optimisticOrderUpdate = useCallback(
    (orderId: string, updates: Record<string, unknown>) => {
      setOrders((prev) =>
        prev.map((o) => {
          if (o.id !== orderId) return o;
          const updated = { ...o, ...updates };
          // Clear backend-driven action buttons so they don't flash stale state
          if ((updated as any).dbOrder) {
            (updated as any).dbOrder = {
              ...(updated as any).dbOrder,
              primaryAction: null,
              secondaryAction: null,
              ...(updates.dbStatus ? { status: updates.dbStatus } : {}),
            };
          }
          return updated;
        }),
      );
    },
    [setOrders],
  );

  // Dispute state
  const [showDisputeModal, setShowDisputeModal] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");
  const [disputeDescription, setDisputeDescription] = useState("");
  const [isSubmittingDispute, setIsSubmittingDispute] = useState(false);
  const [disputeInfo, setDisputeInfo] = useState<{
    id: string;
    status: string;
    reason: string;
    proposed_resolution?: string;
    resolution_notes?: string;
    user_confirmed?: boolean;
    merchant_confirmed?: boolean;
  } | null>(null);
  const [isRespondingToResolution, setIsRespondingToResolution] =
    useState(false);

  // Extension state
  const [extensionRequest, setExtensionRequest] = useState<{
    orderId: string;
    requestedBy: "user" | "merchant";
    extensionMinutes: number;
    extensionCount: number;
    maxExtensions: number;
  } | null>(null);
  const [requestingExtension, setRequestingExtension] = useState(false);

  // Loading is handled by setIsLoading — no extra state needed

  // Hydrate extension state from backend on mount / order change.
  // Without this, a page refresh loses the in-memory extensionRequest
  // and the UI falls back to "Inactivity Warning" even though a request
  // is pending or was already accepted.
  useEffect(() => {
    if (!activeOrder?.id) return;
    let cancelled = false;
    fetchWithAuth(`/api/orders/${activeOrder.id}/extension`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled || !data.success) return;
        if (data.data?.pendingRequest) {
          setExtensionRequest({
            orderId: activeOrder.id,
            requestedBy: data.data.pendingRequest.requestedBy,
            extensionMinutes:
              data.data.pendingRequest.extensionMinutes ||
              data.data.extensionDuration,
            extensionCount: data.data.extensionCount,
            maxExtensions: data.data.maxExtensions,
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeOrder?.id]);

  // Cancel state
  const [isRequestingCancel, setIsRequestingCancel] = useState(false);

  const markPaymentSent = async () => {
    if (!activeOrder || !userId) {
      console.log("markPaymentSent: missing activeOrder or userId", {
        activeOrder: !!activeOrder,
        userId,
      });
      return;
    }

    const hasOnChain =
      solanaWallet.connected &&
      activeOrder.escrowTradeId &&
      activeOrder.escrowCreatorWallet;

    setIsLoading(true);

    try {
      if (hasOnChain) {
        // Step 1: Sign + accept trade
        try {
          const acceptResult = await solanaWallet.acceptTrade({
            creatorPubkey: activeOrder.escrowCreatorWallet,
            tradeId: activeOrder.escrowTradeId,
          });
          if (acceptResult.success) {
            console.log("[User] acceptTrade success:", acceptResult.txHash);
          }
        } catch (acceptErr: any) {
          console.log(
            "[User] acceptTrade skipped (likely already done):",
            acceptErr.message,
          );
        }
        // Step complete — loading continues

        // Step 2: Confirm payment on chain
        try {
          const confirmResult = await solanaWallet.confirmPayment({
            creatorPubkey: activeOrder.escrowCreatorWallet,
            tradeId: activeOrder.escrowTradeId,
          });
          if (confirmResult.success) {
            console.log(
              "[User] On-chain payment confirmed:",
              confirmResult.txHash,
            );
          } else {
            console.warn(
              "[User] On-chain confirmation failed, continuing with API",
            );
          }
        } catch (chainError) {
          console.warn("[User] On-chain confirmation failed:", chainError);
        }
        // Step complete — loading continues
      }

      // Final step: Update order via API
      const res = await fetchWithAuth(`/api/orders/${activeOrder.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": generateIdempotencyKey(),
        },
        body: JSON.stringify({
          status: "payment_sent",
          actor_type: "user",
          actor_id: userId,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        const errorMsg =
          data.error || "Failed to update order. The order may have expired.";
        console.error("Failed to mark payment sent:", errorMsg);
        showAlert("Error", errorMsg, "error");
        setIsLoading(false);
        return;
      }

      // Success! Update UI immediately.
      optimisticOrderUpdate(activeOrder.id, {
        status: "waiting" as OrderStatus,
        step: 3 as OrderStep,
        dbStatus: "payment_sent",
      });
    } catch (err) {
      console.error("Failed to mark payment sent:", err);
      showAlert("Network Error", "Network error. Please try again.", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const confirmFiatReceived = async () => {
    if (!activeOrder || !userId) return;

    setIsLoading(true);

    try {
      if (
        activeOrder.type === "sell" &&
        activeOrder.escrowTradeId &&
        activeOrder.escrowCreatorWallet
      ) {
        const merchantWallet =
          activeOrder.acceptorWalletAddress ||
          activeOrder.merchant.walletAddress;
        const isValidSolanaAddress =
          merchantWallet &&
          /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(merchantWallet);

        if (!solanaWallet.connected) {
          showAlert(
            "Wallet Required",
            "Please connect your wallet to release the escrow.",
            "warning",
          );
          setIsLoading(false);
          return;
        }

        if (!isValidSolanaAddress) {
          console.error("[Release] Invalid/missing merchant wallet:", {
            acceptorWallet: activeOrder.acceptorWalletAddress,
            merchantProfileWallet: activeOrder.merchant.walletAddress,
          });
          showAlert(
            "Invalid Wallet",
            "Merchant wallet address is invalid or missing. Please contact support.",
            "error",
          );
          setIsLoading(false);
          return;
        }

        console.log("[Release] Releasing escrow to merchant:", {
          creatorPubkey: activeOrder.escrowCreatorWallet,
          tradeId: activeOrder.escrowTradeId,
          counterparty: merchantWallet,
          merchantName: activeOrder.merchant.name,
        });

        let releaseResult: { success: boolean; txHash: string; error?: string };
        try {
          try {
            console.log("[Release] Ensuring acceptTrade before release...");
            await solanaWallet.acceptTrade({
              creatorPubkey: activeOrder.escrowCreatorWallet,
              tradeId: activeOrder.escrowTradeId,
            });
            console.log(
              "[Release] acceptTrade succeeded (or was already done)",
            );
          } catch (acceptErr: any) {
            console.log(
              "[Release] acceptTrade skipped (likely already done):",
              acceptErr?.message,
            );
          }

          releaseResult = await solanaWallet.releaseEscrow({
            creatorPubkey: activeOrder.escrowCreatorWallet,
            tradeId: activeOrder.escrowTradeId,
            counterparty: merchantWallet,
          });
        } catch (releaseErr: any) {
          const msg = releaseErr?.message || "";
          console.error("[Release] releaseEscrow failed:", msg);

          if (msg.includes("AccountNotInitialized")) {
            console.log(
              "[Release] Escrow account missing — already released on-chain, completing order...",
            );
            let backendOk = false;
            try {
              const escrowRes = await fetchWithAuth(
                `/api/orders/${activeOrder.id}/escrow`,
                {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    tx_hash: activeOrder.escrowTxHash || "already-released",
                    actor_type: "user",
                    actor_id: userId,
                  }),
                },
              );
              backendOk = escrowRes.ok;
              console.log("[Release] Core-api release result:", backendOk);
            } catch (backendErr) {
              console.error("[Release] Core-api release failed:", backendErr);
            }
            if (!backendOk) {
              try {
                const patchRes = await fetchWithAuth(
                  `/api/orders/${activeOrder.id}`,
                  {
                    method: "PATCH",
                    headers: {
                      "Content-Type": "application/json",
                      "Idempotency-Key": generateIdempotencyKey(),
                    },
                    body: JSON.stringify({
                      status: "completed",
                      actor_type: "user",
                      actor_id: userId,
                    }),
                  },
                );
                console.log("[Release] Direct completion result:", patchRes.ok);
              } catch (patchErr) {
                console.error("[Release] Direct completion failed:", patchErr);
              }
            }
            optimisticOrderUpdate(activeOrder.id, {
              status: "complete" as OrderStatus,
              step: 4 as OrderStep,
              dbStatus: "completed",
            });
            playSound("trade_complete");
            if (solanaWallet.connected) solanaWallet.refreshBalances();
            setIsLoading(false);
            return;
          }

          if (msg.includes("ConstraintRaw") || msg.includes("CannotRelease")) {
            showAlert(
              "Escrow Error",
              `Unable to release escrow: ${msg.slice(0, 200)}`,
              "error",
            );
            setIsLoading(false);
            return;
          }
          throw releaseErr;
        }

        if (!releaseResult.success) {
          console.error(
            "[Release] Escrow release failed:",
            releaseResult.error,
          );
          showAlert(
            "Escrow Failed",
            `Failed to release escrow: ${releaseResult.error || "Unknown error"}`,
            "error",
          );
          setIsLoading(false);
          return;
        }

        console.log("[Release] Escrow released:", releaseResult.txHash);

        const escrowRes = await fetchWithAuth(
          `/api/orders/${activeOrder.id}/escrow`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tx_hash: releaseResult.txHash,
              actor_type: "user",
              actor_id: userId,
            }),
          },
        );

        if (escrowRes.ok) {
          setOrders((prev) =>
            prev.map((o) =>
              o.id === activeOrder.id
                ? {
                    ...o,
                    status: "complete" as OrderStatus,
                    step: 4 as OrderStep,
                    dbStatus: "completed",
                  }
                : o,
            ),
          );
          playSound("trade_complete");
          if (solanaWallet.connected) {
            solanaWallet.refreshBalances();
          }
          setIsLoading(false);
          return;
        } else {
          setOrders((prev) =>
            prev.map((o) =>
              o.id === activeOrder.id
                ? {
                    ...o,
                    status: "complete" as OrderStatus,
                    step: 4 as OrderStep,
                    dbStatus: "completed",
                  }
                : o,
            ),
          );
          playSound("trade_complete");
          if (solanaWallet.connected) {
            solanaWallet.refreshBalances();
          }
          setIsLoading(false);
          return;
        }
      }

      const res = await fetchWithAuth(`/api/orders/${activeOrder.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": generateIdempotencyKey(),
        },
        body: JSON.stringify({
          status: "completed",
          actor_type: "user",
          actor_id: userId,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        const errorMsg = data.error || "Failed to confirm payment";
        if (errorMsg.includes("already") && errorMsg.includes("completed")) {
          setOrders((prev) =>
            prev.map((o) =>
              o.id === activeOrder.id
                ? {
                    ...o,
                    status: "complete" as OrderStatus,
                    step: 4 as OrderStep,
                    dbStatus: "completed",
                  }
                : o,
            ),
          );
          setIsLoading(false);
          return;
        }
        console.error("Failed to confirm payment:", errorMsg);
        showAlert("Error", errorMsg, "error");
        setIsLoading(false);
        return;
      }

      setOrders((prev) =>
        prev.map((o) =>
          o.id === activeOrder.id
            ? {
                ...o,
                status: "complete" as OrderStatus,
                step: 4 as OrderStep,
                dbStatus: "completed",
              }
            : o,
        ),
      );
      playSound("trade_complete");
      if (solanaWallet.connected) {
        solanaWallet.refreshBalances();
      }
    } catch (err) {
      console.error("Failed to confirm payment:", err);
      showAlert(
        "Error",
        "Failed to release escrow. Please try again.",
        "error",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const submitDispute = async () => {
    if (!activeOrder || !userId || !disputeReason) return;

    setIsSubmittingDispute(true);
    try {
      if (
        solanaWallet.connected &&
        activeOrder.escrowTradeId &&
        activeOrder.escrowCreatorWallet
      ) {
        console.log("[User] Opening on-chain dispute:", {
          tradeId: activeOrder.escrowTradeId,
          creatorWallet: activeOrder.escrowCreatorWallet,
        });

        try {
          const disputeResult = await solanaWallet.openDispute({
            creatorPubkey: activeOrder.escrowCreatorWallet,
            tradeId: activeOrder.escrowTradeId,
          });

          if (disputeResult.success) {
            console.log(
              "[User] On-chain dispute opened:",
              disputeResult.txHash,
            );
          } else {
            console.warn("[User] On-chain dispute failed, continuing with API");
          }
        } catch (chainError) {
          console.warn("[User] On-chain dispute failed:", chainError);
        }
      }

      const res = await fetchWithAuth(`/api/orders/${activeOrder.id}/dispute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: disputeReason,
          description: disputeDescription,
          initiated_by: "user",
          user_id: userId,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setOrders((prev) =>
            prev.map((o) =>
              o.id === activeOrder.id
                ? {
                    ...o,
                    status: "disputed" as OrderStatus,
                    dbStatus: "disputed",
                  }
                : o,
            ),
          );
          setShowDisputeModal(false);
          setDisputeReason("");
          setDisputeDescription("");
          toast.showDisputeOpened(activeOrder.id);
          showBrowserNotification(
            "Dispute Submitted",
            "Your dispute has been submitted. Our team will review it.",
          );
        }
      } else {
        toast.showWarning("Failed to submit dispute. Please try again.");
      }
    } catch (err) {
      console.error("Failed to submit dispute:", err);
      toast.showWarning("Failed to submit dispute");
    } finally {
      setIsSubmittingDispute(false);
    }
  };

  const fetchDisputeInfo = useCallback(async (orderId: string) => {
    const data = await fetchDisputeInfoFromApi(orderId);
    if (data) setDisputeInfo(data);
  }, []);

  const respondToResolution = async (action: "accept" | "reject") => {
    if (!activeOrder || !userId || !disputeInfo) return;

    setIsRespondingToResolution(true);
    try {
      const res = await fetchWithAuth(
        `/api/orders/${activeOrder.id}/dispute/confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            party: "user",
            action,
            partyId: userId,
          }),
        },
      );

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          fetchDisputeInfo(activeOrder.id);
          if (data.data?.finalized) {
            if (userId) {
              fetchOrders(userId);
            }
          }
          playSound("click");
        }
      }
    } catch (err) {
      console.error("Failed to respond to resolution:", err);
      playSound("error");
    } finally {
      setIsRespondingToResolution(false);
    }
  };

  // Fetch dispute info when viewing a disputed order
  useEffect(() => {
    if (
      activeOrder?.status === "disputed" ||
      activeOrder?.dbStatus === "disputed"
    ) {
      fetchDisputeInfo(activeOrder.id);
    } else {
      setDisputeInfo(null);
    }
  }, [
    activeOrder?.id,
    activeOrder?.status,
    activeOrder?.dbStatus,
    fetchDisputeInfo,
  ]);

  const requestExtension = async (durationMinutes?: number) => {
    if (!activeOrder || !userId) return;

    setRequestingExtension(true);
    try {
      const res = await fetchWithAuth(
        `/api/orders/${activeOrder.id}/extension`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            actor_type: "user",
            actor_id: userId,
            ...(durationMinutes ? { duration_minutes: durationMinutes } : {}),
          }),
        },
      );

      const data = await res.json();
      if (data.success) {
        setExtensionRequest({
          orderId: activeOrder.id,
          requestedBy: "user",
          extensionMinutes: data.data?.extension_minutes || 30,
          extensionCount: data.data?.extension_count || 0,
          maxExtensions: data.data?.max_extensions || 3,
        });
        playSound("click");
      } else {
        playSound("error");
        console.error("Extension request failed:", data.error);
      }
    } catch (err) {
      console.error("Failed to request extension:", err);
      playSound("error");
    } finally {
      setRequestingExtension(false);
    }
  };

  const respondToExtension = async (accept: boolean) => {
    if (!extensionRequest || !userId) return;

    setRequestingExtension(true);
    try {
      const res = await fetchWithAuth(
        `/api/orders/${extensionRequest.orderId}/extension`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            actor_type: "user",
            actor_id: userId,
            accept,
          }),
        },
      );

      const data = await res.json();
      if (data.success) {
        setExtensionRequest(null);
        if (accept) {
          playSound("click");
          if (userId) {
            fetchOrders(userId);
          }
        } else {
          playSound("error");
          if (userId) {
            fetchOrders(userId);
          }
        }
      } else {
        playSound("error");
      }
    } catch (err) {
      console.error("Failed to respond to extension:", err);
      playSound("error");
    } finally {
      setRequestingExtension(false);
    }
  };

  const requestCancelOrder = async (reason?: string) => {
    if (!activeOrder || !userId) return;
    setIsRequestingCancel(true);
    try {
      const res = await fetchWithAuth(
        `/api/orders/${activeOrder.id}/cancel-request`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            actor_type: "user",
            actor_id: userId,
            reason: reason || "User requested cancellation",
          }),
        },
      );
      const data = await res.json();
      if (data.success) {
        playSound("click");
        // Optimistic update: immediately show cancel request in UI
        setOrders((prev) =>
          prev.map((o) =>
            o.id === activeOrder.id
              ? {
                  ...o,
                  cancelRequest: {
                    requestedBy: "user",
                    requestedAt: new Date(),
                    reason: reason || "User requested cancellation",
                  },
                }
              : o,
          ),
        );
        fetchOrders(userId);
      } else {
        playSound("error");
        showAlert("Error", data.error || "Failed to request cancel", "error");
      }
    } catch (err) {
      console.error("Failed to request cancel:", err);
      playSound("error");
    } finally {
      setIsRequestingCancel(false);
    }
  };

  const respondToCancelRequest = async (accept: boolean) => {
    if (!activeOrder || !userId) return;
    setIsRequestingCancel(true);
    try {
      const res = await fetchWithAuth(
        `/api/orders/${activeOrder.id}/cancel-request`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            actor_type: "user",
            actor_id: userId,
            accept,
          }),
        },
      );
      const data = await res.json();
      if (data.success) {
        playSound(accept ? "click" : "notification");
        // Optimistic update: immediately clear cancel request or cancel order
        if (accept) {
          setOrders((prev) =>
            prev.map((o) =>
              o.id === activeOrder.id
                ? {
                    ...o,
                    status: "cancelled" as OrderStatus,
                    step: 1 as OrderStep,
                    dbStatus: "cancelled",
                    cancelRequest: null,
                  }
                : o,
            ),
          );
        } else {
          setOrders((prev) =>
            prev.map((o) =>
              o.id === activeOrder.id
                ? {
                    ...o,
                    cancelRequest: null,
                  }
                : o,
            ),
          );
        }
        fetchOrders(userId);
      } else {
        playSound("error");
        showAlert(
          "Error",
          data.error || "Failed to respond to cancel",
          "error",
        );
      }
    } catch (err) {
      console.error("Failed to respond to cancel request:", err);
      playSound("error");
    } finally {
      setIsRequestingCancel(false);
    }
  };

  // In-flight guard: a Set of orderIds currently being rated.
  // Prevents duplicate POST when the user double-clicks OR when React 19
  // StrictMode/transitions cause the handler to fire twice — without this,
  // the first submit succeeds and the second returns 400 "already rated".
  const submittingRatingsRef = useState<Set<string>>(() => new Set())[0];

  const submitRating = useCallback(
    async (orderId: string, ratingValue: number, reviewText?: string) => {
      if (!userId) return;
      if (submittingRatingsRef.has(orderId)) {
        // Already submitting — silently ignore the duplicate
        return;
      }
      submittingRatingsRef.add(orderId);
      try {
        const res = await fetchWithAuth("/api/ratings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            order_id: orderId,
            rater_type: "user",
            rater_id: userId,
            rating: ratingValue,
            review_text: reviewText || undefined,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          // Treat "already rated" as success — the user did submit, the
          // first POST just got there first.
          if (typeof data.error === 'string' && /already rated/i.test(data.error)) {
            setOrders((prev) =>
              prev.map((o) =>
                o.id === orderId ? { ...o, userRating: ratingValue } : o,
              ),
            );
            return;
          }
          toast.showWarning(data.error || "Failed to submit review");
          return;
        }
        // Update local order state with the rating
        setOrders((prev) =>
          prev.map((o) =>
            o.id === orderId ? { ...o, userRating: ratingValue } : o,
          ),
        );
        playSound("click");
        toast.show({
          type: "complete",
          title: "Review Submitted",
          message: `You rated this trade ${ratingValue} star${ratingValue !== 1 ? "s" : ""}`,
          duration: 4000,
        });
      } catch (err) {
        console.error("Failed to submit rating:", err);
        toast.showWarning("Failed to submit review. Please try again.");
      } finally {
        // Release the in-flight guard so the user can re-rate if they
        // change their mind (or retry after a real network error).
        submittingRatingsRef.delete(orderId);
      }
    },
    [userId, setOrders, playSound, toast, submittingRatingsRef],
  );

  return {
    // Dispute
    showDisputeModal,
    setShowDisputeModal,
    disputeReason,
    setDisputeReason,
    disputeDescription,
    setDisputeDescription,
    isSubmittingDispute,
    disputeInfo,
    isRespondingToResolution,
    submitDispute,
    respondToResolution,
    // Extension
    extensionRequest,
    setExtensionRequest,
    requestingExtension,
    requestExtension,
    respondToExtension,
    // Cancel
    isRequestingCancel,
    requestCancelOrder,
    respondToCancelRequest,
    // Order actions
    markPaymentSent,
    confirmFiatReceived,
    fetchDisputeInfo,
    submitRating,
  };
}
