const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const toIco = require('to-ico');

const iconsDir = path.join(__dirname, 'icons');
const svgPath = path.join(iconsDir, 'icon.svg');

// Check if SVG exists
if (!fs.existsSync(svgPath)) {
  console.error('❌ Error: icon.svg not found in the icons folder!');
  console.error('   Please place your SVG file at: icons/icon.svg');
  process.exit(1);
}

// Validate SVG file is not empty
const svgStats = fs.statSync(svgPath);
if (svgStats.size === 0) {
  console.error('❌ Error: icon.svg is empty!');
  console.error('   Please provide a valid SVG file.');
  process.exit(1);
}

// Check if it's actually an SVG file
const svgContent = fs.readFileSync(svgPath, 'utf8');
if (!svgContent.includes('<svg') && !svgContent.includes('<SVG')) {
  console.error('❌ Error: icon.svg does not appear to be a valid SVG file!');
  console.error('   The file should contain SVG markup (starting with <svg>).');
  process.exit(1);
}

console.log('🎨 Generating icons from SVG...');

async function generateIcons() {
  try {
    // Generate PNG at 1024x1024 (for high quality)
    const png1024 = await sharp(svgPath)
      .resize(1024, 1024)
      .png()
      .toBuffer();

    // Generate PNG at 512x512 (for Linux)
    const png512 = await sharp(svgPath)
      .resize(512, 512)
      .png()
      .toBuffer();

    // Save Linux icon (512x512 PNG)
    fs.writeFileSync(path.join(iconsDir, 'icon.png'), png512);
    console.log('✅ Generated icon.png (512x512) for Linux');

    // Generate multiple sizes for Windows ICO
    const sizes = [16, 32, 48, 64, 128, 256];
    const icoBuffers = await Promise.all(
      sizes.map(size =>
        sharp(svgPath)
          .resize(size, size)
          .png()
          .toBuffer()
      )
    );

    // Create ICO file for Windows
    const ico = await toIco(icoBuffers);
    fs.writeFileSync(path.join(iconsDir, 'icon.ico'), ico);
    console.log('✅ Generated icon.ico (multiple sizes) for Windows');

    // Generate multiple sizes for macOS ICNS
    // Note: ICNS requires a special format, so we'll create a temporary iconset
    const iconsetDir = path.join(iconsDir, 'icon.iconset');
    if (!fs.existsSync(iconsetDir)) {
      fs.mkdirSync(iconsetDir, { recursive: true });
    }

    const macSizes = [
      { size: 16, name: 'icon_16x16.png' },
      { size: 32, name: 'icon_16x16@2x.png' },
      { size: 32, name: 'icon_32x32.png' },
      { size: 64, name: 'icon_32x32@2x.png' },
      { size: 128, name: 'icon_128x128.png' },
      { size: 256, name: 'icon_128x128@2x.png' },
      { size: 256, name: 'icon_256x256.png' },
      { size: 512, name: 'icon_256x256@2x.png' },
      { size: 512, name: 'icon_512x512.png' },
      { size: 1024, name: 'icon_512x512@2x.png' },
    ];

    for (const { size, name } of macSizes) {
      const buffer = await sharp(svgPath)
        .resize(size, size)
        .png()
        .toBuffer();
      fs.writeFileSync(path.join(iconsetDir, name), buffer);
    }

    console.log('✅ Generated icon.iconset for macOS');
    console.log('   Note: To create icon.icns, run on macOS: iconutil -c icns icon.iconset');
    console.log('   Or use an online converter if you\'re on Windows/Linux');

    console.log('\n✨ Icon generation complete!');
    console.log('   Icons are ready in the icons/ folder');
  } catch (error) {
    console.error('❌ Error generating icons:', error.message);
    process.exit(1);
  }
}

generateIcons();

