/**
 * Geração de vídeo com letra animada via Creatomate API
 * Docs: https://creatomate.com/docs/api/rest-api/creating-renders
 *
 * Fluxo:
 *   POST /v1/renders → { id, status: 'planned'|'rendering'|'succeeded'|'failed', url }
 *   GET  /v1/renders/:id → polling até 'succeeded'
 */

const axios = require('axios');

const BASE = 'https://api.creatomate.com/v1';

function headers() {
  return {
    Authorization: `Bearer ${process.env.CREATOMATE_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Constrói a composição do vídeo (1080×1920 — Stories/Reels)
 * Background escuro com gradiente pink, título, letra e áudio.
 */
function buildComposition({ audioUrl, nomeDestinatario, lyrics }) {
  // Remove tags tipo [Verse], [Chorus] e limita tamanho
  const lyricsClean = lyrics
    ? lyrics.replace(/\[.*?\]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 700)
    : `Uma música especial\nfeita só pra você\n\n♪ ♪ ♪`;

  return {
    output_format: 'mp4',
    width: 1080,
    height: 1920,
    frame_rate: 30,
    elements: [
      // Fundo escuro
      {
        type: 'shape',
        shape: 'rectangle',
        fill_color: '#0D0D1A',
        width: '100%',
        height: '100%',
        x: '50%',
        y: '50%',
        x_anchor: '50%',
        y_anchor: '50%',
      },
      // Círculo de glow pink atrás do ícone
      {
        type: 'shape',
        shape: 'circle',
        fill_color: 'rgba(233,30,140,0.18)',
        width: '75%',
        height: '35%',
        x: '50%',
        y: '18%',
        x_anchor: '50%',
        y_anchor: '50%',
      },
      // Áudio
      {
        type: 'audio',
        src: audioUrl,
        volume: 1,
      },
      // Emoji musical
      {
        type: 'text',
        text: '🎵',
        font_size: 120,
        x: '50%',
        y: '10%',
        x_anchor: '50%',
        y_anchor: '50%',
        animations: [
          { type: 'scale', start_scale: '0%', fade: true, duration: 0.9, easing: 'ease-out' }
        ],
      },
      // "Para [Nome]"
      {
        type: 'text',
        text: `Para ${nomeDestinatario}`,
        font_size: 60,
        fill_color: '#E91E8C',
        font_weight: '700',
        font_family: 'Montserrat',
        x: '50%',
        y: '21%',
        x_anchor: '50%',
        y_anchor: '50%',
        width: '84%',
        x_alignment: 'center',
        animations: [
          { type: 'slide', direction: 'down', fade: true, duration: 0.8, start_time: 0.3, easing: 'ease-out' }
        ],
      },
      // Linha divisória
      {
        type: 'shape',
        shape: 'rectangle',
        fill_color: '#E91E8C',
        width: '38%',
        height: 3,
        x: '50%',
        y: '27%',
        x_anchor: '50%',
        y_anchor: '50%',
        animations: [
          { type: 'wipe', direction: 'right', duration: 0.6, start_time: 0.9 }
        ],
      },
      // Letra da música
      {
        type: 'text',
        text: lyricsClean,
        font_size: 32,
        fill_color: '#FFFFFF',
        font_family: 'Montserrat',
        x: '50%',
        y: '57%',
        x_anchor: '50%',
        y_anchor: '50%',
        width: '82%',
        x_alignment: 'center',
        line_height: 1.65,
        animations: [
          { type: 'fade', start_time: 1.2, duration: 1.2 }
        ],
      },
      // Marca no rodapé
      {
        type: 'text',
        text: '🎵 SuaMúsicaAI',
        font_size: 28,
        fill_color: 'rgba(255,255,255,0.30)',
        font_family: 'Montserrat',
        x: '50%',
        y: '93%',
        x_anchor: '50%',
        y_anchor: '50%',
        x_alignment: 'center',
      },
    ],
  };
}

/**
 * Dispara o render no Creatomate e retorna o renderId.
 */
async function startVideoRender({ audioUrl, nomeDestinatario, lyrics }) {
  if (!process.env.CREATOMATE_API_KEY) {
    throw new Error('CREATOMATE_API_KEY não configurada');
  }

  const composition = buildComposition({ audioUrl, nomeDestinatario, lyrics });

  const res = await axios.post(
    `${BASE}/renders`,
    { source: JSON.stringify(composition) },
    { headers: headers(), timeout: 20000 }
  );

  // A API retorna array
  const render = Array.isArray(res.data) ? res.data[0] : res.data;
  const renderId = render?.id;
  if (!renderId) throw new Error('Creatomate não retornou render ID');

  console.log(`[video] Render iniciado: ${renderId} | status: ${render.status}`);
  return renderId;
}

/**
 * Verifica status de um render — uma chamada, sem bloquear.
 */
async function checkRenderStatus(renderId) {
  const res = await axios.get(
    `${BASE}/renders/${renderId}`,
    { headers: headers(), timeout: 10000 }
  );
  const { status, url, error_message } = res.data;

  if (status === 'succeeded') return { status: 'COMPLETED', videoUrl: url };
  if (status === 'failed') return { status: 'FAILED', error: error_message || 'falha no render' };
  return { status: 'PROCESSING' };
}

/**
 * Gera o vídeo com letra e aguarda o render completar.
 * maxSeconds = 300 (5 min) por padrão.
 */
async function generateVideo({ audioUrl, nomeDestinatario, lyrics }, maxSeconds = 300) {
  const renderId = await startVideoRender({ audioUrl, nomeDestinatario, lyrics });
  const start = Date.now();
  let delay = 8000;

  while ((Date.now() - start) / 1000 < maxSeconds) {
    await sleep(delay);
    delay = Math.min(delay * 1.4, 20000);

    const result = await checkRenderStatus(renderId);
    if (result.status === 'COMPLETED') {
      console.log(`[video] Render ${renderId} concluído: ${result.videoUrl}`);
      return { videoUrl: result.videoUrl };
    }
    if (result.status === 'FAILED') {
      throw new Error(`Render de vídeo falhou: ${result.error}`);
    }
    console.log(`[video] Render ${renderId} ainda processando...`);
  }

  throw new Error('Timeout: render de vídeo não completou em 5 minutos');
}

module.exports = { generateVideo };
