/**
 * Coleta de avaliações reais de clientes (prova social).
 *   POST /api/reviews        -> registra avaliação (só quem tem token de download válido)
 *   GET  /api/reviews/stats  -> total + média (pública, pra exibir na landing quando houver volume)
 */

const express = require('express');
const db = require('../services/db');

const router = express.Router();

// ─── POST /api/reviews ───
router.post('/', async (req, res) => {
  const { token, rating, texto } = req.body;

  const ratingNum = Number(rating);
  if (!token || !ratingNum || ratingNum < 1 || ratingNum > 5) {
    return res.status(400).json({ error: 'Token e nota (1-5) são obrigatórios.' });
  }

  const tokenData = global.downloadTokens.get(token);
  if (!tokenData) {
    return res.status(404).json({ error: 'Link de avaliação inválido ou expirado.' });
  }

  const orderId = tokenData.orderId;
  const jaAvaliou = await db.hasReviewForOrder(orderId).catch(() => false);
  if (jaAvaliou) {
    return res.status(409).json({ error: 'Esse pedido já foi avaliado. Obrigado!' });
  }

  const order = global.pendingOrders.get(orderId);
  const email = order?.emailEntrega || order?.formData?.emailEntrega || null;
  const nomeDestinatario = order?.formData?.nomeDestinatario || null;

  try {
    await db.createReview({ orderId, email, nomeDestinatario, rating: ratingNum, texto: (texto || '').slice(0, 1000) });
    res.json({ success: true });
  } catch (err) {
    console.error('[reviews] Erro ao salvar avaliação:', err.message);
    res.status(500).json({ error: 'Erro ao salvar avaliação. Tente novamente.' });
  }
});

// ─── GET /api/reviews/stats ───
router.get('/stats', async (req, res) => {
  try {
    const stats = await db.getReviewStats();
    res.json({ total: stats.total || 0, media: stats.media ? Number(stats.media) : 0 });
  } catch (err) {
    res.json({ total: 0, media: 0 });
  }
});

// ─── GET /api/reviews/approved ───
// Avaliações reais aprovadas, pra landing exibir prova social de verdade
// (nunca depoimento inventado). Retorna lista vazia se não houver volume
// ainda -- o frontend deve esconder a seção nesse caso, não inventar texto.
router.get('/approved', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 6, 20);
    const reviews = await db.getApprovedReviews(limit);
    res.json({
      reviews: reviews
        .filter(r => r.texto && r.texto.trim().length > 0)
        .map(r => ({
          nomeDestinatario: r.nome_destinatario,
          rating: r.rating,
          texto: r.texto,
          data: r.created_at,
        })),
    });
  } catch (err) {
    res.json({ reviews: [] });
  }
});

module.exports = router;
