"use client";

import { useState, useCallback } from "react";
import type { Order, DbOrder, BankAccount } from "@/components/user/screens/types";
import { mapDbOrderToUI } from "@/components/user/screens/helpers";
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';

export function useUserDataFetching() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [resolvedDisputes, setResolvedDisputes] = useState<{
    id: string;
    orderId: string;
    orderNumber: string;
    cryptoAmount: number;
    fiatAmount: number;
    otherPartyName: string;
    reason: string;
    resolution: string;
    resolvedInFavorOf: string;
    resolvedAt: string;
  }[]>([]);

  const fetchOrders = useCallback(async (uid: string, opts?: { status?: string; days?: number }) => {
    try {
      const params = new URLSearchParams({ user_id: uid });
      if (opts?.status) params.set('status', opts.status);
      if (opts?.days) params.set('days', opts.days.toString());
      const res = await fetchWithAuth(`/api/orders?${params}`);
      if (!res.ok) {
        console.log('Orders API not available - running in demo mode');
        return;
      }
      const data = await res.json();
      if (data.success && data.data) {
        const mappedOrders = data.data.map((o: DbOrder) => mapDbOrderToUI(o)).filter((o: Order | null): o is Order => o !== null);
        setOrders(mappedOrders);
      }
    } catch (err) {
      console.error('Failed to fetch orders:', err);
    }
  }, []);

  const fetchBankAccounts = useCallback(async (uid: string) => {
    try {
      const res = await fetchWithAuth(`/api/users/${uid}/bank-accounts`);
      if (!res.ok) {
        console.log('Bank accounts API not available - running in demo mode');
        return;
      }
      const data = await res.json();
      if (data.success && data.data) {
        setBankAccounts(data.data.map((acc: { id: string; bank_name: string; iban: string; account_name: string; is_default: boolean }) => ({
          id: acc.id,
          bank: acc.bank_name,
          iban: acc.iban,
          name: acc.account_name,
          isDefault: acc.is_default,
        })));
      }
    } catch (err) {
      console.error('Failed to fetch bank accounts:', err);
    }
  }, []);

  const fetchResolvedDisputes = useCallback(async (uid: string) => {
    try {
      const res = await fetchWithAuth(`/api/disputes/resolved?actor_type=user&actor_id=${uid}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && data.data) {
        setResolvedDisputes(data.data);
      }
    } catch (err) {
      console.error('Failed to fetch resolved disputes:', err);
    }
  }, []);

  const addBankAccount = async (newBank: { bank: string; iban: string; name: string }, userId: string | null) => {
    if (!newBank.bank || !newBank.iban || !newBank.name || !userId) return;

    try {
      const res = await fetchWithAuth(`/api/users/${userId}/bank-accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bank_name: newBank.bank,
          account_name: newBank.name,
          iban: newBank.iban,
          is_default: bankAccounts.length === 0,
        }),
      });
      if (!res.ok) {
        console.log('Bank accounts API not available - running in demo mode');
        setBankAccounts(prev => [...prev, {
          id: `demo_${Date.now()}`,
          bank: newBank.bank,
          iban: newBank.iban,
          name: newBank.name,
          isDefault: bankAccounts.length === 0,
        }]);
        return true;
      }
      const data = await res.json();

      if (data.success && data.data) {
        setBankAccounts(prev => [...prev, {
          id: data.data.id,
          bank: data.data.bank_name,
          iban: data.data.iban,
          name: data.data.account_name,
          isDefault: data.data.is_default,
        }]);
        return true;
      }
    } catch (err) {
      console.error('Failed to add bank account:', err);
    }
    return false;
  };

  return {
    orders, setOrders,
    bankAccounts, setBankAccounts,
    resolvedDisputes, setResolvedDisputes,
    fetchOrders,
    fetchBankAccounts,
    fetchResolvedDisputes,
    addBankAccount,
  };
}
