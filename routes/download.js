/**
 * Rota de download seguro do MP3
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');

const router = express.Router();

// ─── GET /api/download/:token ───
router.get('/download/:token', async (req, res) => {
  const { token } = req.params;
  const tokenData = global.downloadTokens.get(token);

  if (!tokenData) {
    return res.status(404).send('Link não encontrado ou expirado.');
  }

  if (new Date() > tokenData.expiresAt) {
    global.downloadTokens.delete(token);
    return res.status(410).send('Este link de download expirou (validade: 48h). Entre em contato com o suporte.');
  }

  // Detecta tipo de mídia
  const isVideo   = tokenData.isVideo || !!tokenData.videoUrl;
  const mediaUrl  = tokenData.videoUrl || tokenData.audioUrl;
  const extension = isVideo ? '.mp4' : '.mp3';
  const mimeType  = isVideo ? 'video/mp4' : 'audio/mpeg';

  // Se temos arquivo local
  if (tokenData.filePath && fs.existsSync(tokenData.filePath)) {
    const order = global.pendingOrders.get(tokenData.orderId);
    const nome = order?.formData?.nomeDestinatario || 'musica';
    const filename = `SuaMusicaAI-${nome}${extension}`.replace(/[^a-zA-Z0-9\-_.]/g, '_');

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', mimeType);
    return fs.createReadStream(tokenData.filePath).pipe(res);
  }

  // Se temos URL remota (proxy para manter token seguro)
  if (mediaUrl) {
    const order = global.pendingOrders.get(tokenData.orderId);
    const nome = order?.formData?.nomeDestinatario || 'musica';
    const filename = `SuaMusicaAI-${nome}${extension}`.replace(/[^a-zA-Z0-9\-_.]/g, '_');

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', mimeType);

    https.get(mediaUrl, (mediaRes) => {
      mediaRes.pipe(res);
    }).on('error', () => {
      res.status(500).send('Erro ao baixar arquivo. Tente novamente.');
    });
    return;
  }

  return res.status(404).send('Arquivo não disponível.');
});

// ─── GET /api/reveal/:token ─── (dados pra página de revelação/QR code)
router.get('/reveal/:token', (req, res) => {
  const { token } = req.params;
  const tokenData = global.downloadTokens.get(token);
  if (!tokenData) return res.status(404).json({ error: 'not_found' });
  if (new Date() > tokenData.expiresAt) return res.status(410).json({ error: 'expired' });

  const order = global.pendingOrders.get(tokenData.orderId);
  res.json({
    ready: true,
    nomeDestinatario: order?.formData?.nomeDestinatario || '',
    genero: order?.formData?.genero || '',
    isVideo: tokenData.isVideo || !!tokenData.videoUrl,
  });
});

// ─── GET /api/listen/:token ─── (mesma mídia do download, mas tocando inline no navegador)
router.get('/listen/:token', async (req, res) => {
  const { token } = req.params;
  const tokenData = global.downloadTokens.get(token);
  if (!tokenData) return res.status(404).send('Link não encontrado ou expirado.');
  if (new Date() > tokenData.expiresAt) return res.status(410).send('Este link expirou.');

  const isVideo   = tokenData.isVideo || !!tokenData.videoUrl;
  const mediaUrl  = tokenData.videoUrl || tokenData.audioUrl;
  const mimeType  = isVideo ? 'video/mp4' : 'audio/mpeg';

  if (tokenData.filePath && fs.existsSync(tokenData.filePath)) {
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Content-Type', mimeType);
    return fs.createReadStream(tokenData.filePath).pipe(res);
  }

  if (mediaUrl) {
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Content-Type', mimeType);
    https.get(mediaUrl, (mediaRes) => { mediaRes.pipe(res); })
      .on('error', () => res.status(500).send('Erro ao carregar áudio.'));
    return;
  }

  return res.status(404).send('Arquivo não disponível.');
});

// ─── GET /api/order-status/:orderId ─── (polling do frontend)
router.get('/order-status/:orderId', (req, res) => {
  const order = global.pendingOrders.get(req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });

  res.json({
    status: order.status,
    downloadToken: order.status === 'complete' ? order.downloadToken : null,
  });
});

module.exports = router;
