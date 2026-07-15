/**
 * Meta Conversions API — envia o evento Purchase direto do servidor pro
 * Meta assim que a Ticto confirma o pagamento.
 *
 * Por que isso existe: a compra acontece na página da Ticto (fora do nosso
 * Pixel), então o navegador nunca dispara um evento de Purchase. Sem isso,
 * o Meta nunca sabe quem realmente comprou, e o algoritmo de anúncios fica
 * sempre otimizando "às cegas" (só por InitiateCheckout).
 *
 * Docs: https://developers.facebook.com/docs/marketing-api/conversions-api
 */

const axios = require('axios');
const crypto = require('crypto');

const PIXEL_ID     = process.env.META_PIXEL_ID || '1333066069024820';
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || '';
const API_VERSION  = 'v20.0';

function sha256(value) {
  return crypto.createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex');
}

/**
 * Envia o evento Purchase pro Meta via Conversions API.
 * Nunca lança erro pra fora -- webhook de pagamento não pode falhar por causa disso.
 */
async function sendPurchaseEvent({ email, value, currency = 'BRL', eventId, sourceUrl, fbp, fbc }) {
  if (!ACCESS_TOKEN) {
    console.warn('[meta-capi] META_ACCESS_TOKEN não configurado -- Purchase não enviado');
    return;
  }
  if (!email) {
    console.warn('[meta-capi] Sem email -- Purchase não enviado (sem chave de correspondência)');
    return;
  }

  const userData = { em: [sha256(email)] };
  if (fbp) userData.fbp = fbp;
  if (fbc) userData.fbc = fbc;

  const event = {
    event_name: 'Purchase',
    event_time: Math.floor(Date.now() / 1000),
    action_source: 'website',
    event_source_url: sourceUrl || process.env.APP_URL || 'https://sua-musica-ai-production.up.railway.app',
    user_data: userData,
    custom_data: {
      currency,
      value,
    },
  };
  if (eventId) event.event_id = eventId;

  try {
    const res = await axios.post(
      `https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events`,
      { data: [event] },
      { params: { access_token: ACCESS_TOKEN }, timeout: 10000 }
    );
    console.log(`[meta-capi] Purchase enviado: email=${email} valor=R$${value} fbp=${fbp ? 'sim' : 'não'} fbc=${fbc ? 'sim' : 'não'} events_received=${res.data.events_received}`);
    return res.data;
  } catch (err) {
    console.error('[meta-capi] Erro ao enviar Purchase:', err.response?.data ? JSON.stringify(err.response.data) : err.message);
  }
}

module.exports = { sendPurchaseEvent };
