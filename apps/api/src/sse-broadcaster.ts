/**
 * Server-Sent Events (SSE) Broadcaster
 * Manages active customer and staff browser connections for real-time live updates
 * (e.g. order status changes, new orders on Kanban board).
 */

import http from 'node:http';

export interface SSEClient {
  id: string;
  res: http.ServerResponse;
}

export class SSEBroadcaster {
  private clients: Map<string, SSEClient> = new Map();

  public addClient(id: string, res: http.ServerResponse) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(`data: ${JSON.stringify({ type: 'connected', clientId: id })}\n\n`);

    this.clients.set(id, { id, res });

    res.on('close', () => {
      this.clients.delete(id);
    });
  }

  public broadcast(event: { type: string; payload: any }) {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const [id, client] of this.clients.entries()) {
      try {
        client.res.write(data);
      } catch (err) {
        this.clients.delete(id);
      }
    }
  }

  public getClientCount(): number {
    return this.clients.size;
  }
}

export const sseBroadcaster = new SSEBroadcaster();
