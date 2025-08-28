import { Logger } from 'homebridge';
import { EventEmitter } from 'events';
import * as net from 'net';
import * as crypto from 'crypto';
import * as dgram from 'dgram';

/**
 * Tuya Device Communication
 * Handles P2P protocol for camera streaming
 */
export class TuyaDevice extends EventEmitter {
  private socket?: net.Socket;
  private connected = false;
  private sequence = 0;
  private heartbeatInterval?: NodeJS.Timeout;
  private readonly version = '3.3'; // Protocol version

  // Data Points (DPs) for cameras
  private readonly DP = {
    MOTION_SWITCH: 134,
    MOTION_DETECTED: 115,
    PTZ_CONTROL: 119,
    NIGHT_VISION: 124,
    FLIP: 103,
    RECORD: 150,
  };

  constructor(
    private readonly deviceId: string,
    private readonly localKey: string,
    private ip: string | undefined,
    private readonly log: Logger,
  ) {
    super();
    
    // If no IP provided, try to discover it
    if (!this.ip) {
      this.discoverIP();
    }
  }

  /**
   * Connect to the Tuya device
   */
  async connect(): Promise<boolean> {
    if (this.connected) {
      return true;
    }

    if (!this.ip) {
      this.log.error('No IP address for device');
      return false;
    }

    return new Promise((resolve) => {
      this.socket = new net.Socket();
      this.socket.setTimeout(10000);

      this.socket.on('connect', () => {
        this.log.debug(`Connected to ${this.ip}:6668`);
        this.connected = true;
        this.startHeartbeat();
        resolve(true);
      });

      this.socket.on('data', (data) => {
        this.handleData(data);
      });

      this.socket.on('error', (err) => {
        this.log.error('Socket error:', err.message);
        this.connected = false;
        resolve(false);
      });

      this.socket.on('close', () => {
        this.log.debug('Socket closed');
        this.connected = false;
        this.stopHeartbeat();
      });

      this.socket.connect(6668, this.ip!);
    });
  }

  /**
   * Disconnect from device
   */
  disconnect() {
    this.stopHeartbeat();
    if (this.socket) {
      this.socket.destroy();
      this.socket = undefined;
    }
    this.connected = false;
  }

