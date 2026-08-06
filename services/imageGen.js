/**
 * Geração de imagem via apiframe.ai v2 (mesma conta/API key do Suno).
 * Base URL: https://api.apiframe.ai/v2
 * Auth:     x-api-key header
 *
 * Fluxo:
 *   POST /images/generate → { jobId }
 *   GET  /jobs/{jobId}    → { status, result: { images: [url, ...] } }
 */

const axios = require('axios');

const BASE = 'https://api.apiframe.ai/v2';

function headers() {
  return {
    'x-api-key': process.env.APIFRAME_API_KEY,
    'Content-Type': 'application/json',
  };
}

function sleepMs(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

/**
 * Gera uma imagem e aguarda (polling) até completar ou falhar.
 * model default: flux-1.1-pro (bom equilíbrio qualidade/velocidade/custo)
 */
async function generateImage({ prompt, model = 'flux-1.1-pro' }, maxSeconds = 120) {
  if (!process.env.APIFRAME_API_KEY) {
    throw new Error('APIFRAME_API_KEY não configurada');
  }

  const initRes = await axios.post(
    `${BASE}/images/generate`,
    { model, prompt },
    { headers: headers(), timeout: 15000 }
  );
  const { jobId } = initRes.data;
  if (!jobId) throw new Error('apiframe.ai não retornou jobId para imagem');

  const start = Date.now();
  let delay = 4000;

  while ((Date.now() - start) / 1000 < maxSeconds) {
    await sleepMs(delay);
    delay = Math.min(delay * 1.2, 10000);

    const res = await axios.get(`${BASE}/jobs/${jobId}`, { headers: headers(), timeout: 10000 });
    const { status, result, error } = res.data;

    if (status === 'COMPLETED') {
      const images = result?.images;
      if (!images?.length) throw new Error('Job completou mas sem imagens');
      return { imageUrl: images[0], allImages: images, jobId };
    }
    if (status === 'FAILED' || status === 'ERROR') {
      throw new Error(`Geração de imagem falhou: ${error || 'motivo desconhecido'}`);
    }
    // senão, ainda processando -- continua o loop
  }
  throw new Error(`Timeout: geração de imagem não completou em ${maxSeconds}s`);
}

module.exports = { generateImage };
