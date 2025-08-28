import { 
  API, 
  DynamicPlatformPlugin, 
  Logger, 
  PlatformAccessory, 
  PlatformConfig, 
  Service, 
  Characteristic 
} from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { TuyaCameraAccessory } from './cameraAccessory';

interface CameraConfig {
  name: string;
  id: string;
  key: string;
  ip?: string;
}

interface SimplePlatformConfig extends PlatformConfig {
  name: string;
  username?: string;
  password?: string;
  countryCode?: string;
  cameras: CameraConfig[];
}

/**
 * Simple Tuya Camera Platform
 * Requires manual device ID and local key configuration
 */
export class SimpleTuyaCamPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly accessories: PlatformAccessory[] = [];

  constructor(
    public readonly log: Logger,
    public readonly config: SimplePlatformConfig,
    public readonly api: API,
  ) {
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;

    this.log.debug('Finished initializing platform:', this.config.name);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already.
    this.api.on('didFinishLaunching', () => {
      this.log.debug('Executed didFinishLaunching callback');
      this.discoverDevices();
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

  /**
   * Register cameras from config
   */
  discoverDevices() {
    // Check if we have cameras configured
    if (!this.config.cameras || this.config.cameras.length === 0) {
      this.log.warn('No cameras configured! Please add cameras to your config.');
      return;
    }

    this.log.info(`Found ${this.config.cameras.length} configured cameras`);

    // Loop through configured cameras
    for (const camera of this.config.cameras) {
      // Validate required fields
      if (!camera.id || !camera.key) {
        this.log.error(`Camera "${camera.name}" is missing required fields (id, key). Skipping...`);
        continue;
      }

      // Generate a unique id for the accessory
      // Generate UUID with prefix to force new accessory
      const uuid = this.api.hap.uuid.generate('tuyacam_' + camera.id);

      // See if an accessory with the same uuid has already been registered and restored from
      // the cached devices we stored in the `configureAccessory` method above
      const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

      if (existingAccessory) {
        // The accessory already exists
        this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

        // Update the accessory context with the latest config
        existingAccessory.context.device = camera;
        
        // Make sure the category is set to Camera
        existingAccessory.category = this.api.hap.Categories.CAMERA;
        
        this.api.updatePlatformAccessories([existingAccessory]);

        // Create the accessory handler
        new TuyaCameraAccessory(this, existingAccessory);
      } else {
        // The accessory does not yet exist, so we need to create it
        this.log.info('Adding new accessory:', camera.name);

        // Create a new accessory
        const accessory = new this.api.platformAccessory(camera.name, uuid);

        // Store a copy of the device object in the `accessory.context`
        accessory.context.device = camera;
        
        // Set the accessory category to Camera
        accessory.category = this.api.hap.Categories.CAMERA;

        // Create the accessory handler
        new TuyaCameraAccessory(this, accessory);

        // Link the accessory to your platform
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }

    // Remove cameras that are no longer in the config
    const configuredCameraIds = this.config.cameras.map(c => c.id);
    const accessoriesToRemove = this.accessories.filter(accessory => {
      const device = accessory.context.device;
      return device && !configuredCameraIds.includes(device.id);
    });

    if (accessoriesToRemove.length > 0) {
      this.log.info(`Removing ${accessoriesToRemove.length} cached accessories that are no longer configured`);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, accessoriesToRemove);
    }
  }
}