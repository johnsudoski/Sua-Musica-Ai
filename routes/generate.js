/**
 * Rotas de geração de música via Suno API (apiframe.ai)
 */

const express = require('express');
const crypto = require('crypto');
const { startGeneration, checkJobStatus, generateFull } = require('../services/suno');
const emailService = require('../services/email');
const { generateVideo } = require('../services/video');

const router = express.Router();

// ─── POST /api/generate-preview ───
// Retorna jobId IMEDIATAMENTE (não bloqueia).
// Frontend faz polling em GET /preview-status/:jobId
router.post('/generate-preview', async (req, res) => {
  const { nomeDestinatario, relacao, memoria, genero } = req.body;

  if (!nomeDestinatario || !relacao || !memoria || !genero) {
    return res.status(400).json({ error: 'Preencha todos os campos obrigatórios.' });
  }
  if (memoria.length < 20) {
    return res.status(400).json({ error: 'Conte um pouco mais sobre a memória especial (mínimo 20 caracteres).' });
  }

  const orderId = crypto.randomUUID();

  try {
    const jobId = await startGeneration({ nomeDestinatario, relacao, memoria, genero });

    // Salva estado pendente com jobId
    global.pendingOrders.set(orderId, {
      orderId,
      jobId,
      formData: { nomeDestinatario, relacao, memoria, genero },
      status: 'generating_preview',
      createdAt: new Date(),
    });

    // Índice reverso jobId → orderId para o endpoint de polling
    global.jobToOrder = global.jobToOrder || new Map();
    global.jobToOrder.set(jobId, orderId);

    return res.json({ success: true, jobId, orderId });

  } catch (err) {
    console.error('Erro ao iniciar preview:', err.message);
    return res.status(500).json({
      error: 'Não conseguimos iniciar a geração. Tente novamente em instantes.',
    });
  }
});

// ─── GET /api/preview-status/:jobId ───
// Chamado pelo frontend a cada ~5 segundos.
// Retorna: { status: 'generating'|'ready'|'error', previewUrl?, orderId? }
router.get('/preview-status/:jobId', async (req, res) => {
  const { jobId } = req.params;

  global.jobToOrder = global.jobToOrder || new Map();
  const orderId = global.jobToOrder.get(jobId);
  if (!orderId) return res.status(404).json({ error: 'Job não encontrado.' });

  const order = global.pendingOrders.get(orderId);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });

  // Já estava pronto (polling repetido)
  if (order.status === 'preview_ready' && order.previewUrl) {
    return res.json({ status: 'ready', previewUrl: order.previewUrl, orderId });
  }

  // Erro registrado anteriormente
  if (order.status === 'error') {
    return res.json({ status: 'error', message: 'Geração falhou. Tente novamente.' });
  }

  try {
    const result = await checkJobStatus(jobId);

    if (result.status === 'COMPLETED') {
      order.previewUrl = result.audioUrl;
      order.lyrics = result.lyrics || null; // guarda letra para vídeo posterior
      order.status = 'preview_ready';
      console.log(`[preview-status] Job ${jobId} pronto → orderId ${orderId}`);
      return res.json({ status: 'ready', previewUrl: result.audioUrl, orderId });
    }

    if (result.status === 'FAILED') {
      order.status = 'error';
      console.error(`[preview-status] Job ${jobId} falhou:`, result.error);
      return res.json({ status: 'error', message: result.error });
    }

    // Ainda gerando — reporta progresso
    return res.json({ status: 'generating', progress: result.progress || 0 });

  } catch (err) {
    console.error('[preview-status] Erro ao verificar job:', err.message);
    return res.status(500).json({ error: 'Erro ao verificar status.' });
  }
});

// ─── POST /api/generate-full (chamado após webhook de pagamento confirmado) ───
router.post('/generate-full', async (req, res) => {
  const { orderId, productType = 'mp3' } = req.body;

  const order = global.pendingOrders.get(orderId);
  if (!order) {
    return res.status(404).json({ error: 'Pedido não encontrado.' });
  }

  if (order.status === 'complete') {
    return res.json({ success: true, message: 'Música já gerada.', downloadToken: order.downloadToken });
  }

  order.status = 'generating_full';

  // Email: prioriza o do webhook Ticto (comprador); fallback para formulário
  const { emailEntrega: emailFromWebhook } = req.body;
  const emailForDelivery = emailFromWebhook || order.formData?.emailEntrega;

  try {
    if (productType === 'video') {
      // ── VÍDEO COM LETRA: gera música full + vídeo animado Creatomate ──
      console.log(`[generate-full] Gerando MP3 + VÍDEO para ${orderId}`);

      const { audioUrl, lyrics: newLyrics } = await generateFull(order.formData);
      const lyrics = order.lyrics || newLyrics; // prefere letra capturada no preview

      console.log(`[generate-full] Gerando vídeo com Creatomate para ${orderId}...`);
      const { videoUrl } = await generateVideo({
        audioUrl,
        nomeDestinatario: order.formData.nomeDestinatario,
        lyrics,
      });

      const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

      const mp3Token = crypto.randomBytes(32).toString('hex');
      global.downloadTokens.set(mp3Token, { orderId, audioUrl, expiresAt });

      const videoToken = crypto.randomBytes(32).toString('hex');
      global.downloadTokens.set(videoToken, { orderId, videoUrl, expiresAt, isVideo: true });

      order.status        = 'complete';
      order.downloadToken = mp3Token;
      order.videoToken    = videoToken;
      order.fullAudioUrl  = audioUrl;
      order.fullVideoUrl  = videoUrl;

      if (emailForDelivery) {
        await emailService.sendVideoEmail({
          to: emailForDelivery,
          nomeDestinatario: order.formData.nomeDestinatario,
          mp3DownloadUrl:   `${process.env.APP_URL}/api/download/${mp3Token}`,
          videoDownloadUrl: `${process.env.APP_URL}/api/download/${videoToken}`,
        });
      } else {
        console.warn(`generate-full [video]: sem email para ${orderId}`);
      }

      return res.json({ success: true, downloadToken: mp3Token, videoToken, message: 'MP3 + vídeo gerados e email enviado!' });

    } else {
      // ── MP3 SIMPLES: gera 1 música ──
      const { audioUrl } = await generateFull(order.formData);

      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
      global.downloadTokens.set(token, { orderId, audioUrl, expiresAt });

      order.status        = 'complete';
      order.downloadToken = token;
      order.fullAudioUrl  = audioUrl;

      if (emailForDelivery) {
        await emailService.sendDownloadEmail({
          to: emailForDelivery,
          nomeDestinatario: order.formData.nomeDestinatario,
          downloadUrl: `${process.env.APP_URL}/api/download/${token}`,
          audioUrl,
        });
      } else {
        console.warn(`generate-full: orderId ${orderId} sem email para entrega — pulando envio`);
      }

      return res.json({ success: true, downloadToken: token, message: 'Música completa gerada e email enviado!' });
    }

  } catch (err) {
    console.error('Erro ao gerar música completa:', err.message);
    order.status = 'error';
    return res.status(500).json({ error: 'Erro ao gerar música completa.' });
  }
});

module.exports = router;
