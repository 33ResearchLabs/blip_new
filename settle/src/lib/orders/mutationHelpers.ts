/**
 * Mutation Helpers - Utilities for Safe Optimistic Updates
 *
 * Provides error handling, rollback, and refetch logic for order mutations
 */

export interface MutationResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface MutationOptions {
  orderId: string;
  endpoint: string;
  method: 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  payload: any;
  onSuccess?: (data: any) => void | Promise<void>;
  onError?: (error: string) => void | Promise<void>;
  toastSuccess?: string;
  toastError?: string;
}

/**
 * Execute a safe mutation with automatic error handling and rollback
 */
export async function executeSafeMutation<T = any>(
  options: MutationOptions,
  refetchFn: () => Promise<void>,
  playSound?: (sound: string) => void,
  showToast?: (type: string, message: string) => void
): Promise<MutationResult<T>> {
  const {
    orderId,
    endpoint,
    method,
    payload,
    onSuccess,
    onError,
    toastSuccess,
    toastError,
  } = options;

  try {
    console.log(`[Mutation] ${method} ${endpoint}`, payload);

    const res = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`[Mutation] HTTP error ${res.status}:`, errorText);

      const errorMsg = toastError || `Failed to update order (${res.status})`;
      showToast?.('error', errorMsg);
      onError?.(errorMsg);

      return {
        success: false,
        error: errorMsg,
      };
    }

    const data = await res.json();

    if (!data.success) {
      const errorMsg = data.error || 'Operation failed';
      console.error('[Mutation] API error:', errorMsg);

      showToast?.('error', toastError || errorMsg);
      onError?.(errorMsg);

      return {
        success: false,
        error: errorMsg,
      };
    }

    // Success - refetch to get authoritative server state
    console.log('[Mutation] Success, refetching order data');
    await refetchFn();

    if (toastSuccess) {
      showToast?.('success', toastSuccess);
    }

    playSound?.('click');
    await onSuccess?.(data);

    return {
      success: true,
      data: data.data,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Network error';
    console.error('[Mutation] Exception:', error);

    showToast?.('error', toastError || `Failed: ${errorMsg}`);
    onError?.(errorMsg);

    return {
      success: false,
      error: errorMsg,
    };
  }
}

/**
 * Create an optimistic update wrapper with automatic rollback
 */
export function createOptimisticUpdate<TState>(
  setState: (updater: (prev: TState) => TState) => void,
  updateFn: (prev: TState) => TState
) {
  // Save original state
  let originalState: TState | null = null;

  return {
    apply: () => {
      setState((prev) => {
        originalState = prev;
        return updateFn(prev);
      });
    },
    rollback: () => {
      if (originalState !== null) {
        setState(() => originalState!);
      }
    },
  };
}

/**
 * Refetch single order by ID
 */
export async function refetchSingleOrder(
  orderId: string,
  onUpdate: (order: any) => void
): Promise<void> {
  try {
    const res = await fetch(`/api/orders/${orderId}`);
    if (!res.ok) {
      console.error(`[Refetch] Failed to fetch order ${orderId}: ${res.status}`);
      return;
    }

    const data = await res.json();
    if (data.success && data.data) {
      console.log(`[Refetch] Order ${orderId} updated from server`);
      onUpdate(data.data);
    }
  } catch (error) {
    console.error(`[Refetch] Error fetching order ${orderId}:`, error);
  }
}

/**
 * Execute mutation with optimistic update and automatic rollback on error
 */
export async function executeMutationWithOptimisticUpdate<TState, TResult = any>(
  options: MutationOptions & {
    optimisticUpdate: (prev: TState) => TState;
  },
  setState: (updater: (prev: TState) => TState) => void,
  refetchFn: () => Promise<void>,
  playSound?: (sound: string) => void,
  showToast?: (type: string, message: string) => void
): Promise<MutationResult<TResult>> {
  // Apply optimistic update
  const optimistic = createOptimisticUpdate(setState, options.optimisticUpdate);
  optimistic.apply();

  // Execute mutation
  const result = await executeSafeMutation(
    options,
    refetchFn,
    playSound,
    showToast
  );

  // Rollback on error
  if (!result.success) {
    console.log('[Mutation] Rolling back optimistic update');
    optimistic.rollback();
  }

  return result;
}