  /**
   * Send command to device
   */
  private async sendCommand(command: number, payload: any = {}): Promise<any> {
    if (!this.connected || !this.socket) {
      throw new Error('Not connected');
    }

    // Add required fields
    const data = {
      gwId: this.deviceId,
      devId: this.deviceId,
      uid: this.deviceId,
      t: Math.floor(Date.now() / 1000).toString(),
      ...payload,
    };

    const jsonStr = JSON.stringify(data);
    const jsonBytes = Buffer.from(jsonStr);

    // Encrypt payload for 3.3
    let encrypted: Buffer;
    if (this.version === '3.3') {
      // Add padding
      const cipher = crypto.createCipheriv(
        'aes-128-ecb',
        this.localKey,
        Buffer.alloc(0),
      );
      encrypted = Buffer.concat([
        cipher.update(jsonBytes),
        cipher.final(),
      ]);
    } else {
      encrypted = jsonBytes;
    }

    // Build packet
    const packet = this.buildPacket(command, encrypted);
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Command timeout'));
      }, 5000);

      const handler = (response: any) => {
        clearTimeout(timeout);
        resolve(response);
      };

      this.once(`response_${this.sequence}`, handler);
      this.socket!.write(packet);
    });
  }

  /**
   * Build Tuya packet
   */
  private buildPacket(command: number, payload: Buffer): Buffer {
    this.sequence++;
    
    // Packet structure
    const header = Buffer.from('000055aa', 'hex');
    const cmd = Buffer.alloc(4);
    cmd.writeUInt32BE(command);
    const seq = Buffer.alloc(4);
    seq.writeUInt32BE(this.sequence);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(payload.length + 8); // payload + suffix

    // Calculate CRC
    const crcData = Buffer.concat([header, cmd, seq, len, payload]);
    const crc = this.calculateCRC(crcData);
    
    const suffix = Buffer.concat([
      crc,
      Buffer.from('0000aa55', 'hex'),
    ]);

    return Buffer.concat([crcData, suffix]);
  }

  /**
   * Calculate CRC32
   */
  private calculateCRC(data: Buffer): Buffer {
    let crc = 0xFFFFFFFF;
    for (const byte of data) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) {
        if (crc & 1) {
          crc = (crc >>> 1) ^ 0xEDB88320;
        } else {
          crc = crc >>> 1;
        }
      }
    }
    crc = ~crc >>> 0;
    
    const result = Buffer.alloc(4);
    result.writeUInt32BE(crc);
    return result;
  }

  /**
   * Handle incoming data
   */
  private handleData(data: Buffer) {
    // Check for valid packet
    if (data.length < 20 || !data.toString('hex').startsWith('000055aa')) {
      return;
    }

    const command = data.readUInt32BE(8);
    const sequence = data.readUInt32BE(12);
    const length = data.readUInt32BE(16);
    
    if (data.length < 20 + length) {
      return; // Incomplete packet
    }

    const encrypted = data.slice(20, 20 + length - 8);
    
    // Decrypt payload
    let decrypted: Buffer;
    try {
      if (this.version === '3.3' && encrypted.length > 0) {
        const decipher = crypto.createDecipheriv(
          'aes-128-ecb',
          this.localKey,
          Buffer.alloc(0),
        );
        decrypted = Buffer.concat([
          decipher.update(encrypted),
          decipher.final(),
        ]);
      } else {
        decrypted = encrypted;
      }
    } catch (err) {
      this.log.debug('Failed to decrypt payload');
      return;
    }

    // Parse JSON
    try {
      const jsonStr = decrypted.toString().replace(/\0/g, '');
      if (jsonStr) {
        const payload = JSON.parse(jsonStr);
        this.handlePayload(command, sequence, payload);
      }
    } catch (err) {
      this.log.debug('Failed to parse payload');
    }
  }

  /**
   * Handle decrypted payload
   */
  private handlePayload(command: number, sequence: number, payload: any) {
    this.log.debug(`Received command ${command}:`, payload);
    
    // Emit response for waiting commands
    this.emit(`response_${sequence}`, payload);
    
    // Handle status updates
    if (command === 8 && payload.dps) {
      // Motion detected
      if (payload.dps[this.DP.MOTION_DETECTED] !== undefined) {
        this.emit('motion', true);
        // Auto clear after 30 seconds
        setTimeout(() => this.emit('motion', false), 30000);
      }
    }
  }

  /**
   * Get current device status
   */
  async getStatus(): Promise<any> {
    return this.sendCommand(0x0a, { dps: {} });
  }

  /**
   * Get motion detection status
   */
  async getMotionStatus(): Promise<boolean> {
    try {
      const status = await this.getStatus();
      return status?.dps?.[this.DP.MOTION_SWITCH] || false;
    } catch (error) {
      return false;
    }
  }

  /**
   * Start video stream
   */
  async startStream(): Promise<any> {
    // This is camera specific and varies by model
    // Most Tuya cameras use their app for P2P streaming
    // We'll implement a basic request here
    return this.sendCommand(0x12, {
      dps: {
        150: true, // Enable streaming
      },
    });
  }

  /**
   * Control PTZ (for supported cameras)
   */
  async controlPTZ(direction: 'up' | 'down' | 'left' | 'right' | 'stop'): Promise<void> {
    const directionMap = {
      'up': '2',
      'down': '3',
      'left': '0',
      'right': '1',
      'stop': '4',
    };

    await this.sendCommand(0x07, {
      dps: {
        [this.DP.PTZ_CONTROL]: directionMap[direction],
      },
    });
  }

  /**
   * Start heartbeat to keep connection alive
   */
  private startHeartbeat() {
    this.heartbeatInterval = setInterval(async () => {
      try {
        await this.sendCommand(0x09, {});
      } catch (error) {
        this.log.debug('Heartbeat failed');
      }
    }, 10000);
  }

  /**
   * Stop heartbeat
   */
  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
  }

  /**
   * Discover device IP via UDP broadcast
   */
  private async discoverIP() {
    return new Promise<void>((resolve) => {
      const socket = dgram.createSocket('udp4');
      const timeout = setTimeout(() => {
        socket.close();
        resolve();
      }, 5000);

      socket.on('message', (msg, rinfo) => {
        try {
          const message = msg.toString();
          if (message.includes(this.deviceId)) {
            this.ip = rinfo.address;
            this.log.info(`Discovered device at ${this.ip}`);
            clearTimeout(timeout);
            socket.close();
            resolve();
          }
        } catch (e) {}
      });

      socket.bind(() => {
        socket.setBroadcast(true);
        const discoveryPacket = JSON.stringify({ gwId: this.deviceId });
        socket.send(discoveryPacket, 6666, '255.255.255.255');
        socket.send(discoveryPacket, 6667, '255.255.255.255');
      });
    });
  }
}