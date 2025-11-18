# Building Electron Executable - Instructions

## ⚠️ Important: Close Running Electron Apps First!

Before building, make sure to:
1. Close any running Electron windows/apps
2. Close any file explorers that might have the `dist` folder open
3. This prevents file lock errors during build

## Build Steps

### 1. Build React App
```bash
npm run build
```

### 2. Build Electron Executable
```bash
npm run dist
```

Or use the combined command:
```bash
npm run electron-build
```

## Output

After successful build, you'll find:

**Windows Installer:**
- Location: `dist/Werkstatt Verwaltung Setup x.x.x.exe`
- This is a full NSIS installer that users can run to install the app

**Unpacked App (for testing):**
- Location: `dist/win-unpacked/Werkstatt Verwaltung.exe`
- You can run this directly without installing

## Troubleshooting

### Error: "file is being used by another process"
- **Solution**: Close all Electron windows and file explorers, then try again

### Error: "electron.js was not found"
- **Solution**: Make sure `electron.js` exists in the root directory
- Run `npm run build` first to ensure build folder exists

### Build takes a long time
- This is normal on first build - electron-builder downloads Electron binaries
- Subsequent builds will be faster

## Development Mode

To test the app in development:
```bash
npm run electron-dev
```

This runs React dev server + Electron with hot-reload.

## Testing Production Build

To test the production build locally:
```bash
npm run build
npm run electron
```

This opens Electron with the production build (not dev server).

