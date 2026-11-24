import type { ClientMsg, ServerMsg } from "../shared/protocol";

export class Connection {
  private ws: WebSocket;
  private queue: string[] = [];

  constructor(onMessage: (msg: ServerMsg) => void, onClose: () => void) {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws.onopen = () => this.queue.splice(0).forEach((m) => this.ws.send(m));
    this.ws.onmessage = (e) => onMessage(JSON.parse(e.data as string) as ServerMsg);
    this.ws.onclose = onClose;
  }

  send(msg: ClientMsg): void {
    const data = JSON.stringify(msg);
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(data);
    else if (this.ws.readyState === WebSocket.CONNECTING) this.queue.push(data);
  }
}
