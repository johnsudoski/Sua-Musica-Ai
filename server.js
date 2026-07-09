/**
 * SuaMúsicaAI — Backend Server
 * Node.js + Express
 *
 * Rotas:
 *   GET  /health                → health check
 *   GET  /api/config            → config pública (checkout URL)
 *   POST /api/generate-preview  → gera preview 30s via Suno API
 *   POST /api/webhook/kiwify    → recebe pagamento confirmado
 *   GET  /api/download/:token   → serve MP3 para download seguro
 *   POST /api/generate-full     → gera música completa (chamado interno)
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const generateRoutes = require('./routes/generate');
const webhookRoutes = require('./routes/webhook');
const downloadRoutes = require('./routes/download');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST'],
}));

// Webhook do Kiwify precisa do body raw para validação de assinatura
app.use('/api/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Servir frontend estático ───
// Em produção (Railway) os arquivos ficam em ./public; localmente em ../frontend
const frontendPath = fs.existsSync(path.join(__dirname, 'public'))
  ? path.join(__dirname, 'public')
  : path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendPath));

// ─── Criar diretório de downloads temporários ───
const downloadsDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir, { recursive: true });

// ─── Armazenamento em memória (produção: usar Redis/DB) ───
// pendingOrders: { orderId → { formData, previewUrl, status, downloadToken } }
global.pendingOrders = new Map();
global.downloadTokens = new Map(); // token → { orderId, expiresAt, filePath }

// ─── Rotas da API ───
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ─── Teste de email (só em produção com token) ───
app.get('/api/test-email', async (req, res) => {
  const token = req.query.token;
  if (token !== process.env.TICTO_WEBHOOK_TOKEN) {
    return res.status(401).json({ error: 'Não autorizado' });
  }
  try {
    const { sendDownloadEmail } = require('./services/email');
    await sendDownloadEmail({
      to: process.env.GMAIL_USER,
      nomeDestinatario: 'Maria',
      downloadUrl: 'https://sua-musica-ai-production.up.railway.app/health',
      audioUrl: '',
    });
    res.json({ ok: true, mensagem: `Email de teste enviado para ${process.env.GMAIL_USER}` });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.get('/api/config', (req, res) => {
  res.json({
    checkoutUrlMp3:   process.env.TICTO_CHECKOUT_MP3   || 'https://checkout.ticto.app/OD11F0BEB',
    checkoutUrlVideo: process.env.TICTO_CHECKOUT_VIDEO || 'https://checkout.ticto.app/OD8AA1433',
  });
});

app.use('/api', generateRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api', downloadRoutes);

// ─── SPA fallback ───
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// ─── Error handler ───
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Erro interno. Tente novamente.' });
});

// ─── Start ───
app.listen(PORT, () => {
  console.log(`\n🎵 SuaMúsicaAI rodando em http://localhost:${PORT}`);
  console.log(`   Ambiente: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Suno API: ${process.env.APIFRAME_API_KEY ? '✓ configurada' : '✗ faltando APIFRAME_API_KEY'}`);
  console.log(`   Kiwify:   ${process.env.KIWIFY_WEBHOOK_SECRET ? '✓ configurado' : '✗ faltando KIWIFY_WEBHOOK_SECRET'}\n`);
});

module.exports = app;
