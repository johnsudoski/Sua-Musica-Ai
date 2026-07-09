/**
 * Rotas de geração de música via Suno API (apiframe.ai)
 */

const express = require('express');
const crypto = require('crypto');
const { startGeneration, checkJobStatus, generateFull } = require('../services/suno');
const emailService = require('../services/email');

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
    if (productType === '3musicas') {
      // ── PACOTE 3 MÚSICAS: gera 3 músicas em paralelo ──
      console.log(`[generate-full] Gerando PACOTE 3 MÚSICAS para ${orderId}`);

      const [r1, r2, r3] = await Promise.all([
        generateFull(order.formData),
        generateFull(order.formData),
        generateFull(order.formData),
      ]);

      // Cria 3 tokens de download (48h)
      const tokens = [r1, r2, r3].map(({ audioUrl }) => {
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
        global.downloadTokens.set(token, { orderId, audioUrl, expiresAt });
        return { token, audioUrl };
      });

      order.status       = 'complete';
      order.downloadToken = tokens[0].token; // token principal (compatibilidade)
      order.pack3Tokens   = tokens.map(t => t.token);
      order.fullAudioUrl  = tokens[0].audioUrl;

      if (emailForDelivery) {
        const downloadUrls = tokens.map(
          t => `${process.env.APP_URL}/api/download/${t.token}`
        );
        await emailService.sendPack3Email({
          to: emailForDelivery,
          nomeDestinatario: order.formData.nomeDestinatario,
          downloadUrls,
        });
      } else {
        console.warn(`generate-full [3musicas]: sem email para ${orderId}`);
      }

      return res.json({ success: true, downloadTokens: tokens.map(t => t.token), message: 'Pacote 3 músicas gerado e email enviado!' });

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
