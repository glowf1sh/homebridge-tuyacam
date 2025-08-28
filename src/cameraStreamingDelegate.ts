import {
  CameraController,
  CameraStreamingDelegate,
  HAP,
  PrepareStreamCallback,
  PrepareStreamRequest,
  PrepareStreamResponse,
  SnapshotRequest,
  SnapshotRequestCallback,
  StreamingRequest,
  StreamRequestCallback,
  StreamRequestTypes,
  StreamSessionIdentifier,
  Logger,
} from 'homebridge';

import { spawn } from 'child_process';
import { TuyaDevice } from './tuyaDevice';
// import pickPort from 'pick-port';

interface SessionInfo {
  address: string;
  videoPort: number;
  videoSRTP: Buffer;
  videoSSRC: number;
  
  audioPort?: number;
  audioSRTP?: Buffer;
  audioSSRC?: number;
  
  ffmpeg?: any;
  ffmpegAudio?: any;
}

export class TuyaCameraStreamingDelegate implements CameraStreamingDelegate {
  private readonly hap: HAP;
  private readonly sessions: Map<StreamSessionIdentifier, SessionInfo> = new Map();
  
  controller?: CameraController;

  constructor(
    private readonly log: Logger,
    private readonly cameraConfig: any,
    _tuyaDevice: TuyaDevice,
    hap: HAP,
  ) {
    this.hap = hap;
  }

  /**
   * Handle snapshot request
   */
  async handleSnapshotRequest(request: SnapshotRequest, callback: SnapshotRequestCallback): Promise<void> {
    this.log.debug('Snapshot request:', request);
    
    // For now, return a placeholder image
    // TODO: Implement actual snapshot from Tuya camera
    const placeholderBuffer = Buffer.from(
      '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',
      'base64',
    );
    
    callback(undefined, placeholderBuffer);
  }

  /**
   * Prepare stream
   */
  prepareStream(request: PrepareStreamRequest, callback: PrepareStreamCallback): void {
    this.log.debug('Prepare stream request:', JSON.stringify(request));

    const sessionInfo: SessionInfo = {
      address: request.targetAddress,
      videoPort: request.video.port,
      videoSRTP: Buffer.concat([request.video.srtp_key, request.video.srtp_salt]),
      videoSSRC: this.hap.CameraController.generateSynchronisationSource(),
    };

    const response: PrepareStreamResponse = {
      video: {
        port: request.video.port,
        ssrc: sessionInfo.videoSSRC,
        srtp_key: request.video.srtp_key,
        srtp_salt: request.video.srtp_salt,
      },
    };

    // Handle audio if requested
    if (request.audio) {
      sessionInfo.audioPort = request.audio.port;
      sessionInfo.audioSRTP = Buffer.concat([request.audio.srtp_key, request.audio.srtp_salt]);
      sessionInfo.audioSSRC = this.hap.CameraController.generateSynchronisationSource();
      
      response.audio = {
        port: request.audio.port,
        ssrc: sessionInfo.audioSSRC,
        srtp_key: request.audio.srtp_key,
        srtp_salt: request.audio.srtp_salt,
      };
    }

    this.sessions.set(request.sessionID, sessionInfo);
    callback(undefined, response);
  }

  /**
   * Handle stream request
   */
  async handleStreamRequest(request: StreamingRequest, callback: StreamRequestCallback): Promise<void> {
    switch (request.type) {
      case StreamRequestTypes.START:
        await this.startStream(request, callback);
        break;
      case StreamRequestTypes.RECONFIGURE:
        this.log.debug('Reconfigure request');
        callback();
        break;
      case StreamRequestTypes.STOP:
        this.stopStream(request.sessionID);
        callback();
        break;
    }
  }

