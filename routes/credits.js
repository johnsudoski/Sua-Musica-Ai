/**
 * Créditos do Pacote de 3 Músicas.
 * Consumido pelo serviço externo "Minhas Músicas" (e também disponível
 * diretamente aqui, caso necessário).
 */

const express = require('express');
const crypto = require('crypto');
const db = require('../services/db');
const { generateFull } = require('../services/suno');
const { generateLoveLetter } = require('../services/letterAI');
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
  let audioUrl, token;
  try {
    ({ audioUrl } = await generateFull(formData));
    token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
    global.downloadTokens.set(token, { orderId, audioUrl, expiresAt });

    const order = global.pendingOrders.get(orderId);
    order.status        = 'complete';
    order.downloadToken = token;
    order.fullAudioUrl   = audioUrl;
    db.saveOrder(order);
  } catch (err) {
    // Falha de verdade -- a música não existe. Devolve o crédito.
    console.error(`[credits/generate] Erro ao gerar música (orderId ${orderId}):`, err.message);
    const order = global.pendingOrders.get(orderId);
    if (order) { order.status = 'error'; db.saveOrder(order); }
    await db.grantCredits(normalizedEmail, 1).catch(() => {});
    return;
  }

  // Bônus do Pacote Presente: carta de amor escrita por IA, já liberada
  // (sem checkout separado -- vem inclusa em cada música do pacote de 3).
  // Best-effort: se falhar (ex: ANTHROPIC_API_KEY fora do ar), a música
  // já foi entregue normalmente, só o bônus fica de fora dessa entrega.
  let letterUrl = null;
  try {
    const letterText = await generateLoveLetter({ nomeDestinatario, relacao, memoria });
    const letterId = crypto.randomBytes(12).toString('hex');
    await db.createLetter({ letterId, orderId, email: normalizedEmail, nomeDestinatario, relacao, memoria, letterText });
    await db.markLetterPaid(letterId, normalizedEmail); // bônus: já entra liberada, sem paywall
    letterUrl = `${process.env.APP_URL}/carta.html?letterId=${letterId}`;
  } catch (letterErr) {
    console.error(`[credits/generate] Bônus de carta falhou para orderId ${orderId} (música segue normal):`, letterErr.message);
  }

  // Música já está pronta e salva -- uma falha de email aqui não deve
  // reverter o status nem devolver o crédito (o cliente já foi atendido,
  // só a notificação falhou).
  try {
    await emailService.sendDownloadEmail({
      to: normalizedEmail,
      nomeDestinatario,
      downloadUrl: `${process.env.APP_URL}/api/download/${token}`,
      audioUrl,
      downloadToken: token,
      letterUrl,
    });
    console.log(`[credits/generate] Música gerada e email enviado para ${normalizedEmail} (orderId ${orderId})${letterUrl ? ' + carta bônus' : ''}`);
  } catch (emailErr) {
    console.error(`[credits/generate] Música pronta (orderId ${orderId}) mas falha ao enviar email:`, emailErr.message);
  }
});

module.exports = router;
