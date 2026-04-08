/**
 * Minimal ambient types for the `ws` package — scoped to the shadow
 * realtime server so we don't need to add @types/ws to package.json.
 *
 * Deleting src/realtime/ removes this file too.
 */
declare module 'ws' {
  import { EventEmitter } from 'events';
  import type { IncomingMessage, Server as HttpServer } from 'http';
  import type { Duplex } from 'stream';

  export type RawData = Buffer | ArrayBuffer | Buffer[] | string;

  export class WebSocket extends EventEmitter {
    static readonly CONNECTING: 0;
    static readonly OPEN: 1;
    static readonly CLOSING: 2;
    static readonly CLOSED: 3;
    readonly CONNECTING: 0;
    readonly OPEN: 1;
    readonly CLOSING: 2;
    readonly CLOSED: 3;

    readyState: 0 | 1 | 2 | 3;

    constructor(address: string, options?: unknown);

    send(data: string | Buffer | ArrayBuffer, cb?: (err?: Error) => void): void;
    close(code?: number, reason?: string): void;
    terminate(): void;
    ping(data?: unknown): void;
    pong(data?: unknown): void;

    on(event: 'open', listener: () => void): this;
    on(event: 'close', listener: (code: number, reason: Buffer) => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: 'message', listener: (data: RawData, isBinary: boolean) => void): this;
    on(event: 'pong', listener: () => void): this;
    on(event: 'ping', listener: () => void): this;
    on(event: string, listener: (...args: any[]) => void): this;

    once(event: 'open', listener: () => void): this;
    once(event: 'error', listener: (err: Error) => void): this;
    once(event: 'message', listener: (data: RawData) => void): this;
    once(event: string, listener: (...args: any[]) => void): this;

    off(event: string, listener: (...args: any[]) => void): this;
  }

  export default WebSocket;

  export class WebSocketServer extends EventEmitter {
    clients: Set<WebSocket>;
    constructor(options?: {
      port?: number;
      server?: HttpServer;
      noServer?: boolean;
      path?: string;
    });
    handleUpgrade(
      request: IncomingMessage,
      socket: Duplex,
      upgradeHead: Buffer,
      callback: (ws: WebSocket, request: IncomingMessage) => void
    ): void;
    close(cb?: (err?: Error) => void): void;
    on(event: 'connection', listener: (ws: WebSocket, req: IncomingMessage, ...args: any[]) => void): this;
    on(event: 'close', listener: () => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: string, listener: (...args: any[]) => void): this;
    emit(event: string, ...args: any[]): boolean;
  }
}
