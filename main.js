#!/usr/bin/env node

//const fsnp = require('fs');
const { Readable } = require('stream');
const inky = require('@aeroniemi/inky')
const sharp = require('sharp');
const fs = require('fs').promises;
const path = require('path');
const { program } = require('commander');

// Inky Impression 7.3" specifications
const frame = new inky.Impression73()
const TARGET_WIDTH = 800;
const TARGET_HEIGHT = 480;

// Optimal 7-color palette for Inky Impression (ACeP - Advanced Color ePaper)
// RGB values for the e-ink display colors
const EINK_PALETTE = [
    [0, 0, 0],       // Black
    [255, 255, 255], // White
    [255, 0, 0],     // Red
    [0, 255, 0],     // Green
    [0, 0, 255],     // Blue
    [255, 255, 0],   // Yellow
    [255, 128, 0],   // Orange
];

// Convert RGB to hex for display
const rgbToHex = (rgb) => {
    return '#' + rgb.map(c => c.toString(16).padStart(2, '0')).join('');
};

// Calculate color distance (Euclidean distance in RGB space)
function colorDistance(rgb1, rgb2) {
    return Math.sqrt(
        Math.pow(rgb1[0] - rgb2[0], 2) +
        Math.pow(rgb1[1] - rgb2[1], 2) +
        Math.pow(rgb1[2] - rgb2[2], 2)
    );
}

// Find closest color in palette
function findClosestColor(rgb, palette) {
    let minDistance = Infinity;
    let closestColor = palette[0];
    
    for (const paletteColor of palette) {
        const distance = colorDistance(rgb, paletteColor);
        if (distance < minDistance) {
            minDistance = distance;
            closestColor = paletteColor;
        }
    }
    
    return closestColor;
}

// Apply Floyd-Steinberg dithering
function applyFloydSteinbergDithering(imageData, width, height, palette) {
    const data = new Uint8ClampedArray(imageData);
    
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 3;
            
            const oldPixel = [data[idx], data[idx + 1], data[idx + 2]];
            const newPixel = findClosestColor(oldPixel, palette);
            
            data[idx] = newPixel[0];
            data[idx + 1] = newPixel[1];
            data[idx + 2] = newPixel[2];
            
            const error = [
                oldPixel[0] - newPixel[0],
                oldPixel[1] - newPixel[1],
                oldPixel[2] - newPixel[2]
            ];
            
            // Distribute error to neighboring pixels
            const distributeError = (dx, dy, factor) => {
                if (x + dx >= 0 && x + dx < width && y + dy >= 0 && y + dy < height) {
                    const neighborIdx = ((y + dy) * width + (x + dx)) * 3;
                    data[neighborIdx] = Math.max(0, Math.min(255, data[neighborIdx] + error[0] * factor));
                    data[neighborIdx + 1] = Math.max(0, Math.min(255, data[neighborIdx + 1] + error[1] * factor));
                    data[neighborIdx + 2] = Math.max(0, Math.min(255, data[neighborIdx + 2] + error[2] * factor));
                }
            };
            
            distributeError(1, 0, 7/16);  // Right
            distributeError(-1, 1, 3/16); // Bottom-left
            distributeError(0, 1, 5/16);  // Bottom
            distributeError(1, 1, 1/16);  // Bottom-right
        }
    }
    
    return Buffer.from(data);
}

// Simple color quantization without dithering
function quantizeToEinkPalette(imageData, width, height, palette) {
    const data = new Uint8ClampedArray(imageData);
    
    for (let i = 0; i < data.length; i += 3) {
        const oldPixel = [data[i], data[i + 1], data[i + 2]];
        const newPixel = findClosestColor(oldPixel, palette);
        
        data[i] = newPixel[0];
        data[i + 1] = newPixel[1];
        data[i + 2] = newPixel[2];
    }
    
    return Buffer.from(data);
}

