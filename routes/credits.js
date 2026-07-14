/**
 * Créditos do Pacote de 3 Músicas.
 * Consumido pelo serviço externo "Minhas Músicas" (e também disponível
 * diretamente aqui, caso necessário).
 */

const express = require('express');
const crypto = require('crypto');
const db = require('../services/db');
const { generateFull } = require('../services/suno');
const emailService = require('../services/email');

const router = express.Router();

// ─── GET /api/credits/balance?email= ───
router.get('/balance', async (req, res) => {
  const email = (req.query.email || '').toLowerCase().trim();
  if (!email) return res.status(400).json({ error: 'Email obrigatório.' });

  try {
    const balance = await db.getCredits(email);
    res.json({ email, balance });
  } catch (err) {
    console.error('[credits/balance] Erro:', err.message);
    res.status(500).json({ error: 'Erro ao consultar créditos.' });
  }
});

// ─── POST /api/credits/generate ───
// Body: { email, nomeDestinatario, relacao, memoria, genero, voz }
// Consome 1 crédito e gera a música completa (sem preview, sem checkout --
// o crédito já foi pago no pacote de 3).
router.post('/generate', async (req, res) => {
  const { email, nomeDestinatario, relacao, memoria, genero, voz } = req.body;
  const normalizedEmail = (email || '').toLowerCase().trim();

  if (!normalizedEmail || !nomeDestinatario || !relacao || !memoria || !genero) {
    return res.status(400).json({ error: 'Preencha todos os campos obrigatórios.' });
  }

  const consumed = await db.consumeCredit(normalizedEmail);
  if (!consumed) {
    return res.status(402).json({ error: 'Você não tem créditos disponíveis para esse email.' });
  }

  const orderId = crypto.randomUUID();
  const formData = { nomeDestinatario, relacao, memoria, genero, voz };

  const pendingOrder = {
    orderId,
    formData: { ...formData, emailEntrega: normalizedEmail },
    emailEntrega: normalizedEmail,
    status: 'generating_full',
    createdAt: new Date(),
    source: 'credits',
  };
  global.pendingOrders.set(orderId, pendingOrder);
  db.saveOrder(pendingOrder); // backup no Postgres -- não bloqueia a resposta

  res.json({ success: true, orderId, message: 'Música em produção. Isso leva de 3 a 5 minutos.' });

  // Continua em background -- o cliente faz polling em /api/order-status/:orderId
  try {
    const { audioUrl } = await generateFull(formData);
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
    global.downloadTokens.set(token, { orderId, audioUrl, expiresAt });

    const order = global.pendingOrders.get(orderId);
    order.status        = 'complete';
    order.downloadToken = token;
    order.fullAudioUrl   = audioUrl;
    db.saveOrder(order);

    await emailService.sendDownloadEmail({
      to: normalizedEmail,
      nomeDestinatario,
      downloadUrl: `${process.env.APP_URL}/api/download/${token}`,
      audioUrl,
    });
    console.log(`[credits/generate] Música gerada e email enviado para ${normalizedEmail} (orderId ${orderId})`);
  } catch (err) {
    console.error(`[credits/generate] Erro ao gerar música (orderId ${orderId}):`, err.message);
    const order = global.pendingOrders.get(orderId);
    if (order) { order.status = 'error'; db.saveOrder(order); }
    // Devolve o crédito já que a geração falhou
    await db.grantCredits(normalizedEmail, 1).catch(() => {});
  }
});

module.exports = router;
