import crypto from 'node:crypto';
import type net from 'node:net';
import type http from 'node:http';
import { EventEmitter } from 'node:events';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export class WebSocketConnection extends EventEmitter {
  public readonly socket: net.Socket;
  public readonly isServer: boolean;
  private isClosed = false;
  private fragmentBuffer: Buffer = Buffer.alloc(0);

  constructor(
    socket: net.Socket,
    req?: http.IncomingMessage,
    head?: Buffer,
    isServer = true,
  ) {
    super();
    this.socket = socket;
    this.isServer = isServer;

    // 1. Perform RFC 6455 Server Handshake
    if (isServer && req) {
      const key = req.headers['sec-websocket-key'];
      if (!key) {
        socket.destroy();
        return;
      }

      const accept = crypto
        .createHash('sha1')
        .update(key + WS_GUID)
        .digest('base64');

      const headers = [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '\r\n',
      ];

      socket.write(headers.join('\r\n'));
    }

    // Handle initial head buffer if any
    if (head && head.length > 0) {
      this.handleSocketData(head);
    }

    // 2. Listen for incoming frames
    socket.on('data', (chunk) => this.handleSocketData(chunk));
    socket.on('close', () => {
      this.isClosed = true;
      this.emit('close');
    });
    socket.on('error', (err) => {
      this.emit('error', err);
    });
  }

  public sendText(message: string): void {
    if (this.isClosed) return;
    const payload = Buffer.from(message, 'utf8');
    this.sendFrame(0x01, payload);
  }

  public sendBinary(data: Buffer): void {
    if (this.isClosed) return;
    this.sendFrame(0x02, data);
  }

  public close(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    try {
      this.sendFrame(0x08, Buffer.alloc(0)); // Close frame
    } catch {}
    this.socket.destroy();
  }

  private sendFrame(opcode: number, payload: Buffer): void {
    const isMasked = !this.isServer;
    const len = payload.length;
    let headerLen = 2 + (isMasked ? 4 : 0);
    if (len >= 126 && len <= 65535) {
      headerLen += 2;
    } else if (len > 65535) {
      headerLen += 8;
    }

    const header = Buffer.alloc(headerLen);
    header[0] = 0x80 | opcode; // FIN bit set + opcode

    let offset = 2;
    const maskBit = isMasked ? 0x80 : 0x00;

    if (len < 126) {
      header[1] = maskBit | len;
    } else if (len <= 65535) {
      header[1] = maskBit | 126;
      header.writeUInt16BE(len, offset);
      offset += 2;
    } else {
      header[1] = maskBit | 127;
      header.writeBigUInt64BE(BigInt(len), offset);
      offset += 8;
    }

    let finalPayload = payload;
    if (isMasked) {
      const maskKey = crypto.randomBytes(4);
      maskKey.copy(header, offset);
      finalPayload = Buffer.from(payload);
      for (let i = 0; i < finalPayload.length; i++) {
        finalPayload[i] = finalPayload[i]! ^ maskKey[i % 4]!;
      }
    }

    try {
      this.socket.write(Buffer.concat([header, finalPayload]));
    } catch {}
  }

  private handleSocketData(chunk: Buffer): void {
    this.fragmentBuffer = Buffer.concat([this.fragmentBuffer, chunk]);

    while (this.fragmentBuffer.length >= 2) {
      let offset = 0;
      const firstByte = this.fragmentBuffer[0]!;
      const secondByte = this.fragmentBuffer[1]!;
      const opcode = firstByte & 0x0f;
      const isMasked = (secondByte & 0x80) !== 0;
      let payloadLen = secondByte & 0x7f;
      offset = 2;

      let minHeaderLen = 2 + (isMasked ? 4 : 0);
      if (payloadLen === 126) minHeaderLen += 2;
      else if (payloadLen === 127) minHeaderLen += 8;

      if (this.fragmentBuffer.length < minHeaderLen) {
        break; // Wait for full header
      }

      if (payloadLen === 126) {
        payloadLen = this.fragmentBuffer.readUInt16BE(offset);
        offset += 2;
      } else if (payloadLen === 127) {
        payloadLen = Number(this.fragmentBuffer.readBigUInt64BE(offset));
        offset += 8;
      }

      let maskKey: Buffer | undefined;
      if (isMasked) {
        maskKey = this.fragmentBuffer.subarray(offset, offset + 4);
        offset += 4;
      }

      if (this.fragmentBuffer.length < offset + payloadLen) {
        break; // Incomplete payload, wait for more data!
      }

      const payload = Buffer.from(this.fragmentBuffer.subarray(offset, offset + payloadLen));
      this.fragmentBuffer = this.fragmentBuffer.subarray(offset + payloadLen);

      // Unmask client payload if masked
      if (isMasked && maskKey) {
        for (let i = 0; i < payload.length; i++) {
          payload[i] = payload[i]! ^ maskKey[i % 4]!;
        }
      }

      // Handle Opcode
      if (opcode === 0x01) {
        // Text Frame
        const text = payload.toString('utf8');
        this.emit('message', text, false);
      } else if (opcode === 0x02) {
        // Binary Frame (Raw 16kHz PCM audio chunk)
        this.emit('message', payload, true);
      } else if (opcode === 0x08) {
        // Close Frame
        this.close();
      } else if (opcode === 0x09) {
        // Ping -> Pong
        this.sendFrame(0x0a, payload);
      }
    }
  }
}
