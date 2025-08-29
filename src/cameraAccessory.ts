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
  private motionService?: Service;
  private tuyaDevice: TuyaDevice;
  private streamingDelegate: TuyaCameraStreamingDelegate;

  constructor(
    private readonly platform: SimpleTuyaCamPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    const device = accessory.context.device;
    
    this.platform.log.debug('Setting up camera:', device.name);
    
    // IMPORTANT: Set accessory information AFTER camera controller
    const infoService = this.accessory.getService(this.platform.Service.AccessoryInformation)!;
    infoService
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Tuya')
      .setCharacteristic(this.platform.Characteristic.Model, device.model || 'Smart Camera')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, device.id)
      .setCharacteristic(this.platform.Characteristic.Name, device.name);
    
    // Remove any existing services that might interfere
    const existingServices = this.accessory.services.filter(
      service => service.UUID !== this.platform.Service.AccessoryInformation.UUID
    );
    
    existingServices.forEach(service => {
      this.platform.log.debug(`Removing existing service: ${service.displayName || service.UUID}`);
      this.accessory.removeService(service);
    });

    // Create Tuya device instance
    this.tuyaDevice = new TuyaDevice(
      device.id,
      device.key,
      device.ip,
      this.platform.log,
    );

    // Connect to device
    this.tuyaDevice.connect()
      .then((connected) => {
        if (connected) {
          this.platform.log.info(`Connected to camera: ${device.name}`);
        } else {
          this.platform.log.error(`Failed to connect to camera: ${device.name}`);
        }
      });

    // Set up camera streaming delegate
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
        // Disable audio completely to prevent microphone service
        audio: undefined,
      },
    };

    // CRITICAL DEBUG LOGGING
    this.platform.log.warn(`[${device.name}] USING CAMERA OPTIONS: ${JSON.stringify(options, null, 2)}`);

    // Create camera controller - this automatically adds all necessary camera services
    this.platform.log.info(`[${device.name}] Preparing CameraController...`);
    
    try {
      const cameraController = new this.platform.api.hap.CameraController(options);
      this.streamingDelegate.controller = cameraController;
      
      // Configure the camera controller for this accessory
      this.accessory.configureController(cameraController);
      this.platform.log.info(`[${device.name}] CameraController configured successfully!`);
    } catch (e) {
      this.platform.log.error(`[${device.name}] FAILED to configure CameraController:`, e);
    }

    // Add Motion Sensor service (optional) - AFTER camera controller
    // TEMPORARILY DISABLED FOR DEBUGGING
    // this.setupMotionSensor();

    this.platform.log.info('Camera accessory configured:', device.name);
  }

  /**
   * Setup motion sensor if camera supports it
   */
  // @ts-ignore - Temporarily disabled for debugging
  private setupMotionSensor(): void {
    const device = this.accessory.context.device;
    
    // Only add motion sensor if explicitly enabled
    if (device.motion === false) {
      return;
    }

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
      this.motionService!.updateCharacteristic(
        this.platform.Characteristic.MotionDetected,
        detected,
      );
    });

    // Poll for motion status periodically
    setInterval(() => {
      this.tuyaDevice.getMotionStatus()
        .then((detected) => {
          this.motionService!.updateCharacteristic(
            this.platform.Characteristic.MotionDetected,
            detected,
          );
        })
        .catch((error) => {
          this.platform.log.debug('Failed to get motion status:', error);
        });
    }, 10000); // Check every 10 seconds
  }
}