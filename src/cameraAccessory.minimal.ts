import { 
  PlatformAccessory,
  CameraControllerOptions,
} from 'homebridge';

import { SimpleTuyaCamPlatform } from './simplePlatform';
import { TuyaDevice } from './tuyaDevice';
import { TuyaCameraStreamingDelegate } from './cameraStreamingDelegate';

/**
 * Tuya Camera Accessory - MINIMAL TEST VERSION
 */
export class TuyaCameraAccessory {
  // private motionService?: Service; // Disabled for minimal test
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

    // MINIMAL TEST CONFIGURATION
    this.platform.log.warn(`[${device.name}] !!! USING MINIMAL DEBUG CONFIGURATION !!!`);
    const options: CameraControllerOptions = {
      cameraStreamCount: 2, // HomeKit requires at least 2 streams
      delegate: this.streamingDelegate, // The accessory must implement the streaming delegate methods
      streamingOptions: {
        supportedCryptoSuites: [this.platform.api.hap.SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80],
        video: {
          resolutions: [
            // width, height, fps
            [1920, 1080, 30],
            [1280, 720, 30],
            [640, 360, 30],
          ],
          codec: {
            profiles: [this.platform.api.hap.H264Profile.MAIN],
            levels: [this.platform.api.hap.H264Level.LEVEL4_0],
          },
        },
        audio: {
          // Even if you don't use it, you often need to declare support
          codecs: [
            {
              type: this.platform.api.hap.AudioStreamingCodecType.OPUS,
              samplerate: this.platform.api.hap.AudioStreamingSamplerate.KHZ_24,
            },
          ],
        },
      },
    };

    // CRITICAL DEBUG LOGGING
    this.platform.log.warn(`[${device.name}] USING MINIMAL CAMERA OPTIONS: ${JSON.stringify(options, null, 2)}`);

    // Create camera controller - this automatically adds all necessary camera services
    this.platform.log.info(`[${device.name}] Preparing CameraController...`);
    
    try {
      const cameraController = new this.platform.api.hap.CameraController(options);
      this.streamingDelegate.controller = cameraController;
      
      // Configure the camera controller for this accessory
      this.accessory.configureController(cameraController);
      this.platform.log.info(`[${device.name}] CameraController configured successfully!`);
      
      // Get the Camera Control service to ensure it's primary
      const cameraControlService = this.accessory.getService(this.platform.Service.CameraControl);
      if (cameraControlService) {
        this.platform.log.info(`[${device.name}] CameraControl service found, setting as primary`);
        // this.accessory.setPrimaryService(cameraControlService); // Method not available in this version
      } else {
        this.platform.log.error(`[${device.name}] CameraControl service NOT found!`);
      }
    } catch (e) {
      this.platform.log.error(`[${device.name}] FAILED to configure CameraController:`, e);
    }

    // DO NOT add Motion Sensor for this test
    this.platform.log.warn(`[${device.name}] Motion sensor DISABLED for minimal test`);

    this.platform.log.info('Camera accessory configured:', device.name);
  }
}