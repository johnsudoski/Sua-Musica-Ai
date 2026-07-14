/**
 * Webhooks de pagamento
 *  POST /api/webhook/kiwify  → Kiwify
 *  POST /api/webhook/ticto   → Ticto (ativo)
 */

const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const db = require('../services/db');
const { generateFull } = require('../services/suno');
const emailService = require('../services/email');
const { sendPurchaseEvent } = require('../services/metaCapi');

const router = express.Router();

// ─── IDs dos produtos (checkouts Ticto) ───
const PRODUCT_IDS = {
  mp3:   process.env.TICTO_MP3_PRODUCT   || 'OD11F0BEB',
  video: process.env.TICTO_VIDEO_PRODUCT || 'OD8AA1433',
  pack3: process.env.TICTO_PACK3_PRODUCT || 'O2B7D2FC2',
};

// ─── Valores dos produtos (pra reportar ao Meta via Conversions API) ───
const PRODUCT_VALUES = {
  mp3:   19.90,
  video: 29.90,
  pack3: 39.90,
};

// ─── Detecta qual produto foi comprado pelo payload Ticto ───
function detectProductType(payload) {
  const offerId = payload?.sale?.offer_id || payload?.order?.offer_id || payload?.offer_id || '';

  if (offerId === PRODUCT_IDS.pack3) return 'pack3';
  if (offerId === PRODUCT_IDS.video) return 'video';
  if (offerId === PRODUCT_IDS.mp3)   return 'mp3';

  // Fallback por preço, só quando o offer_id não bate com nenhum conhecido
  const price = Number(payload?.sale?.price || payload?.order?.price || payload?.price || 0);
  if (price >= 3500) return 'pack3'; // R$35+
  if (price >= 2500) return 'video'; // R$25-34
  return 'mp3';
}

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
// Ticto envia JSON com UTM params no corpo. Passa orderId (ou request_id, no
// caso do Vídeo Homenagem) via ?utm_campaign=... na URL de checkout.
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
  const isPaid = ['approved', 'paid', 'complete', 'completed', 'authorized'].includes(String(status).toLowerCase());

  if (!isPaid) {
    console.log(`Ticto webhook: status=${status} — ignorado`);
    return res.json({ received: true, action: 'ignored', status });
  }

  const email       = payload?.customer?.email;
  const campaignId  = payload?.utm_campaign || payload?.sale?.utm_campaign || payload?.order?.utm_campaign;
  const productType = detectProductType(payload);

  console.log(`Ticto webhook: PAGO | email=${email} | campaignId=${campaignId} | produto=${productType}`);

  // Responde rápido pra Ticto; processamento continua em background.
  res.json({ received: true });

  // Reporta a compra real pro Meta via Conversions API (o navegador nunca vê
  // essa conversão, já que o pagamento acontece na página da Ticto).
  sendPurchaseEvent({
    email,
    value: PRODUCT_VALUES[productType] || PRODUCT_VALUES.mp3,
    eventId: campaignId ? `${campaignId}-purchase` : undefined,
  }).catch(() => {}); // sendPurchaseEvent já trata os próprios erros internamente

  try {
    if (productType === 'pack3') {
      await handlePack3Purchase(email);
    } else if (productType === 'video') {
      await handleVideoPurchase(campaignId, email);
    } else if (campaignId) {
      triggerFullGeneration(campaignId, email, productType);
    } else if (email) {
      const found = await findOrderByEmail(email);
      if (found) {
        triggerFullGeneration(found.orderId, email, productType);
      } else {
        console.warn('Ticto webhook: pedido não encontrado para email', email);
      }
    } else {
      console.warn('Ticto webhook: sem orderId nem email para identificar pedido', JSON.stringify(payload));
    }
  } catch (err) {
    console.error('Ticto webhook: erro ao processar pagamento:', err.message);
  }
});

// ─── Pacote 3 Músicas: concede créditos (a criação acontece na página de créditos) ───
async function handlePack3Purchase(email) {
  if (!email) {
    console.warn('Pack3: sem email no payload — não é possível conceder créditos');
    return;
  }
  const normalized = email.toLowerCase().trim();
  const balance = await db.grantCredits(normalized, 3);
  console.log(`Pack3: +3 créditos para ${normalized} (saldo agora: ${balance})`);

  const creditsUrl = process.env.CREDITS_SERVICE_URL || process.env.APP_URL || '';
  await emailService.sendCreditsEmail({ to: normalized, balance, creditsUrl });
}

// ─── Vídeo Homenagem: gera a música e marca o pedido como pago; a montagem
// do vídeo em si é feita pelo serviço separado "Vídeo Homenagem" ───
async function handleVideoPurchase(requestId, email) {
  if (!requestId) {
    console.warn('Vídeo Homenagem: sem request_id (utm_campaign) — não é possível localizar o pedido');
    return;
  }
  const videoRequest = await db.getVideoRequestByRequestId(requestId);
  if (!videoRequest) {
    console.warn(`Vídeo Homenagem: request_id ${requestId} não encontrado em video_requests`);
    return;
  }

  console.log(`Vídeo Homenagem: gerando música para request_id ${requestId}...`);
  const { audioUrl } = await generateFull(videoRequest.form_data || {});
  await db.markVideoRequestPaid(requestId, { email, audioUrl });
  console.log(`Vídeo Homenagem: música pronta para request_id ${requestId} — aguardando montagem do vídeo`);
}

async function findOrderByEmail(email) {
  const normalized = (email || '').toLowerCase().trim();
  for (const [, order] of global.pendingOrders) {
    const orderEmail = (order.formData?.emailEntrega || order.emailEntrega || '').toLowerCase().trim();
    if (orderEmail === normalized && order.status === 'preview_ready') {
      return order;
    }
  }
  // Não achou em memória (ex: servidor reiniciou entre o preview e o pagamento) --
  // tenta recuperar do backup no Postgres antes de desistir.
  const row = await db.getOrderByEmail(normalized, 'preview_ready').catch(() => null);
  if (row) {
    const recovered = db.orderRowToMemoryFormat(row);
    global.pendingOrders.set(recovered.orderId, recovered);
    console.warn(`[orders] Pedido de ${normalized} recuperado do Postgres (não estava em memória)`);
    return recovered;
  }
  return null;
}

function triggerFullGeneration(orderId, emailEntrega, productType = 'mp3') {
  // Chama assincronamente (não bloqueia resposta do webhook)
  axios.post(`${process.env.APP_URL || 'http://localhost:3000'}/api/generate-full`, { orderId, emailEntrega, productType })
    .then(r => console.log(`Geração completa iniciada para ${orderId} [${productType}]:`, r.data.message))
    .catch(e => console.error(`Erro ao iniciar geração completa para ${orderId}:`, e.message));
}

module.exports = router;
