/**
 * Script único-uso: gera as 8 capas de produto via apiframe.ai e salva em
 * backend/public/covers/. Roda local (não faz parte do fluxo do app).
 *
 *   node scripts/gerar-capas.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { generateImage } = require('../services/imageGen');

const STYLE_BASE = 'Dark background gradient from deep navy-black to soft pink-purple glow, romantic modern aesthetic, cinematic soft lighting, blurred bokeh light particles, premium minimalist digital product cover, no text, no logos, no realistic human faces, square 1:1 aspect ratio, glossy premium finish. ';

const PRODUCTS = [
  {
    file: 'mp3-completo',
    prompt: STYLE_BASE + 'Center composition: a glowing sound waveform curving into the shape of a heart, floating musical notes drifting around it, a subtle pair of headphones resting below.',
  },
  {
    file: 'video-com-letra',
    prompt: STYLE_BASE + 'Center composition: a smartphone screen glowing softly, displaying an abstract animated lyric-video style light trail, a subtle play button icon glowing on the screen, thin film-strip motif framing the edges.',
  },
  {
    file: 'pacote-presente',
    prompt: STYLE_BASE + 'Center composition: an elegantly wrapped gift box with a flowing pink-to-purple gradient ribbon, three glowing musical notes orbiting gently above it like fireflies.',
  },
  {
    file: 'bump-instrumental',
    prompt: STYLE_BASE + 'Center composition: a vintage-style microphone glowing warmly, soft voice ripple waves emanating outward in pink-purple gradient, intimate and warm lighting suggesting a personal recorded message.',
  },
  {
    file: 'bump-12-cartas',
    prompt: STYLE_BASE + 'Center composition: an elegant stack of romantic envelopes and folded letters tied with a ribbon, one envelope sealed with a glowing wax seal, a faint calendar grid pattern subtly visible in the background bokeh.',
  },
  {
    file: 'bump-playlist',
    prompt: STYLE_BASE + 'Center composition: a spinning vinyl record with glowing grooves, surrounded by a loose collage of floating musical notes arranged in a gentle heart-shaped flow, soft headphone silhouette resting nearby.',
  },
  {
    file: 'upsell-album',
    prompt: STYLE_BASE + 'Center composition: a premium vinyl album cover mockup floating at a slight angle, glowing grooves catching pink-purple light, five small glowing musical notes orbiting around it like a constellation, subtle film reel elements at the edges. Slightly more luxurious and elaborate lighting to signal a higher-tier offer.',
  },
  {
    file: 'upsell-vip',
    prompt: STYLE_BASE.replace('cinematic soft lighting', 'dramatic golden and pink-purple light particles') + 'Center composition: an elegant minimalist crown made of glowing light lines in gold and pink-purple gradient, an infinity symbol formed by a continuous flowing ribbon of musical notes beneath it. Premium exclusive VIP aesthetic, the most luxurious and dramatic lighting of the whole set.',
  },
];

const OUT_DIR = path.join(__dirname, '..', 'public', 'covers');

async function downloadImage(url, destPath) {
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
  fs.writeFileSync(destPath, res.data);
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const p of PRODUCTS) {
    process.stdout.write(`Gerando capa: ${p.file}... `);
    try {
      const { imageUrl } = await generateImage({ prompt: p.prompt });
      const destPath = path.join(OUT_DIR, `${p.file}.png`);
      await downloadImage(imageUrl, destPath);
      console.log(`OK -> public/covers/${p.file}.png`);
    } catch (err) {
      console.log(`FALHOU: ${err.message}`);
    }
  }
  console.log('\nConcluído.');
}

main();