  /**
   * Start streaming
   */
  private async startStream(request: StreamingRequest, callback: StreamRequestCallback): Promise<void> {
    const sessionInfo = this.sessions.get(request.sessionID);
    if (!sessionInfo) {
      callback(new Error('Session not found'));
      return;
    }

    this.log.info('Starting stream for camera:', this.cameraConfig.name);

    // Get stream source
    const streamSource = await this.getStreamSource();
    if (!streamSource) {
      callback(new Error('No stream source available'));
      return;
    }

    const videoInfo = (request as any).video;
    // const audioInfo = (request as any).audio;

    // Build FFmpeg command for video
    const ffmpegArgs = [
      '-re', // Read input at native frame rate
      ...streamSource.inputArgs,
      '-threads', '0',
      '-vcodec', 'libx264',
      '-an', // No audio for now
      '-pix_fmt', 'yuv420p',
      '-r', '30',
      '-f', 'rawvideo',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-vf', `scale='min(${videoInfo.width},iw)':'min(${videoInfo.height},ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`,
      '-b:v', `${videoInfo.max_bit_rate}k`,
      '-bufsize', `${videoInfo.max_bit_rate * 2}k`,
      '-maxrate', `${videoInfo.max_bit_rate}k`,
      '-payload_type', videoInfo.pt?.toString() || '96',
      '-ssrc', sessionInfo.videoSSRC.toString(),
      '-f', 'rtp',
      '-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80',
      '-srtp_out_params', sessionInfo.videoSRTP.toString('base64'),
      `srtp://${sessionInfo.address}:${sessionInfo.videoPort}?rtcpport=${sessionInfo.videoPort}&localrtcpport=${sessionInfo.videoPort}&pkt_size=1378`,
    ];

    this.log.debug('Starting FFmpeg with args:', ffmpegArgs.join(' '));

    const ffmpeg = spawn('ffmpeg', ffmpegArgs, { env: process.env });

    ffmpeg.on('error', (error) => {
      this.log.error('FFmpeg error:', error.message);
    });

    ffmpeg.stderr.on('data', (data) => {
      if (!data.toString().includes('frame=')) {
        this.log.debug('FFmpeg:', data.toString());
      }
    });

    sessionInfo.ffmpeg = ffmpeg;
    callback();
  }

  /**
   * Stop streaming
   */
  private stopStream(sessionID: StreamSessionIdentifier): void {
    const sessionInfo = this.sessions.get(sessionID);
    if (sessionInfo) {
      if (sessionInfo.ffmpeg) {
        sessionInfo.ffmpeg.kill('SIGTERM');
      }
      if (sessionInfo.ffmpegAudio) {
        sessionInfo.ffmpegAudio.kill('SIGTERM');
      }
    }
    this.sessions.delete(sessionID);
  }

  /**
   * Get stream source
   * This is where we need to implement Tuya P2P streaming
   */
  private async getStreamSource(): Promise<any> {
    try {
      // Use the simpler stream decoder
      const { TuyaStreamDecoder } = await import('./tuyaStreamDecoder');
      
      // Create decoder instance
      const decoder = new TuyaStreamDecoder(
        this.cameraConfig.id,
        this.cameraConfig.key,
        this.cameraConfig.ip || '192.168.1.100', // Fallback to generic IP
        this.log
      );
      
      // Start streaming
      await decoder.startStream();
      
      // Create a pipe for video data
      const { PassThrough } = await import('stream');
      const videoInput = new PassThrough();
      
      // Pipe H264 data to FFmpeg
      decoder.on('videoData', (data: Buffer) => {
        // Add H264 NAL start code if not present
        if (!data.slice(0, 4).equals(Buffer.from([0, 0, 0, 1]))) {
          videoInput.write(Buffer.from([0, 0, 0, 1]));
        }
        videoInput.write(data);
      });
      
      // Store reference for cleanup
      (this as any).streamDecoder = decoder;
      
      this.log.info('Tuya video stream started successfully!');
      
      // Return FFmpeg configuration
      return {
        inputArgs: [
          '-f', 'h264',
          '-i', 'pipe:0',
          '-fflags', 'nobuffer+genpts',
          '-flags', 'low_delay',
          '-probesize', '32',
          '-analyzeduration', '0'
        ],
        inputStream: videoInput
      };
      
    } catch (error) {
      this.log.error('Failed to start Tuya stream:', error);
      
      // Fallback to test pattern
      this.log.warn('Using test pattern as fallback');
      return {
        inputArgs: [
          '-f', 'lavfi',
          '-i', 'testsrc=size=1280x720:rate=30',
          '-t', '3600'
        ],
      };
    }
  }
}