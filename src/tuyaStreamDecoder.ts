import { Logger } from 'homebridge';
import * as net from 'net';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';

/**
 * Tuya Stream Decoder
 * Basiert auf der Analyse des Tuya Protokolls
 */
export class TuyaStreamDecoder extends EventEmitter {
  private socket?: net.Socket;
  private sessionKey?: Buffer;
  private frameBuffer = Buffer.alloc(0);
  
  // Tuya stream commands
  private readonly CMD_STREAM_START = 0xD0;
  private readonly CMD_STREAM_DATA = 0xD1;
  private readonly CMD_STREAM_STOP = 0xD2;

  constructor(
    private readonly deviceId: string,
    private readonly localKey: string,
    private readonly ip: string,
    private readonly log: Logger,
  ) {
    super();
  }

  /**
   * Start video stream using Tuya LAN protocol
   */
  async startStream(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.log.info('Starting Tuya video stream decoder...');
      
      this.socket = new net.Socket();
      this.socket.setTimeout(10000);
      
      this.socket.on('connect', async () => {
        this.log.debug('Connected to camera');
        
        // Send stream request
        await this.sendStreamRequest();
        resolve();
      });
      
      this.socket.on('data', (data) => {
        this.handleStreamData(data);
      });
      
      this.socket.on('error', (err) => {
        this.log.error('Stream error:', err.message);
        reject(err);
      });
      
      this.socket.on('close', () => {
        this.log.debug('Stream connection closed');
      });
      
      // Connect to camera on stream port
      this.socket.connect(6669, this.ip); // Stream port is usually 6669
    });
  }

  /**
   * Send stream request to camera
   */
  private async sendStreamRequest(): Promise<void> {
    // Build stream request
    const payload = {
      gwId: this.deviceId,
      devId: this.deviceId,
      uid: this.deviceId,
      t: Math.floor(Date.now() / 1000).toString(),
      dp: {
        150: true,  // Enable recording/streaming
        151: "1"    // Stream mode: 1=HD, 2=SD
      }
    };

    // Create session key from local key
    this.sessionKey = crypto.createHash('md5')
      .update(this.localKey + 'stream')
      .digest();

    const encrypted = this.encryptPayload(JSON.stringify(payload));
    const packet = this.buildPacket(this.CMD_STREAM_START, encrypted);
    
    this.socket!.write(packet);
    this.log.debug('Stream request sent');
  }

  /**
   * Handle incoming stream data
   */
  private handleStreamData(data: Buffer): void {
    // Append to frame buffer
    this.frameBuffer = Buffer.concat([this.frameBuffer, data]);
    
    // Process complete packets
    while (this.frameBuffer.length >= 20) {
      // Check for Tuya header
      if (this.frameBuffer.toString('hex', 0, 4) !== '000055aa') {
        // Sync lost, try to find next packet
        const headerIndex = this.frameBuffer.indexOf(Buffer.from('000055aa', 'hex'), 1);
        if (headerIndex > 0) {
          this.frameBuffer = this.frameBuffer.slice(headerIndex);
        } else {
          this.frameBuffer = Buffer.alloc(0);
          break;
        }
      }
      
      // Parse packet header
      const command = this.frameBuffer.readUInt32BE(8);
      const payloadLen = this.frameBuffer.readUInt32BE(16);
      
      // Check if we have complete packet
      if (this.frameBuffer.length < 20 + payloadLen) {
        break; // Wait for more data
      }
      
      // Extract packet
      const packet = this.frameBuffer.slice(0, 20 + payloadLen);
      this.frameBuffer = this.frameBuffer.slice(20 + payloadLen);
      
      // Process packet
      if (command === this.CMD_STREAM_DATA) {
        const encryptedData = packet.slice(20, 20 + payloadLen - 8);
        const videoData = this.decryptPayload(encryptedData);
        
        // Emit raw H264 data
        this.emit('videoData', videoData);
      }
    }
  }

  /**
   * Encrypt payload
   */
  private encryptPayload(data: string): Buffer {
    const cipher = crypto.createCipheriv(
      'aes-128-ecb',
      this.sessionKey || Buffer.from(this.localKey, 'utf8'),
      Buffer.alloc(0)
    );
    
    return Buffer.concat([
      cipher.update(data, 'utf8'),
      cipher.final()
    ]);
  }

  /**
   * Decrypt payload
   */
  private decryptPayload(data: Buffer): Buffer {
    try {
      const decipher = crypto.createDecipheriv(
        'aes-128-ecb',
        this.sessionKey || Buffer.from(this.localKey, 'utf8'),
        Buffer.alloc(0)
      );
      
      return Buffer.concat([
        decipher.update(data),
        decipher.final()
      ]);
    } catch (e) {
      // Some cameras send unencrypted video data
      return data;
    }
  }

  /**
   * Build Tuya packet
   */
  private buildPacket(command: number, payload: Buffer): Buffer {
    const header = Buffer.from('000055aa', 'hex');
    const cmd = Buffer.alloc(4);
    cmd.writeUInt32BE(command);
    const seq = Buffer.alloc(4);
    seq.writeUInt32BE(Date.now() & 0xFFFFFFFF);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(payload.length + 8);
    
    // Calculate CRC32
    const crcData = Buffer.concat([header, cmd, seq, len, payload]);
    const crc = this.calculateCRC32(crcData);
    
    return Buffer.concat([
      crcData,
      crc,
      Buffer.from('0000aa55', 'hex')
    ]);
  }

  /**
   * Calculate CRC32
   */
  private calculateCRC32(data: Buffer): Buffer {
    const table = this.getCRCTable();
    let crc = 0xFFFFFFFF;
    
    for (const byte of data) {
      crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xFF];
    }
    
    crc = ~crc >>> 0;
    const result = Buffer.alloc(4);
    result.writeUInt32BE(crc);
    return result;
  }

  /**
   * Get CRC table
   */
  private getCRCTable(): number[] {
    const table: number[] = [];
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c;
    }
    return table;
  }

  /**
   * Stop stream
   */
  stop(): void {
    if (this.socket) {
      // Send stop command
      const payload = {
        gwId: this.deviceId,
        devId: this.deviceId,
        dp: { 150: false }
      };
      
      const encrypted = this.encryptPayload(JSON.stringify(payload));
      const packet = this.buildPacket(this.CMD_STREAM_STOP, encrypted);
      
      this.socket.write(packet);
      
      setTimeout(() => {
        this.socket?.destroy();
      }, 1000);
    }
  }
}