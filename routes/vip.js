/**
 * Geração ilimitada para membros VIP (assinatura anual).
 *   GET  /api/vip/status?email=       -> checa se o email tem VIP ativo
 *   POST /api/vip/generate            -> gera música completa sem cobrar
 *                                         (só funciona se checkVipStatus = true)
 */

const express = require('express');
const crypto = require('crypto');
const db = require('../services/db');
const { generateFull } = require('../services/suno');
const emailService = require('../services/email');

const router = express.Router();

// ─── GET /api/vip/status ───
router.get('/status', async (req, res) => {
  const email = (req.query.email || '').toLowerCase().trim();
  if (!email) return res.status(400).json({ error: 'Email obrigatório.' });
  try {
    const { isVip, vipUntil } = await db.checkVipStatus(email);
    res.json({ email, isVip, vipUntil });
  } catch (err) {
    console.error('[vip/status] Erro:', err.message);
    res.status(500).json({ error: 'Erro ao consultar status VIP.' });
  }
});

// ─── POST /api/vip/generate ───
// Body: { email, nomeDestinatario, relacao, memoria, genero, voz }
router.post('/generate', async (req, res) => {
  const { email, nomeDestinatario, relacao, memoria, genero, voz } = req.body;
  const normalizedEmail = (email || '').toLowerCase().trim();

  if (!normalizedEmail || !nomeDestinatario || !relacao || !memoria || !genero) {
    return res.status(400).json({ error: 'Preencha todos os campos obrigatórios.' });
  }

  const { isVip } = await db.checkVipStatus(normalizedEmail).catch(() => ({ isVip: false }));
  if (!isVip) {
    return res.status(402).json({ error: 'Este email não tem acesso VIP ativo.' });
  }

  const orderId = crypto.randomUUID();
  const formData = { nomeDestinatario, relacao, memoria, genero, voz };

  const pendingOrder = {
    orderId,
    formData: { ...formData, emailEntrega: normalizedEmail },
    emailEntrega: normalizedEmail,
    status: 'generating_full',
    createdAt: new Date(),
    source: 'vip',
  };
  global.pendingOrders.set(orderId, pendingOrder);
  db.saveOrder(pendingOrder);

  res.json({ success: true, orderId, message: 'Música em produção. Isso leva de 3 a 5 minutos.' });

  // Continua em background -- cliente faz polling em /api/order-status/:orderId
  let audioUrl, token;
  try {
    ({ audioUrl } = await generateFull(formData));
    token = crypto.randomBytes(32).toString('hex');
    global.downloadTokens.set(token, { orderId, audioUrl, expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000) });

    const order = global.pendingOrders.get(orderId);
    order.status = 'complete';
    order.downloadToken = token;
    order.fullAudioUrl = audioUrl;
    db.saveOrder(order);
  } catch (err) {
    console.error(`[vip/generate] Erro ao gerar música (orderId ${orderId}):`, err.message);
    const order = global.pendingOrders.get(orderId);
    if (order) { order.status = 'error'; db.saveOrder(order); }
    return;
  }

  try {
    await emailService.sendDownloadEmail({
      to: normalizedEmail,
      nomeDestinatario,
      downloadUrl: `${process.env.APP_URL}/api/download/${token}`,
      audioUrl,
      downloadToken: token,
    });
    console.log(`[vip/generate] Música gerada e email enviado para ${normalizedEmail} (orderId ${orderId})`);
  } catch (emailErr) {
    console.error(`[vip/generate] Música pronta (orderId ${orderId}) mas falha ao enviar email:`, emailErr.message);
  }
});

module.exports = router;
