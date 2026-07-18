/**
 * Rotas da Carta de Amor (upsell 2, gerado por IA)
 *   POST /api/letters/generate  -> gera preview da carta
 *   GET  /api/letters/:id       -> consulta status/conteúdo da carta
 */

const express = require('express');
const crypto = require('crypto');
const db = require('../services/db');
const { generateLoveLetter } = require('../services/letterAI');

const router = express.Router();

// Quantos caracteres do texto completo aparecem no preview grátis (o resto some com blur no front-end)
const PREVIEW_CHARS = 220;

// ─── POST /api/letters/generate ───
router.post('/generate', async (req, res) => {
  const { nome, relacao, memoria, email, orderId } = req.body;

  if (!nome || !relacao || !memoria) {
    return res.status(400).json({ error: 'Preencha nome, relação e memória.' });
  }

  try {
    const letterText = await generateLoveLetter({ nomeDestinatario: nome, relacao, memoria });
    const letterId = crypto.randomBytes(12).toString('hex');

    await db.createLetter({
      letterId,
      orderId: orderId || null,
      email: email || null,
      nomeDestinatario: nome,
      relacao,
      memoria,
      letterText,
    });

    return res.json({
      success: true,
      letterId,
      preview: letterText.slice(0, PREVIEW_CHARS),
      nomeDestinatario: nome,
    });
  } catch (err) {
    console.error('[letters] Erro ao gerar carta:', err.message);
    return res.status(503).json({ error: 'Não foi possível gerar a carta agora. Tente novamente em instantes.' });
  }
});

// ─── GET /api/letters/:id ───
router.get('/:id', async (req, res) => {
  const letter = await db.getLetter(req.params.id).catch(() => null);
  if (!letter) return res.status(404).json({ error: 'Carta não encontrada.' });

  const paid = letter.status === 'paid';
  return res.json({
    letterId: letter.id,
    nomeDestinatario: letter.nome_destinatario,
    status: letter.status,
    preview: letter.letter_text.slice(0, PREVIEW_CHARS),
    fullText: paid ? letter.letter_text : null,
  });
});

module.exports = router;
