/**
 * Rotas de geração de música via Suno API (apiframe.ai)
 */

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { startGeneration, checkJobStatus, generateFull } = require('../services/suno');
const emailService = require('../services/email');
const { trimToFile } = require('../services/trim');

const router = express.Router();
const DOWNLOADS_DIR = path.join(__dirname, '..', 'downloads');

// ─── POST /api/generate-preview ───
// Retorna jobId IMEDIATAMENTE (não bloqueia).
// Frontend faz polling em GET /preview-status/:jobId
router.post('/generate-preview', async (req, res) => {
  const { nomeDestinatario, relacao, memoria, genero, voz, emailEntrega } = req.body;

  if (!nomeDestinatario || !relacao || !memoria || !genero) {
    return res.status(400).json({ error: 'Preencha todos os campos obrigatórios.' });
  }
  if (memoria.length < 20) {
    return res.status(400).json({ error: 'Conte um pouco mais sobre a memória especial (mínimo 20 caracteres).' });
  }

  const orderId = crypto.randomUUID();

  try {
    const jobId = await startGeneration({ nomeDestinatario, relacao, memoria, genero, voz });

    // Salva estado pendente com jobId
    global.pendingOrders.set(orderId, {
      orderId,
      jobId,
      formData: { nomeDestinatario, relacao, memoria, genero, voz, emailEntrega },
      emailEntrega: emailEntrega || undefined,
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
      order.lyrics = result.lyrics || null; // guarda letra para vídeo posterior
      order.rawPreviewUrl = result.audioUrl; // NUNCA enviar ao navegador — só uso interno

      // Corta a música em 40s no servidor. A URL completa do Suno jamais
      // chega ao navegador — sem isso, qualquer um baixava a música inteira
      // de graça direto do <audio src> ou da aba Network do navegador.
      const previewPath = path.join(DOWNLOADS_DIR, `preview-${orderId}.mp3`);
      try {
        await trimToFile(result.audioUrl, previewPath, 40);
      } catch (trimErr) {
        console.error(`[preview-status] Falha ao cortar preview de ${orderId}:`, trimErr.message);
        order.status = 'error';
        return res.json({ status: 'error', message: 'Erro ao preparar o preview. Tente novamente.' });
      }

      order.previewFilePath = previewPath;
      order.previewUrl = `/api/preview-audio/${orderId}`;
      order.status = 'preview_ready';
      console.log(`[preview-status] Job ${jobId} pronto (preview cortado 40s) → orderId ${orderId}`);
      return res.json({ status: 'ready', previewUrl: order.previewUrl, orderId });
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

// ─── GET /api/preview-audio/:orderId ───
// Serve o preview JÁ CORTADO EM 40s. É a única URL de áudio que o navegador
// recebe antes da compra — a URL completa (order.rawPreviewUrl) nunca sai do servidor.
router.get('/preview-audio/:orderId', (req, res) => {
  const order = global.pendingOrders.get(req.params.orderId);
  if (!order?.previewFilePath || !fs.existsSync(order.previewFilePath)) {
    return res.status(404).json({ error: 'Preview não encontrado.' });
  }
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(order.previewFilePath).pipe(res);
});

// ─── POST /api/generate-full (chamado após webhook de pagamento confirmado do MP3) ───
// Nota: a compra do produto "Vídeo com Homenagem" NÃO passa mais por aqui --
// é tratada por handleVideoPurchase() em routes/webhook.js, que gera a música
// e entrega os dados pro serviço separado "Vídeo Homenagem" montar o vídeo real.
router.post('/generate-full', async (req, res) => {
  const { orderId } = req.body;

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
  if (emailForDelivery) order.emailEntrega = emailForDelivery; // persiste para delivery-status

  try {
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

  } catch (err) {
    console.error('Erro ao gerar música completa:', err.message);
    order.status = 'error';
    return res.status(500).json({ error: 'Erro ao gerar música completa.' });
  }
});

module.exports = router;
