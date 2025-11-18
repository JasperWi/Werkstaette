# Custom Icon Setup

## How to Use Your Own SVG Icon

1. **Place your SVG file here**: 
   - Save your SVG graphic as `icon.svg` in this folder (replace the example if it exists)
   - The SVG should be square (e.g., 512x512 or 1024x1024 recommended)
   - Make sure it looks good at different sizes (16x16 to 1024x1024)
   - See `icon.svg.example` for a basic example format

2. **Generate icons automatically**: 
   - The icons will be automatically generated when you run `build-exe.bat`
   - Or manually run: `npm run generate-icons`

3. **Build the executable**: 
   - Use the batch file: `build-exe.bat` (recommended - it handles everything)
   - Or manually: `npm run dist`

## Generated Files

After running the icon generation, the following files will be created:
- `icon.ico` - Windows icon (multiple sizes: 16, 32, 48, 64, 128, 256)
- `icon.png` - Linux icon (512x512)
- `icon.iconset/` - macOS iconset folder (for creating .icns)

**Note for macOS**: If you need to build for macOS, you'll need to convert the iconset to .icns:
- On macOS: `iconutil -c icns icon.iconset`
- Or use an online converter if you're on Windows/Linux

## Quick Start

1. Place your `icon.svg` file in this folder
2. Double-click `build-exe.bat` in the main project folder
3. Done! Your executable will have your custom icon.

