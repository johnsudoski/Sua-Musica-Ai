/**
 * Rota de entrega pós-compra
 *   POST /api/delivery-status  → verifica status do pedido por email
 *   POST /api/resend-email     → reenvia email de download
 */

const express = require('express');
const emailService = require('../services/email');

const router = express.Router();

function findOrderByEmail(email) {
  const normalized = (email || '').toLowerCase().trim();
  for (const [, order] of global.pendingOrders) {
    const orderEmail = (order.emailEntrega || order.formData?.emailEntrega || '').toLowerCase().trim();
    if (orderEmail === normalized) return order;
  }
  return null;
}

// POST /api/delivery-status
// Body: { email: "comprador@email.com" }
// Retorna status do pedido + downloadToken se pronto
router.post('/delivery-status', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email obrigatório.' });

  const order = findOrderByEmail(email);
  if (!order) {
    return res.json({ status: 'not_found' });
  }

  if (order.status === 'complete') {
    return res.json({
      status: 'ready',
      nomeDestinatario: order.formData?.nomeDestinatario || '',
      downloadToken: order.downloadToken,
      videoToken: order.videoToken || null,
    });
  }

  if (order.status === 'error') {
    return res.json({ status: 'error' });
  }

  // generating_preview, preview_ready, generating_full
  return res.json({
    status: 'generating',
    nomeDestinatario: order.formData?.nomeDestinatario || '',
  });
});

// POST /api/resend-email
// Body: { email: "comprador@email.com" }
// Reenvia o email de download se o pedido estiver completo
router.post('/resend-email', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email obrigatório.' });

  const order = findOrderByEmail(email);
  if (!order) {
    return res.status(404).json({ error: 'Pedido não encontrado para este email.' });
  }

  if (order.status !== 'complete') {
    return res.json({ status: 'generating', message: 'Sua música ainda está sendo criada. Aguarde mais alguns instantes.' });
  }

  const appUrl = process.env.APP_URL || 'https://sua-musica-ai-production.up.railway.app';

  try {
    if (order.videoToken) {
      await emailService.sendVideoEmail({
        to: email,
        nomeDestinatario: order.formData?.nomeDestinatario || '',
        mp3DownloadUrl:   `${appUrl}/api/download/${order.downloadToken}`,
        videoDownloadUrl: `${appUrl}/api/download/${order.videoToken}`,
      });
    } else {
      await emailService.sendDownloadEmail({
        to: email,
        nomeDestinatario: order.formData?.nomeDestinatario || '',
        downloadUrl: `${appUrl}/api/download/${order.downloadToken}`,
        audioUrl: order.fullAudioUrl || '',
      });
    }
    res.json({ success: true, message: 'Email reenviado!' });
  } catch (err) {
    console.error('[resend-email] Erro:', err.message);
    res.status(500).json({ error: 'Falha ao enviar email. Tente novamente.' });
  }
});

module.exports = router;
