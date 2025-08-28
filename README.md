# homebridge-tuyacam

Homebridge plugin for Tuya security cameras. Add your Tuya/Smart Life cameras to Apple HomeKit!

## Features

- 🎥 Live camera streaming in Home app
- 🚨 Motion detection alerts
- 🎮 PTZ control (for supported cameras)
- 🔒 Local control (no cloud dependency)
- 📱 Works with Smart Life and Tuya Smart apps

## Requirements

- Homebridge v1.3.0 or later
- Node.js v14 or later
- FFmpeg (automatically installed)
- **Device ID and Local Key for each camera**

## Installation

```bash
npm install -g homebridge-tuyacam
```

## Getting Device ID and Local Key

You need the Device ID and Local Key for each camera. These are required for local control.

### Method 1: Using TinyTuya (Recommended)

1. Install Python and TinyTuya:
```bash
pip3 install tinytuya
```

2. Run the wizard:
```bash
python3 -m tinytuya wizard
```

3. Follow the instructions to link your Smart Life account
4. Your devices will be saved to `devices.json`

### Method 2: Using a Proxy App

See our [detailed guide](https://github.com/yourusername/homebridge-tuyacam/wiki/Getting-Local-Keys) for proxy methods.

## Configuration

Add this to your Homebridge `config.json`:

```json
{
  "platform": "TuyaCam",
  "name": "Tuya Cameras",
  "cameras": [
    {
      "name": "Living Room Camera",
      "id": "YOUR_DEVICE_ID_HERE",
      "key": "YOUR_LOCAL_KEY_HERE",
      "ip": "192.168.1.100"
    }
  ]
}
```

### Configuration Options

- `name` (required): Display name in HomeKit
- `id` (required): Tuya Device ID
- `key` (required): Local Key (16 characters)
- `ip` (optional): Camera IP address (will auto-discover if not provided)


## Example Configuration

```json
{
  "platforms": [
    {
      "platform": "TuyaCam",
      "name": "My Cameras",
      "cameras": [
        {
          "name": "Front Door",
          "id": "YOUR_DEVICE_ID_HERE",
          "key": "YOUR_LOCAL_KEY_HERE",
          "ip": "192.168.1.100"
        },
        {
          "name": "Backyard",
          "id": "ANOTHER_DEVICE_ID",
          "key": "ANOTHER_LOCAL_KEY"
        }
      ]
    }
  ]
}
```

## Supported Cameras

This plugin works with most Tuya-based security cameras sold under various brands:
- Smart Life compatible cameras
- Tuya Smart compatible cameras
- Most WiFi security cameras from AliExpress
- Various rebranded Tuya cameras

## Troubleshooting

### Camera not showing video
- Ensure Device ID and Local Key are correct
- Check if camera is online in Smart Life app
- Enable debug mode to see detailed logs

### Cannot find Local Key
- Keys don't change unless you factory reset
- Try all extraction methods
- Ask in our Discord/GitHub for help

### Motion detection not working
- Not all cameras support motion detection
- Check if enabled in Smart Life app

## Notes

- This plugin requires manual configuration of Device ID and Local Key
- Tuya cameras use proprietary P2P protocol, not standard RTSP
- Video streaming is still under development
- Some features may not work with all camera models

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## Author

Created by [Glowf1sh](https://twitch.tv/glowf1sh)

## License

MIT

## Disclaimer

This plugin is not affiliated with Tuya Inc. All product names, logos, and brands are property of their respective owners.