/**
 * Webhooks de pagamento
 *  POST /api/webhook/kiwify  → Kiwify
 *  POST /api/webhook/ticto   → Ticto (ativo)
 */

const express = require('express');
const crypto = require('crypto');
const axios = require('axios');

const router = express.Router();

// ─── POST /api/webhook/kiwify ───
router.post('/kiwify', async (req, res) => {
  const secret = process.env.KIWIFY_WEBHOOK_SECRET;

  // Validação de assinatura (segurança)
  if (secret) {
    const signature = req.headers['x-kiwify-signature'] || req.headers['x-signature'];
    const rawBody = req.body; // express.raw() aplicado na rota /api/webhook
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    if (signature !== expectedSig) {
      console.warn('Webhook Kiwify: assinatura inválida');
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  let payload;
  try {
    payload = JSON.parse(req.body.toString());
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const { event, data } = payload;

  // Só processa pagamentos aprovados
  if (event !== 'order.approved' && event !== 'order.paid') {
    return res.json({ received: true, action: 'ignored', event });
  }

  const { id: kiwifyOrderId, customer, metadata } = data || {};
  const orderId = metadata?.order_id || metadata?.orderId;

  console.log(`Kiwify webhook: ${event} | kiwifyOrderId: ${kiwifyOrderId} | orderId: ${orderId}`);

  if (!orderId) {
    // Tentativa alternativa: busca por email
    const email = customer?.email;
    if (email) {
      const found = findOrderByEmail(email);
      if (found) {
        triggerFullGeneration(found.orderId);
        return res.json({ received: true });
      }
    }
    console.warn('Webhook: orderId não encontrado no metadata');
    return res.json({ received: true, warning: 'orderId not found' });
  }

  triggerFullGeneration(orderId);
  res.json({ received: true });
});

// ─── POST /api/webhook/ticto ───
// Ticto envia JSON com UTM params no corpo. Passa orderId via ?utm_campaign=ORDER_ID na URL de checkout.
router.post('/ticto', async (req, res) => {
  // Validação do token Ticto (enviado no header Authorization: Bearer TOKEN ou x-ticto-token)
  const tictoToken = process.env.TICTO_WEBHOOK_TOKEN;
  if (tictoToken) {
    const authHeader = req.headers['authorization'] || '';
    const headerToken = req.headers['x-ticto-token'] || req.headers['x-webhook-token'] || '';
    const receivedToken = authHeader.replace('Bearer ', '').trim() || headerToken.trim();
    if (receivedToken && receivedToken !== tictoToken) {
      console.warn('Ticto webhook: token inválido — requisição rejeitada');
      return res.status(401).json({ error: 'Invalid token' });
    }
  }

  // Ticto pode enviar body como raw buffer ou JSON já parsed
  let payload = req.body;
  if (Buffer.isBuffer(payload)) {
    try { payload = JSON.parse(payload.toString()); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  }

  const status = payload?.sale?.status || payload?.order?.status || payload?.status || '';
  const isPaid = ['approved', 'paid', 'complete', 'completed'].includes(String(status).toLowerCase());

  if (!isPaid) {
    console.log(`Ticto webhook: status=${status} — ignorado`);
    return res.json({ received: true, action: 'ignored', status });
  }

  const email = payload?.customer?.email;
  const orderId = payload?.utm_campaign || payload?.sale?.utm_campaign || payload?.order?.utm_campaign;

  console.log(`Ticto webhook: PAGO | email=${email} | orderId=${orderId}`);

  if (orderId) {
    triggerFullGeneration(orderId, email); // passa email do comprador (Ticto)
  } else if (email) {
    const found = findOrderByEmail(email);
    if (found) {
      triggerFullGeneration(found.orderId, email);
    } else {
      console.warn('Ticto webhook: pedido não encontrado para email', email);
    }
  } else {
    console.warn('Ticto webhook: sem orderId nem email para identificar pedido', JSON.stringify(payload));
  }

  res.json({ received: true });
});

function findOrderByEmail(email) {
  for (const [, order] of global.pendingOrders) {
    if (order.formData?.emailEntrega === email && order.status === 'preview_ready') {
      return order;
    }
  }
  return null;
}

function triggerFullGeneration(orderId, emailEntrega) {
  // Chama assincronamente (não bloqueia resposta do webhook)
  axios.post(`${process.env.APP_URL || 'http://localhost:3000'}/api/generate-full`, { orderId, emailEntrega })
    .then(r => console.log(`Geração completa iniciada para ${orderId}:`, r.data.message))
    .catch(e => console.error(`Erro ao iniciar geração completa para ${orderId}:`, e.message));
}

module.exports = router;
