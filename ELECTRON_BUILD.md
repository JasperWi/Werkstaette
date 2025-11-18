# Building Electron Executable

## Setup Complete ✅

Your React app is now configured to build as an Electron desktop application.

## Development Mode

To run the app in development mode with hot-reload:

```bash
npm run electron-dev
```

This will:
1. Start the React development server
2. Wait for it to be ready
3. Launch Electron window

## Build for Production

### Step 1: Build React App
```bash
npm run build
```

### Step 2: Create Executable
```bash
npm run dist
```

Or use the combined command:
```bash
npm run electron-build
```

## Output Location

The executable will be created in the `dist/` folder:

- **Windows**: `dist/Werkstatt Verwaltung Setup x.x.x.exe` (NSIS installer)
- **macOS**: `dist/Werkstatt Verwaltung-x.x.x.dmg`
- **Linux**: `dist/Werkstatt Verwaltung-x.x.x.AppImage`

## Windows Executable

After running `npm run dist`, you'll find:
- **Installer**: `dist/Werkstatt Verwaltung Setup x.x.x.exe` - Full installer with options
- The installer allows users to:
  - Choose installation directory
  - Create desktop shortcut
  - Create start menu shortcut

## Testing the Built App

After building, you can test the production build locally:

```bash
npm run build
npm run electron
```

This will open the Electron window with the production build (not the dev server).

## Notes

- The app uses `localStorage` for data persistence, which works in Electron
- All React features work the same as in the browser
- PDF generation works in Electron
- File downloads work in Electron

