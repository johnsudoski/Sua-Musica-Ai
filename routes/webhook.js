/**
 * Webhooks de pagamento
 *  POST /api/webhook/kiwify  → Kiwify
 *  POST /api/webhook/ticto   → Ticto (ativo)
 */

const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const db = require('../services/db');
const { generateFull, generateInstrumental } = require('../services/suno');
const { generateLoveLetterSet, generateBehindTheScenes } = require('../services/letterAI');
const { generateImage } = require('../services/imageGen');
const emailService = require('../services/email');
const { sendPurchaseEvent } = require('../services/metaCapi');

// ─── Upsell Álbum: os 4 capítulos extras além do que já foi comprado ───
const ALBUM_TEMAS_EXTRA = [
  { tema: 'O primeiro beijo e o primeiro "eu te amo"', genero: 'romantico' },
  { tema: 'O momento mais difícil que superaram juntos', genero: 'mpb' },
  { tema: 'Por que essa pessoa é amada dessa forma', genero: 'pop' },
  { tema: 'O futuro que vocês vão construir juntos', genero: 'pagode' },
];

const router = express.Router();

// ─── IDs dos produtos (checkouts Ticto) ───
const PRODUCT_IDS = {
  mp3:   process.env.TICTO_MP3_PRODUCT   || 'OD11F0BEB',
  video: process.env.TICTO_VIDEO_PRODUCT || 'OD8AA1433',
  pack3: process.env.TICTO_PACK3_PRODUCT || 'O2B7D2FC2',
  carta: process.env.TICTO_CARTA_PRODUCT || '', // ainda não existe -- criar produto na Ticto e setar essa env var
  // Order bumps (comprados junto com mp3/video/pack3 no mesmo checkout)
  bump_instrumental: process.env.TICTO_BUMP_INSTRUMENTAL_PRODUCT || 'O56FD8D3A',
  bump_cartas:        process.env.TICTO_BUMP_CARTAS_PRODUCT        || 'OD7EA6425',
  bump_playlist:       process.env.TICTO_BUMP_PLAYLIST_PRODUCT      || 'O4E87373F',
  // Upsells (página separada pós-compra, checkout próprio)
  upsell_album: process.env.TICTO_UPSELL_ALBUM_PRODUCT || 'OC73D4E60',
  upsell_vip:    process.env.TICTO_UPSELL_VIP_PRODUCT    || 'OC2127151',
};

// ─── Valores dos produtos (pra reportar ao Meta via Conversions API) ───
const PRODUCT_VALUES = {
  mp3:   19.90,
  video: 39.90,
  pack3: 39.90,
  carta: Number(process.env.CARTA_PRICE || 14.90),
  bump_instrumental: 14.90,
  bump_cartas:        19.90,
  bump_playlist:       7.90,
  upsell_album: 49.90,
  upsell_vip:    69.90,
};

