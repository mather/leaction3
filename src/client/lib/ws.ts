import { type ClientMessage, type ServerMessage, WS_PING, WS_PONG } from "../../shared/protocol";

// EventRoom への WebSocket 接続。切れたら待ち時間を延ばしながら自動で再接続する。
// 取りこぼしの補完（?since=）は接続 URL を作る側（room.ts）が受け持つ。

export type SocketStatus = "connecting" | "open" | "reconnecting";

type Options = {
  /** 接続のたびに呼び、その時点の URL を使う（最後に受け取った seq を載せるため） */
  url: () => string;
  onMessage: (message: ServerMessage) => void;
  onOpen: () => void;
  onStatus: (status: SocketStatus) => void;
  /** 再接続の前に呼ぶ。参加者 Cookie が切れていたら取り直すのに使う */
  beforeReconnect?: () => Promise<void>;
};

/** 再接続の待ち時間（最初の失敗から倍々に延ばし、上限で止める） */
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 15000;
/** 死活確認。この間隔で ping を送り、TIMEOUT の間なにも届かなければ切れたとみなす */
const PING_INTERVAL_MS = 20000;
const PING_TIMEOUT_MS = 45000;

export class RoomSocket {
  private ws: WebSocket | undefined;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private lastReceived = 0;
  private started = false;
  private stopped = false;

  constructor(private readonly options: Options) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    window.addEventListener("online", this.wake);
    document.addEventListener("visibilitychange", this.wake);
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    window.removeEventListener("online", this.wake);
    document.removeEventListener("visibilitychange", this.wake);
    clearTimeout(this.retryTimer);
    this.drop();
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** 送れたら true。接続していなければ送らずに false */
  send(message: ClientMessage): boolean {
    if (!this.ws || !this.isOpen) return false;
    this.ws.send(JSON.stringify(message));
    return true;
  }

  /** いまの接続を捨ててすぐにつなぎ直す（seq の飛びに気づいたときなど） */
  reconnect(): void {
    if (this.stopped) return;
    this.drop();
    clearTimeout(this.retryTimer);
    this.attempt = 0;
    this.options.onStatus("reconnecting");
    this.connect();
  }

  private connect(): void {
    this.retryTimer = undefined;
    const ws = new WebSocket(this.options.url());
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.lastReceived = Date.now();
      this.pingTimer = setInterval(this.heartbeat, PING_INTERVAL_MS);
      this.options.onStatus("open");
      this.options.onOpen();
    };
    ws.onmessage = (e: MessageEvent) => {
      this.lastReceived = Date.now();
      if (typeof e.data !== "string" || e.data === WS_PONG) return;
      let message: ServerMessage;
      try {
        message = JSON.parse(e.data) as ServerMessage;
      } catch {
        return;
      }
      this.options.onMessage(message);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.drop();
      this.scheduleRetry();
    };
  }

  /** いまの接続を、イベントを外してから閉じる */
  private drop(): void {
    clearInterval(this.pingTimer);
    const ws = this.ws;
    this.ws = undefined;
    if (!ws) return;
    ws.onopen = ws.onmessage = ws.onclose = null;
    if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) ws.close();
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retryTimer !== undefined) return;
    this.options.onStatus("reconnecting");
    // 一斉に切れたとき再接続が同時に集中しないよう、待ち時間をばらつかせる
    const delay =
      Math.min(RETRY_BASE_MS * 2 ** this.attempt, RETRY_MAX_MS) * (0.5 + Math.random() / 2);
    this.attempt++;
    this.retryTimer = setTimeout(async () => {
      await this.options.beforeReconnect?.().catch(() => undefined);
      // 待っている間に wake() でつなぎ直していれば何もしない
      if (!this.stopped && !this.ws) this.connect();
    }, delay);
  }

  /** 回線が戻った・画面に戻ってきたときは、待たずに再接続する */
  private readonly wake = () => {
    if (document.visibilityState !== "visible" || this.ws || this.stopped) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.attempt = 0;
    this.connect();
  };

  private readonly heartbeat = () => {
    if (!this.ws) return;
    // スマホの回線切り替えなどで、close が届かないまま死んだ接続を見つける
    if (Date.now() - this.lastReceived > PING_TIMEOUT_MS) {
      this.drop();
      this.scheduleRetry();
      return;
    }
    this.ws.send(WS_PING);
  };
}
