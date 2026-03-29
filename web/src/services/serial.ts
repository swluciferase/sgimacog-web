// Ring buffer with bounded capacity — prevents memory blowup on tab background
class RingBuffer<T> {
  private buffer: T[] = [];
  private readonly maxCapacity: number;

  constructor(maxCapacity: number = 10_000) {
    this.maxCapacity = maxCapacity;
  }

  push(item: T): void {
    if (this.buffer.length >= this.maxCapacity) {
      this.buffer.shift(); // drop oldest — bounded
    }
    this.buffer.push(item);
  }

  drain(): T[] {
    const items = this.buffer;
    this.buffer = [];
    return items;
  }

  clear(): void {
    this.buffer = [];
  }

  get length(): number {
    return this.buffer.length;
  }
}

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

export interface SerialOptions {
  baudRate: number;
  bufferSize?: number; // defaults to 65536 — NEVER use default 255
}

export class SerialService {
  private port: SerialPort | null = null;
  private readLoopRunning = false;
  private stopped = false;
  // Active reader — tracked so disconnect() can cancel it before port.close()
  private currentReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  // Ring buffer for incoming serial chunks
  private readonly rxBuffer = new RingBuffer<Uint8Array>(10_000);

  // Callbacks
  public onStatusChange: (status: ConnectionStatus) => void = () => {};
  public onError: (error: Error) => void = () => {};

  async connect(options: SerialOptions): Promise<void> {
    // If already connected, do nothing
    if (this.port !== null && !this.stopped) {
      return;
    }

    this.stopped = false;
    this.onStatusChange('connecting');
    try {
      this.port = await navigator.serial.requestPort();
      // CRITICAL: bufferSize default is 255 (5ms at 1Mbaud) — MUST set to 65536
      await this.port.open({
        baudRate: options.baudRate,
        bufferSize: options.bufferSize ?? 65536,
      });
      this.onStatusChange('connected');
      this.startReadLoop(); // fire-and-forget async loop
    } catch (e) {
      this.onStatusChange('error');
      this.onError(e instanceof Error ? e : new Error(String(e)));
      throw e;
    }
  }

  async disconnect(): Promise<void> {
    this.stopped = true;
    // Cancel the active reader FIRST — port.close() throws if reader lock is held.
    // cancel() unblocks reader.read() → for(;;) breaks → finally: releaseLock() runs.
    if (this.currentReader) {
      try { await this.currentReader.cancel(); } catch { /* ignore */ }
    }
    // One microtask break: lets the read-loop's finally{releaseLock()} complete
    // before we call close(), which requires the readable lock to be free.
    await Promise.resolve();
    try {
      await this.port?.close();
    } catch {
      // ignore remaining close errors
    }
    this.port = null;
    this.currentReader = null;
    this.rxBuffer.clear();
    this.onStatusChange('disconnected');
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.port?.writable) throw new Error('Port not writable');
    const writer = this.port.writable.getWriter();
    try {
      await writer.write(data);
    } finally {
      writer.releaseLock();
    }
  }

  // Drain accumulated chunks from the ring buffer (call from rAF loop)
  drainBuffer(): Uint8Array[] {
    return this.rxBuffer.drain();
  }

  get isConnected(): boolean {
    return this.port !== null && !this.stopped;
  }

  // CRITICAL: Separate async read loop — NEVER call inside requestAnimationFrame
  // This outer while loop handles BufferOverrunError (stream dies and auto-replaces)
  private async startReadLoop(): Promise<void> {
    if (this.readLoopRunning) return;
    this.readLoopRunning = true;

    while (this.port?.readable && !this.stopped) {
      const reader = this.port.readable.getReader();
      this.currentReader = reader; // track so disconnect() can cancel us
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) this.rxBuffer.push(value);
        }
      } catch (e) {
        // NetworkError = device physically lost — fatal, cannot recover by retrying
        if (e instanceof Error && e.name === 'NetworkError') {
          console.warn('[SerialService] Device lost (will disconnect):', e.message);
          this.port = null; // clear so isConnected returns false & reconnect is allowed
          this.rxBuffer.clear();
          break; // exit for(;;) — finally releases lock, while exits (port is null)
        }
        // BufferOverrunError: transient — stream auto-replaces, outer while retries
        if (!this.stopped) {
          console.warn('[SerialService] Read error (recovering):', e);
        }
      } finally {
        this.currentReader = null;
        reader.releaseLock();
      }
    }

    this.readLoopRunning = false;
    if (!this.stopped) {
      this.onStatusChange('disconnected');
    }
  }
}

export const serialService = new SerialService();