// ─── Detecta qual produto foi comprado pelo payload Ticto ───
function detectProductType(payload) {
  const offerId = payload?.sale?.offer_id || payload?.order?.offer_id || payload?.offer_id || '';

  if (PRODUCT_IDS.carta && offerId === PRODUCT_IDS.carta) return 'carta';
  if (offerId === PRODUCT_IDS.bump_instrumental) return 'bump_instrumental';
  if (offerId === PRODUCT_IDS.bump_cartas)        return 'bump_cartas';
  if (offerId === PRODUCT_IDS.bump_playlist)       return 'bump_playlist';
  if (offerId === PRODUCT_IDS.upsell_album) return 'upsell_album';
  if (offerId === PRODUCT_IDS.upsell_vip)    return 'upsell_vip';
  if (offerId === PRODUCT_IDS.pack3) return 'pack3';
  if (offerId === PRODUCT_IDS.video) return 'video';
  if (offerId === PRODUCT_IDS.mp3)   return 'mp3';

  // Fallback por preço, só quando o offer_id não bate com nenhum conhecido.
  // ATENÇÃO: video e pack3 custam os dois R$39,90 -- preço sozinho não
  // distingue entre eles. Esse fallback só é confiável pro mp3 (R$19,90);
  // pra video/pack3 dependemos do offer_id bater corretamente.
  const price = Number(payload?.sale?.price || payload?.order?.price || payload?.price || 0);
  if (price > 0 && price < 1000) return 'bump_playlist'; // R$7,90
  if (price >= 1000 && price < 1700) return 'bump_instrumental'; // R$14,90
  if (price >= 1700 && price < 2500) return 'bump_cartas'; // R$19,90 (ambíguo com carta se CARTA_PRICE for igual)
  if (price >= 3500) return 'pack3'; // R$35+ (ambíguo com video, ver nota acima)
  if (price >= 2500) return 'video'; // R$25-34 (só cai aqui se price < 35, não deveria acontecer pro video real)
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

  const email = payload?.customer?.email;

  // Ticto v2 manda os UTMs dentro de payload.tracking.utm_campaign -- e quando
  // não tem valor, manda a STRING LITERAL "Não Informado" (não null/undefined).
  // O código antigo só olhava payload.utm_campaign / sale.utm_campaign /
  // order.utm_campaign, que nunca existiram -- por isso campaignId sempre
  // chegava undefined e o pedido só era localizado via e-mail.
  const rawCampaignId = payload?.tracking?.utm_campaign
    || payload?.utm_campaign
    || payload?.sale?.utm_campaign
    || payload?.order?.utm_campaign;
  const campaignId = (rawCampaignId && rawCampaignId !== 'Não Informado') ? rawCampaignId : undefined;

  // Telefone vem em payload.customer.phone.{ddi,ddd,number} -- capturamos em
  // TODO evento (pago ou nao), pra ter fila de recuperacao de PIX pendente
  // com telefone pronto, sem depender de export manual do painel da Ticto.
  const phoneObj = payload?.customer?.phone;
  const phone = (phoneObj?.ddi && phoneObj?.number)
    ? `${phoneObj.ddi}${phoneObj.ddd || ''}${phoneObj.number}`
    : undefined;

  if (phone || campaignId) {
    db.updateOrderContact(campaignId, email, { phone, checkoutStatus: status }).catch(() => {});
  }

  if (!isPaid) {
    console.log(`Ticto webhook: status=${status} | email=${email} | telefone=${phone ? 'capturado' : 'nao'} — ignorado`);
    return res.json({ received: true, action: 'ignored', status });
  }

  const productType = detectProductType(payload);

  console.log(`Ticto webhook: PAGO | email=${email} | campaignId=${campaignId} | produto=${productType}`);

  // Responde rápido pra Ticto; processamento continua em background.
  res.json({ received: true });

  const saleValue = PRODUCT_VALUES[productType] || PRODUCT_VALUES.mp3;

  // Reporta a compra real pro Meta via Conversions API (o navegador nunca vê
  // essa conversão, já que o pagamento acontece na página da Ticto). Busca
  // fbp/fbc capturados no site (armazenados no form_data do pedido) pra
  // melhorar o match quality -- só com email o Meta recebe o evento mas
  // não necessariamente consegue linkar ao clique que originou a venda.
  const { fbp, fbc } = await getOrderFbData(campaignId, email);
  sendPurchaseEvent({
    email,
    value: saleValue,
    eventId: campaignId ? `${campaignId}-purchase` : undefined,
    fbp,
    fbc,
  }).catch(() => {}); // sendPurchaseEvent já trata os próprios erros internamente

  // Registra a venda pra ter uma fonte de verdade de receita (painel financeiro)
  db.recordSale({ productType, valueCents: Math.round(saleValue * 100), email, campaignId }).catch(() => {});

  try {
    if (productType === 'pack3') {
      await handlePack3Purchase(email);
    } else if (productType === 'video') {
      await handleVideoPurchase(campaignId, email);
    } else if (productType === 'carta') {
      // campaignId aqui carrega o letterId (setado como utm_campaign no link de checkout da carta.html)
      await handleCartaPurchase(campaignId, email);
    } else if (productType === 'bump_instrumental') {
      await handleBumpInstrumental(campaignId, email);
    } else if (productType === 'bump_cartas') {
      await handleBumpCartas(campaignId, email);
    } else if (productType === 'bump_playlist') {
      await handleBumpPlaylist(campaignId, email);
    } else if (productType === 'upsell_album') {
      await handleUpsellAlbumPurchase(campaignId, email);
    } else if (productType === 'upsell_vip') {
      await handleUpsellVipPurchase(campaignId, email);
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

// ─── Order Bump: Áudio-Mensagem Personalizada (versão instrumental) ───
async function handleBumpInstrumental(orderId, email) {
  if (!orderId) { console.warn('Bump Instrumental: sem orderId (utm_campaign) — não é possível localizar a música'); return; }
  const row = await db.getOrder(orderId).catch(() => null);
  if (!row?.form_data) { console.warn(`Bump Instrumental: pedido ${orderId} não encontrado`); return; }

  const emailTo = (email || row.email || '').toLowerCase().trim();
  if (!emailTo) { console.warn(`Bump Instrumental: sem email para orderId ${orderId}`); return; }

  try {
    const { audioUrl } = await generateInstrumental(row.form_data);
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
    global.downloadTokens.set(token, { orderId: `${orderId}-instrumental`, audioUrl, expiresAt });

    await emailService.sendBumpInstrumentalEmail({
      to: emailTo,
      nomeDestinatario: row.form_data.nomeDestinatario,
      downloadUrl: `${process.env.APP_URL}/api/download/${token}`,
    });
    console.log(`Bump Instrumental: entregue para ${emailTo} (orderId ${orderId})`);
  } catch (err) {
    console.error(`Bump Instrumental: falha ao gerar/entregar para orderId ${orderId}:`, err.message);
  }
}

// ─── Order Bump: Kit 12 Cartas de Amor (uma por mês/ocasião) ───
async function handleBumpCartas(orderId, email) {
  if (!orderId) { console.warn('Bump Cartas: sem orderId (utm_campaign) — não é possível localizar a história'); return; }
  const row = await db.getOrder(orderId).catch(() => null);
  if (!row?.form_data) { console.warn(`Bump Cartas: pedido ${orderId} não encontrado`); return; }

  const emailTo = (email || row.email || '').toLowerCase().trim();
  if (!emailTo) { console.warn(`Bump Cartas: sem email para orderId ${orderId}`); return; }

  try {
    const letters = await generateLoveLetterSet({
      nomeDestinatario: row.form_data.nomeDestinatario,
      relacao: row.form_data.relacao,
      memoria: row.form_data.memoria,
    });
    await emailService.sendBumpCartasEmail({ to: emailTo, nomeDestinatario: row.form_data.nomeDestinatario, letters });
    console.log(`Bump Cartas: entregue para ${emailTo} (orderId ${orderId})`);
  } catch (err) {
    console.error(`Bump Cartas: falha ao gerar/entregar para orderId ${orderId}:`, err.message);
  }
}

// ─── Upsell: Álbum Completo (4 músicas extras + capa + linha do tempo + behind the scenes) ───
// Vídeo-compilation NÃO está incluso -- o serviço externo de vídeo atual foi
// desenhado pra 1 música só, compilar 5 num vídeo de 15min precisa de infra
// que ainda não existe. Entrega real: 4 músicas + os 3 bônus gerados de verdade.
async function handleUpsellAlbumPurchase(orderId, email) {
  if (!orderId) { console.warn('Upsell Álbum: sem orderId (utm_campaign) — não é possível localizar a história'); return; }
  const row = await db.getOrder(orderId).catch(() => null);
  if (!row?.form_data) { console.warn(`Upsell Álbum: pedido ${orderId} não encontrado`); return; }

  const emailTo = (email || row.email || '').toLowerCase().trim();
  if (!emailTo) { console.warn(`Upsell Álbum: sem email para orderId ${orderId}`); return; }

  const nomeDestinatario = row.form_data.nomeDestinatario;
  const songs = [];
  // URLs brutas (não os tokens de download, que expiram em 48h e vivem só em
  // memória) -- é o que o serviço de vídeo precisa pra montar o vídeo
  // compilation, que pode rodar bem depois desse prazo.
  const rawTracks = [];
  if (row.full_audio_url) {
    rawTracks.push({ tema: 'A música que já é sua', audioUrl: row.full_audio_url });
  }

  for (const t of ALBUM_TEMAS_EXTRA) {
    try {
      const formDataVariant = {
        ...row.form_data,
        memoria: `${row.form_data.memoria} (foco desta música: ${t.tema})`,
        genero: t.genero,
      };
      const { audioUrl } = await generateFull(formDataVariant);
      const token = crypto.randomBytes(32).toString('hex');
      global.downloadTokens.set(token, { orderId: `${orderId}-album-${songs.length}`, audioUrl, expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000) });
      songs.push({ tema: t.tema, downloadUrl: `${process.env.APP_URL}/api/download/${token}` });
      rawTracks.push({ tema: t.tema, audioUrl });
    } catch (err) {
      console.error(`Upsell Álbum: falha ao gerar música do tema "${t.tema}" (orderId ${orderId}):`, err.message);
    }
  }

  let coverUrl = null, timelineUrl = null, behindTheScenes = null;
  try {
    const coverPrompt = `Dark background gradient from deep navy-black to soft pink-purple glow, romantic modern aesthetic, cinematic lighting, blurred bokeh light particles. Center composition: a premium vinyl album cover mockup floating at a slight angle, glowing grooves catching pink-purple light, five small glowing musical notes orbiting around it. Premium minimalist digital product cover, no text, no logos, no realistic human faces, square 1:1 aspect ratio, glossy premium finish.`;
    const cover = await generateImage({ prompt: coverPrompt });
    coverUrl = cover.imageUrl;
  } catch (err) { console.error(`Upsell Álbum: falha ao gerar capa (orderId ${orderId}):`, err.message); }

  try {
    const timelinePrompt = `Dark background gradient from deep navy-black to soft pink-purple glow, elegant infographic style, illustrated timeline with glowing connecting line, small romantic icons (hearts, music notes) marking points along the line, premium minimalist aesthetic, no text, no logos, no realistic human faces, square 1:1 aspect ratio.`;
    const timeline = await generateImage({ prompt: timelinePrompt });
    timelineUrl = timeline.imageUrl;
  } catch (err) { console.error(`Upsell Álbum: falha ao gerar linha do tempo (orderId ${orderId}):`, err.message); }

  try {
    behindTheScenes = await generateBehindTheScenes({
      nomeDestinatario,
      relacao: row.form_data.relacao,
      memoria: row.form_data.memoria,
      temas: ['A música original que você já recebeu', ...ALBUM_TEMAS_EXTRA.map(t => t.tema)],
    });
  } catch (err) { console.error(`Upsell Álbum: falha ao gerar behind the scenes (orderId ${orderId}):`, err.message); }

  // Vídeo Compilation (bônus prometido na página): delega pro serviço de
  // vídeo, que renderiza via Creatomate de forma assíncrona -- pode levar
  // alguns minutos, então roda em paralelo e avisa o cliente por email
  // quando ficar pronto, sem bloquear a entrega principal (músicas + capa +
  // behind the scenes) se essa etapa falhar.
  if (process.env.VIDEO_SERVICE_URL && coverUrl && rawTracks.length >= 2) {
    try {
      await axios.post(
        `${process.env.VIDEO_SERVICE_URL}/api/album-compilation`,
        { requestId: `${orderId}-album-compilation`, email: emailTo, nomeDestinatario, tracks: rawTracks, coverUrl },
        { timeout: 15000 }
      );
      console.log(`Upsell Álbum: vídeo compilation enfileirado no serviço de vídeo (orderId ${orderId})`);
    } catch (err) {
      console.error(`Upsell Álbum: falha ao enfileirar vídeo compilation (orderId ${orderId}):`, err.message);
    }
  } else {
    console.warn(`Upsell Álbum: vídeo compilation NÃO enfileirado (orderId ${orderId}) -- VIDEO_SERVICE_URL=${!!process.env.VIDEO_SERVICE_URL} coverUrl=${!!coverUrl} faixas=${rawTracks.length}`);
  }

  try {
    await emailService.sendUpsellAlbumEmail({ to: emailTo, nomeDestinatario, songs, coverUrl, timelineUrl, behindTheScenes });
    console.log(`Upsell Álbum: entregue para ${emailTo} (orderId ${orderId}, ${songs.length}/4 músicas extras geradas)`);
  } catch (err) {
    console.error(`Upsell Álbum: falha ao enviar email final (orderId ${orderId}):`, err.message);
  }
}

// ─── Upsell: VIP Acesso Ilimitado por 1 ano ───
async function handleUpsellVipPurchase(orderId, email) {
  const row = orderId ? await db.getOrder(orderId).catch(() => null) : null;
  const emailTo = (email || row?.email || '').toLowerCase().trim();
  if (!emailTo) { console.warn(`Upsell VIP: sem email para orderId ${orderId}`); return; }

  try {
    const vipUntil = await db.grantVipAccess(emailTo, 365);
    const vipUrl = `${process.env.APP_URL || 'https://suamusicaai.com.br'}/vip.html`;
    await emailService.sendUpsellVipEmail({ to: emailTo, vipUntil, vipUrl });
    console.log(`Upsell VIP: acesso concedido para ${emailTo} até ${vipUntil}`);
  } catch (err) {
    console.error(`Upsell VIP: falha ao conceder acesso para ${emailTo}:`, err.message);
  }
}

// ─── Order Bump: Playlist Romântica Curada (curadoria fixa por gênero, sem geração dinâmica) ───
async function handleBumpPlaylist(orderId, email) {
  if (!orderId) { console.warn('Bump Playlist: sem orderId (utm_campaign)'); return; }
  const row = await db.getOrder(orderId).catch(() => null);
  const emailTo = (email || row?.email || '').toLowerCase().trim();
  if (!emailTo) { console.warn(`Bump Playlist: sem email para orderId ${orderId}`); return; }

  const genero = row?.form_data?.genero || 'romantico';
  try {
    await emailService.sendBumpPlaylistEmail({ to: emailTo, genero });
    console.log(`Bump Playlist: entregue para ${emailTo} (orderId ${orderId}, gênero ${genero})`);
  } catch (err) {
    console.error(`Bump Playlist: falha ao entregar para orderId ${orderId}:`, err.message);
  }
}

// ─── Carta de Amor: desbloqueia o texto completo (já foi gerado no preview) ───
async function handleCartaPurchase(letterId, email) {
  if (!letterId) {
    console.warn('Carta: sem letterId (utm_campaign) — não é possível desbloquear');
    return;
  }
  const letter = await db.markLetterPaid(letterId, email);
  if (!letter) {
    console.warn(`Carta: letterId ${letterId} não encontrado`);
    return;
  }
  console.log(`Carta: desbloqueada para ${email} (letterId ${letterId})`);
}

// ─── Pacote 3 Músicas: concede créditos (a criação acontece na página de créditos) ───
async function handlePack3Purchase(email) {
  if (!email) {
    console.warn('Pack3: sem email no payload — não é possível conceder créditos');
    return;
  }
  const normalized = email.toLowerCase().trim();
  const balance = await db.grantCredits(normalized, 3);
  console.log(`Pack3: +3 créditos para ${normalized} (saldo agora: ${balance})`);

  // Os créditos já foram gravados -- uma falha de email aqui não deve
  // reverter nada, só falta a notificação.
  try {
    const creditsUrl = process.env.CREDITS_SERVICE_URL || process.env.APP_URL || '';
    await emailService.sendCreditsEmail({ to: normalized, balance, creditsUrl });
  } catch (emailErr) {
    console.error(`Pack3: créditos concedidos para ${normalized} mas falha ao enviar email:`, emailErr.message);
  }
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

// Busca fbp/fbc capturados no site (gravados no form_data do pedido em
// generate-preview) pra anexar no evento Purchase do Conversions API.
async function getOrderFbData(campaignId, email) {
  try {
    if (campaignId) {
      const row = await db.getOrder(campaignId);
      if (row?.form_data) return { fbp: row.form_data.fbp, fbc: row.form_data.fbc };
    }
    if (email) {
      const row = await db.getOrderByEmail(email);
      if (row?.form_data) return { fbp: row.form_data.fbp, fbc: row.form_data.fbc };
    }
  } catch (err) {
    console.warn('[webhook] Não foi possível recuperar fbp/fbc do pedido:', err.message);
  }
  return {};
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
