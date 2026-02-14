/**
 * HTTP Client for Flow Tests
 *
 * Provides a simple wrapper around fetch for making API calls
 * with consistent error handling and JSON parsing.
 *
 * Supports self-signed HTTPS via NODE_TLS_REJECT_UNAUTHORIZED=0
 * (set by test-harness.sh or automatically below).
 */

// Allow self-signed HTTPS in test/development
if (!process.env.NODE_TLS_REJECT_UNAUTHORIZED) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

export class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = 'https://localhost:3000') {
    this.baseUrl = baseUrl;
  }

  async get<T = unknown>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(
        `GET ${path} failed with status ${res.status}: ${errorText}`
      );
    }

    return res.json();
  }

  async post<T = unknown>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(
        `POST ${path} failed with status ${res.status}: ${errorText}`
      );
    }

    return res.json();
  }

  async patch<T = unknown>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(
        `PATCH ${path} failed with status ${res.status}: ${errorText}`
      );
    }

    return res.json();
  }

  async delete<T = unknown>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(
        `DELETE ${path} failed with status ${res.status}: ${errorText}`
      );
    }

    return res.json();
  }
}