async function processImage(buf, options) {
    try {
        
        const image = sharp(buf);
        const metadata = await image.metadata();
        console.log(metadata);
        console.log(`Original size: ${metadata.width}x${metadata.height}`);
        
        // Calculate resize dimensions maintaining aspect ratio
        const scaleW    = TARGET_WIDTH / metadata.width;
        const scaleH    = TARGET_HEIGHT / metadata.height;
        const scale     = Math.min(scaleW, scaleH);
        
        // Calculate position to center the resized image
        const newWidth  = Math.round(metadata.width * scale);
        const newHeight = Math.round(metadata.height * scale);
        const left      = Math.round((TARGET_WIDTH - newWidth) / 2);
        const top       = Math.round((TARGET_HEIGHT - newHeight) / 2);
        
        console.log(`Scaled size: ${newWidth}x${newHeight}`);
        
        // Create a white canvas with target dimensions
        const canvas = sharp({
            create: {
                width: TARGET_WIDTH,
                height: TARGET_HEIGHT,
                channels: 3,
                background: { r: 255, g: 255, b: 255 }
            }
        }).removeAlpha(); // removeAlpha required here - channels:3 isn't honoured!!

        // Resize the input image
        const resizedImageBuf = await image
              .resize(newWidth, newHeight, {
                  kernel: sharp.kernel.lanczos3,
                  fit: 'inside'
              })
	      .toBuffer();
	console.log(`Resized. Compositing...`);
        
        // Composite the resized image onto the canvas
        let processedImage = await canvas
            .composite([{
                input: resizedImageBuf,
                left: left,
                top: top
            }])
	    .raw()
	    .toBuffer();
        
        console.log('Mapping to e-ink palette...');

        // Apply color mapping and optional dithering
        console.log('Applying Floyd-Steinberg dithering...');
        processedImage = applyFloydSteinbergDithering(
            await processedImage,
            TARGET_WIDTH, 
            TARGET_HEIGHT, 
            EINK_PALETTE
        );
                
        // Convert back to image and apply post-processing
        const finalImage = sharp(processedImage, {
            raw: {
                width: TARGET_WIDTH,
                height: TARGET_HEIGHT,
                channels: 3
            }
        });
        
        // Enhance contrast for e-ink display
        await finalImage
            .normalize()
            .toFile('output.png', (err, info) => {
		frame.display_png('output.png')
		frame.show()
		fs.unlink('output.png')
	    });
        
        console.log(`Final size: ${TARGET_WIDTH}x${TARGET_HEIGHT}`);
        
        // Show palette info if requested
        if (options.preview) {
            console.log('\nE-ink palette colors used:');
            EINK_PALETTE.forEach((color, index) => {
                console.log(`  ${index + 1}: ${rgbToHex(color)} (RGB: ${color.join(', ')})`);
            });
        }
        
    } catch (error) {
        throw new Error(`Processing failed: ${error.message}`);
    }
}

// Set up command line interface
program
    .name('inky-processor')
    .description('Prepare JPG images for Inky Impression 7.3" e-ink display')
    .version('1.0.0')
    .option('-q, --quality <number>', 'Output JPEG quality (1-100)', '85')
    .option('-p, --preview', 'Show palette preview information')
    .helpOption('-h, --help', 'Show help information')
    .addHelpText('after', `
Examples:
  $ node inky-processor.js photo.jpg inky_photo.jpg
  $ node inky-processor.js --quality 90 landscape.jpg display_ready.jpg
  $ node inky-processor.js --preview image.jpg result.jpg

This script prepares images for the Inky Impression 7.3" e-ink display by:
- Resizing to 800x480 pixels (maintaining aspect ratio with letterboxing)
- Converting to optimal 7-color e-ink palette
- Applying optional Floyd-Steinberg dithering for smoother gradients

Requirements:
  npm install sharp commander
`);

program.parse();

const options = program.opts();

// Validate quality parameter
const quality = parseInt(options.quality);
if (isNaN(quality) || quality < 1 || quality > 100) {
    console.error('Error: Quality must be a number between 1 and 100.');
    process.exit(1);
}

fetch('https://picsum.photos/800/480')
    .then(x => x.arrayBuffer())
    .then(x => {
	// Process the image
	processImage(Buffer.from(x), {
	    quality: quality,
	    dither: options.dither || false,
	    preview: options.preview || false
	}).then(() => {
	    console.log('\nImage prepared for Inky Impression 7.3" display!');
	}).catch(error => {
	    console.error(error.message);
	    process.exit(1);
	});
    })
