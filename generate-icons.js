#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

/**
 * PWA Icon Generator for Mindline
 * Generates proper PNG icons from SVG source
 */

console.log('🎨 Generating PWA icons...');

// Icon sizes needed for PWA
const iconSizes = [
  16, 32, 72, 96, 128, 144, 152, 192, 384, 512
];

// Create simple colored squares as placeholder icons
// This is a temporary solution until proper SVG conversion is set up
const createPlaceholderIcon = (size) => {
  // Create a simple PNG header for a colored square
  // This is a minimal approach - in production you'd use a proper image library

  const color = {
    r: 94,   // #5E81AC (theme color)
    g: 129,
    b: 172
  };

  console.log(`  → Creating ${size}x${size} placeholder icon`);

  // For now, create a simple colored HTML that can be used for testing
  // In a real implementation, you'd use sharp, canvas, or ImageMagick
  const htmlIcon = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <rect width="${size}" height="${size}" fill="#5E81AC"/>
      <text x="50%" y="50%" font-family="Arial" font-size="${Math.floor(size/4)}"
            fill="white" text-anchor="middle" dominant-baseline="middle">M</text>
    </svg>
  `;

  return htmlIcon;
};

// Check if we have a proper icon generation tool available
const checkImageMagick = () => {
  try {
    require('child_process').execSync('convert -version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

const checkSharp = () => {
  try {
    require('sharp');
    return true;
  } catch {
    return false;
  }
};

// Generate icons
const generateIcons = async () => {
  const iconsDir = path.join(__dirname, 'icons');

  // Ensure icons directory exists
  if (!fs.existsSync(iconsDir)) {
    fs.mkdirSync(iconsDir, { recursive: true });
  }

  if (checkSharp()) {
    console.log('📦 Using Sharp for icon generation');
    await generateWithSharp(iconsDir);
  } else if (checkImageMagick()) {
    console.log('🔧 Using ImageMagick for icon generation');
    await generateWithImageMagick(iconsDir);
  } else {
    console.log('⚠️  No image processing library found');
    console.log('📝 Creating SVG fallbacks for testing');
    await generateSVGFallbacks(iconsDir);
    console.log('');
    console.log('🔧 To generate proper PNG icons, install one of:');
    console.log('   npm install sharp');
    console.log('   brew install imagemagick (macOS)');
    console.log('   sudo apt-get install imagemagick (Ubuntu)');
  }
};

const generateWithSharp = async (iconsDir) => {
  const sharp = require('sharp');
  const svgPath = path.join(iconsDir, 'icon.svg');

  if (!fs.existsSync(svgPath)) {
    throw new Error('icon.svg not found in icons directory');
  }

  for (const size of iconSizes) {
    const outputPath = path.join(iconsDir, `icon-${size}x${size}.png`);

    await sharp(svgPath)
      .resize(size, size)
      .png()
      .toFile(outputPath);

    console.log(`  ✅ Generated ${size}x${size} icon`);
  }
};

const generateWithImageMagick = async (iconsDir) => {
  const { execSync } = require('child_process');
  const svgPath = path.join(iconsDir, 'icon.svg');

  if (!fs.existsSync(svgPath)) {
    throw new Error('icon.svg not found in icons directory');
  }

  for (const size of iconSizes) {
    const outputPath = path.join(iconsDir, `icon-${size}x${size}.png`);

    try {
      execSync(`convert "${svgPath}" -resize ${size}x${size} "${outputPath}"`, { stdio: 'ignore' });
      console.log(`  ✅ Generated ${size}x${size} icon`);
    } catch (error) {
      console.error(`  ❌ Failed to generate ${size}x${size} icon:`, error.message);
    }
  }
};

const generateSVGFallbacks = async (iconsDir) => {
  const svgTemplate = fs.readFileSync(path.join(iconsDir, 'icon.svg'), 'utf8');

  for (const size of iconSizes) {
    const outputPath = path.join(iconsDir, `icon-${size}x${size}.svg`);

    // Update SVG with correct dimensions
    const sizedSvg = svgTemplate
      .replace(/width="[^"]*"/, `width="${size}"`)
      .replace(/height="[^"]*"/, `height="${size}"`);

    fs.writeFileSync(outputPath, sizedSvg);
    console.log(`  📝 Generated ${size}x${size} SVG fallback`);
  }

  // Also create a simple PNG using a different approach if possible
  console.log('  🔄 Attempting to create minimal PNG icons...');
  await createMinimalPNGs(iconsDir);
};

const createMinimalPNGs = async (iconsDir) => {
  // Create minimal valid PNG files
  // This is a very basic approach for testing
  for (const size of iconSizes) {
    const outputPath = path.join(iconsDir, `icon-${size}x${size}.png`);

    try {
      // Use a minimal PNG library or create via canvas if available
      if (typeof require !== 'undefined') {
        try {
          const { createCanvas } = require('canvas');
          const canvas = createCanvas(size, size);
          const ctx = canvas.getContext('2d');

          // Draw a simple colored square with "M" letter
          ctx.fillStyle = '#5E81AC';
          ctx.fillRect(0, 0, size, size);

          ctx.fillStyle = 'white';
          ctx.font = `${Math.floor(size/2)}px Arial`;
          ctx.textAlign = 'center';
          ctx.fillText('M', size/2, size/2 + Math.floor(size/8));

          const buffer = canvas.toBuffer('image/png');
          fs.writeFileSync(outputPath, buffer);
          console.log(`  ✅ Generated ${size}x${size} PNG with canvas`);
        } catch (canvasError) {
          // Canvas not available, skip PNG generation
          console.log(`  ⚠️  Canvas not available for ${size}x${size}`);
        }
      }
    } catch (error) {
      console.log(`  ⚠️  Could not generate PNG for ${size}x${size}`);
    }
  }
};

// Main execution
if (require.main === module) {
  generateIcons()
    .then(() => {
      console.log('✨ Icon generation complete!');
      console.log('');
      console.log('📋 Next steps:');
      console.log('1. Verify icons are properly sized in icons/ directory');
      console.log('2. Test PWA installation in browser');
      console.log('3. Check browser dev tools → Application → Manifest');
    })
    .catch(error => {
      console.error('❌ Icon generation failed:', error.message);
      process.exit(1);
    });
}

module.exports = { generateIcons };