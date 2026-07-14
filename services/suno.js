/**
 * Integração com Suno via apiframe.ai v2
 * Base URL: https://api.apiframe.ai/v2
 * Auth:     x-api-key header
 *
 * Fluxo:
 *   POST /music/generate → { jobId, status: "QUEUED" }
 *   GET  /jobs/{jobId}   → { status, progress, result: { tracks[] } }
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
 * Reexecuta `fn` em caso de falha transiente da apiframe.ai (403/429/5xx ou
 * timeout/rede) -- evita que um cliente que já pagou fique travado com
 * "erro, contate o suporte" por causa de uma instabilidade momentânea da API.
 * Erros 4xx "normais" (400 = requisição inválida) não são reexecutados.
 */
async function withRetry(fn, { retries = 3, baseDelayMs = 4000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err.response?.status;
      const retryable = !status || status === 403 || status === 429 || status >= 500;
      if (!retryable || attempt === retries) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt);
      console.warn(`[suno] Tentativa ${attempt + 1}/${retries + 1} falhou (status ${status || 'sem resposta'}) — tentando de novo em ${delay}ms`);
      await sleepMs(delay);
    }
  }
  throw lastErr;
}

// Mapa de gêneros musicais → instrução de estilo no prompt
const GENRE_INSTRUCTIONS = {
  sertanejo: 'estilo sertanejo romântico brasileiro, violão, sanfona, dupla vocal, refrão cantável',
  pop: 'estilo pop brasileiro moderno, produção contemporânea, melodia grudenta e refrão forte',
  mpb: 'estilo MPB (Música Popular Brasileira), arranjo sofisticado com piano e violão, poesia na letra',
  romantico: 'balada romântica, piano suave, cordas de orquestra, voz emocionante e refrão marcante',
  pagode: 'estilo pagode romântico brasileiro, cavaquinho, tamborim, suave e envolvente',
  gospel: 'estilo gospel cristão contemporâneo brasileiro, piano, coro de louvor, letra de gratidão e amor',
};

const RELACAO_MAP = {
  namorado: 'namorado(a)',
  esposo: 'esposo(a)',
  mae: 'mãe',
  pai: 'pai',
  filho: 'filho(a)',
  amigo: 'melhor amigo(a)',
  avo: 'avó ou avô',
  irmao: 'irmão(ã)',
};

/**
 * Constrói o prompt criativo para o Suno (limite ~500 chars para evitar erro 400)
 */
function buildPrompt({ nomeDestinatario, relacao, memoria, genero, voz }) {
  const relacaoTexto = RELACAO_MAP[relacao] || relacao;
  const estiloMusical = GENRE_INSTRUCTIONS[genero] || GENRE_INSTRUCTIONS.romantico;
  const vozTexto = voz === 'masculino' ? 'voz masculina' : 'voz feminina';

  // Trunca a memória para garantir que o prompt total fique abaixo de 500 chars
  const memoriaCorta = memoria.length > 150 ? memoria.slice(0, 147) + '...' : memoria;

  return `Musica romantica em portugues do Brasil, ${estiloMusical}, ${vozTexto}. Dedicada para ${nomeDestinatario}, meu(minha) ${relacaoTexto}. Memória especial: "${memoriaCorta}". Letra em PT-BR, citar o nome ${nomeDestinatario}, refrao marcante e emocionante.`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Inicia geração e retorna jobId IMEDIATAMENTE (sem polling).
 * Use para preview — frontend faz polling via /preview-status/:jobId
 */
async function startGeneration(formData) {
  if (!process.env.APIFRAME_API_KEY) {
    throw new Error('APIFRAME_API_KEY não configurada');
  }
  const prompt = buildPrompt(formData);
  const initRes = await withRetry(() => axios.post(
    `${BASE}/music/generate`,
    { model: 'suno', prompt },
    { headers: headers(), timeout: 15000 }
  ));
  const { jobId } = initRes.data;
  if (!jobId) throw new Error('apiframe.ai não retornou jobId');
  console.log(`[suno] Job iniciado: ${jobId}`);
  return jobId;
}

/**
 * Verifica status de um job — UMA chamada só, sem bloquear.
 * Retorna: { status: 'COMPLETED'|'PROCESSING'|'FAILED', audioUrl?, error? }
 */
async function checkJobStatus(jobId) {
  const res = await axios.get(
    `${BASE}/jobs/${jobId}`,
    { headers: headers(), timeout: 10000 }
  );
  const { status, result, error, progress } = res.data;

  if (status === 'COMPLETED') {
    const tracks = result?.tracks;
    if (!tracks?.length) throw new Error('Geração completou mas sem tracks');
    return {
      status: 'COMPLETED',
      audioUrl: tracks[0].audioUrl,
      lyrics: tracks[0].lyric || tracks[0].lyrics || null,
    };
  }
  if (status === 'FAILED' || status === 'ERROR') {
    return { status: 'FAILED', error: error || 'motivo desconhecido' };
  }
  return { status: status || 'PROCESSING', progress: progress || 0 };
}

/**
 * Geração bloqueante com polling — usada apenas em generate-full (pós-compra, background)
 */
async function generateMusic(formData, maxSeconds = 360) {
  const jobId = await startGeneration(formData);
  const start = Date.now();
  let delay = 8000;

  while ((Date.now() - start) / 1000 < maxSeconds) {
    await sleep(delay);
    delay = Math.min(delay * 1.2, 15000);

    let result;
    try {
      result = await checkJobStatus(jobId);
    } catch (err) {
      // Falha transiente de rede/API durante o polling -- não desiste,
      // só tenta de novo no próximo ciclo (o timeout geral ainda se aplica).
      console.warn(`[suno] Erro ao consultar status do job ${jobId}, tentando de novo:`, err.message);
      continue;
    }
    if (result.status === 'COMPLETED') return { audioUrl: result.audioUrl, lyrics: result.lyrics || null, jobId };
    if (result.status === 'FAILED') throw new Error(`Geração falhou: ${result.error}`);
  }
  throw new Error(`Timeout: geração não completou em ${maxSeconds}s`);
}

async function generatePreview(formData) {
  return generateMusic(formData, 180);
}

async function generateFull(formData) {
  return generateMusic(formData, 360);
}

module.exports = { generatePreview, generateFull, startGeneration, checkJobStatus };
