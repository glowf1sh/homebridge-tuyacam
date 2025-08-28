import { 
  Service, 
  PlatformAccessory,
  CameraControllerOptions,
} from 'homebridge';

import { SimpleTuyaCamPlatform } from './simplePlatform';
import { TuyaDevice } from './tuyaDevice';
import { TuyaCameraStreamingDelegate } from './cameraStreamingDelegate';

/**
 * Tuya Camera Accessory
 */
export class TuyaCameraAccessory {
  private service: Service;
  private motionService?: Service;
  private tuyaDevice: TuyaDevice;
  private streamingDelegate: TuyaCameraStreamingDelegate;

  constructor(
    private readonly platform: SimpleTuyaCamPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    const device = accessory.context.device;
    
    // Set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Tuya')
      .setCharacteristic(this.platform.Characteristic.Model, device.model || 'Smart Camera')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, device.id);

    // Initialize Tuya device connection
    this.tuyaDevice = new TuyaDevice(
      device.id,
      device.key,
      device.ip,
      this.platform.log,
    );

    // Connect to device
    this.tuyaDevice.connect().then(connected => {
      if (connected) {
        this.platform.log.info(`Connected to camera: ${device.name}`);
      } else {
        this.platform.log.error(`Failed to connect to camera: ${device.name}`);
      }
    });

    // Setup camera streaming
    this.streamingDelegate = new TuyaCameraStreamingDelegate(
      this.platform.log,
      device,
      this.tuyaDevice,
      this.platform.api.hap,
    );

    const options: CameraControllerOptions = {
      cameraStreamCount: 2,
      delegate: this.streamingDelegate,
      streamingOptions: {
        supportedCryptoSuites: [this.platform.api.hap.SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80],
        video: {
          resolutions: [
            [1920, 1080, 30],
            [1280, 720, 30],
            [640, 480, 30],
            [320, 240, 15],
          ],
          codec: {
            profiles: [
              this.platform.api.hap.H264Profile.BASELINE,
              this.platform.api.hap.H264Profile.MAIN,
              this.platform.api.hap.H264Profile.HIGH,
            ],
            levels: [
              this.platform.api.hap.H264Level.LEVEL3_1,
              this.platform.api.hap.H264Level.LEVEL3_2,
              this.platform.api.hap.H264Level.LEVEL4_0,
            ],
          },
        },
        audio: {
          twoWayAudio: false,
          codecs: [
            {
              type: this.platform.api.hap.AudioStreamingCodecType.AAC_ELD,
              samplerate: this.platform.api.hap.AudioStreamingSamplerate.KHZ_16,
            },
          ],
        },
      },
    };

    const cameraController = new this.platform.api.hap.CameraController(options);
    this.streamingDelegate.controller = cameraController;
    this.accessory.configureController(cameraController);

    // Get the Camera service if it exists, otherwise create a new Camera service
    const CameraService = (this.platform.Service as any).Camera;
    this.service = this.accessory.getService(CameraService) || 
      this.accessory.addService(CameraService);

    // Add Motion Sensor service (optional)
    this.setupMotionSensor();

    // Set the service name, this is what is displayed as the default name on the Home app
    this.service.setCharacteristic(this.platform.Characteristic.Name, device.name);
  }

  /**
   * Setup motion sensor if camera supports it
   */
  private setupMotionSensor() {
    const device = this.accessory.context.device;
    
    // Check if motion detection is supported (DP 134 based on tinytuya output)
    const supportsMotion = true; // We know from the mapping that both cameras have motion_switch

    if (supportsMotion) {
      this.motionService = this.accessory.getService(this.platform.Service.MotionSensor) || 
        this.accessory.addService(this.platform.Service.MotionSensor);

      this.motionService.setCharacteristic(this.platform.Characteristic.Name, `${device.name} Motion`);

      // Set initial state
      this.motionService.updateCharacteristic(
        this.platform.Characteristic.MotionDetected,
        false,
      );

      // Listen for motion events from Tuya device
      this.tuyaDevice.on('motion', (detected: boolean) => {
        this.platform.log.debug(`Motion ${detected ? 'detected' : 'cleared'} on ${device.name}`);
        this.motionService?.updateCharacteristic(
          this.platform.Characteristic.MotionDetected,
          detected,
        );
      });

      // Poll motion status periodically
      setInterval(async () => {
        try {
          const motionDetected = await this.tuyaDevice.getMotionStatus();
          this.motionService?.updateCharacteristic(
            this.platform.Characteristic.MotionDetected,
            motionDetected,
          );
        } catch (error) {
          this.platform.log.debug('Failed to get motion status:', error);
        }
      }, 10000); // Poll every 10 seconds
    }
  }
}