// API Client for frontend

const API_BASE = '/api';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new ApiError(response.status, data.error || 'Request failed');
  }

  return data.data;
}

// Auth
export const auth = {
  connectWallet: (walletAddress: string, type: 'user' | 'merchant' = 'user') =>
    request('/auth/wallet', {
      method: 'POST',
      body: JSON.stringify({ wallet_address: walletAddress, type }),
    }),
};

// Users
export const users = {
  get: (id: string) => request(`/users/${id}`),

  update: (id: string, data: { name?: string; email?: string; phone?: string }) =>
    request(`/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  getBankAccounts: (userId: string) =>
    request(`/users/${userId}/bank-accounts`),

  addBankAccount: (
    userId: string,
    data: { bank_name: string; account_name: string; iban: string; is_default?: boolean }
  ) =>
    request(`/users/${userId}/bank-accounts`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

// Offers
export const offers = {
  list: (filters?: {
    type?: 'buy' | 'sell';
    payment_method?: 'bank' | 'cash';
    amount?: number;
  }) => {
    const params = new URLSearchParams();
    if (filters?.type) params.set('type', filters.type);
    if (filters?.payment_method) params.set('payment_method', filters.payment_method);
    if (filters?.amount) params.set('amount', filters.amount.toString());
    return request(`/offers?${params}`);
  },

  findBest: (
    amount: number,
    type: 'buy' | 'sell',
    paymentMethod: 'bank' | 'cash',
    preference: 'fast' | 'cheap' | 'best' = 'best'
  ) => {
    const params = new URLSearchParams({
      amount: amount.toString(),
      type,
      payment_method: paymentMethod,
      preference,
    });
    return request(`/offers?${params}`);
  },
};

// Orders
export const orders = {
  list: (userId: string) =>
    request(`/orders?user_id=${userId}`),

  get: (id: string) =>
    request(`/orders/${id}`),

  create: (data: {
    user_id: string;
    crypto_amount: number;
    type: 'buy' | 'sell';
    payment_method: 'bank' | 'cash';
    preference?: 'fast' | 'cheap' | 'best';
    offer_id?: string;
  }) =>
    request('/orders', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateStatus: (
    id: string,
    status: string,
    actorType: 'user' | 'merchant' | 'system',
    actorId: string,
    metadata?: Record<string, unknown>
  ) =>
    request(`/orders/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, actor_type: actorType, actor_id: actorId, metadata }),
    }),

  cancel: (
    id: string,
    actorType: 'user' | 'merchant',
    actorId: string,
    reason?: string
  ) => {
    const params = new URLSearchParams({
      actor_type: actorType,
      actor_id: actorId,
    });
    if (reason) params.set('reason', reason);
    return request(`/orders/${id}?${params}`, { method: 'DELETE' });
  },

  // Messages
  getMessages: (orderId: string) =>
    request(`/orders/${orderId}/messages`),

  sendMessage: (
    orderId: string,
    data: {
      sender_type: 'user' | 'merchant';
      sender_id: string;
      content: string;
      message_type?: 'text' | 'image';
      image_url?: string;
    }
  ) =>
    request(`/orders/${orderId}/messages`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  markMessagesRead: (orderId: string, readerType: 'user' | 'merchant') =>
    request(`/orders/${orderId}/messages`, {
      method: 'PATCH',
      body: JSON.stringify({ reader_type: readerType }),
    }),

  // Review
  submitReview: (
    orderId: string,
    data: {
      reviewer_type: 'user' | 'merchant';
      reviewer_id: string;
      reviewee_type: 'user' | 'merchant';
      reviewee_id: string;
      rating: number;
      comment?: string;
    }
  ) =>
    request(`/orders/${orderId}/review`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

// Merchant API
export const merchant = {
  getOrders: (merchantId: string, status?: string[]) => {
    const params = new URLSearchParams({ merchant_id: merchantId });
    if (status) params.set('status', status.join(','));
    return request(`/merchant/orders?${params}`);
  },

  getOffers: (merchantId: string) =>
    request(`/merchant/offers?merchant_id=${merchantId}`),

  createOffer: (data: {
    merchant_id: string;
    type: 'buy' | 'sell';
    payment_method: 'bank' | 'cash';
    rate: number;
    min_amount: number;
    max_amount: number;
    available_amount: number;
    bank_name?: string;
    bank_account_name?: string;
    bank_iban?: string;
    location_name?: string;
    location_address?: string;
    location_lat?: number;
    location_lng?: number;
    meeting_instructions?: string;
  }) =>
    request('/merchant/offers', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

export default {
  auth,
  users,
  offers,
  orders,
  merchant,
};
