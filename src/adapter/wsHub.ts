import type { EventEnvelope, ServerEnvelope } from "./contract.js";

type WsClient = {
  OPEN: number;
  readyState: number;
  send(payload: string): void;
  on(event: "close", listener: () => void): void;
};

export class WsHub {
  private readonly clients = new Set<WsClient>();

  add(client: WsClient): void {
    this.clients.add(client);
    client.on("close", () => this.clients.delete(client));
  }

  send(client: WsClient, envelope: ServerEnvelope): void {
    if (client.readyState === client.OPEN) {
      client.send(JSON.stringify(envelope));
    }
  }

  broadcast(event: EventEnvelope): void {
    const payload = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.readyState === client.OPEN) {
        client.send(payload);
      }
    }
  }
}
