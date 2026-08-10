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
const deliveryRoutes = require('./routes/delivery');
const creditsRoutes = require('./routes/credits');
const adminRoutes = require('./routes/admin');
const lettersRoutes = require('./routes/letters');
const reviewsRoutes = require('./routes/reviews');
const vipRoutes = require('./routes/vip');
const db = require('./services/db');
const { runAbandonedPreviewRecovery } = require('./services/recovery');

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

// DEBUG TEMPORÁRIO -- diagnosticar "Connection terminated unexpectedly" no
// Postgres a partir de DENTRO do container (rede railway.internal só é
// alcançável daqui, não do CLI local). Remover depois de resolvido.
app.get('/api/debug/db-test', async (req, res) => {
  const { Client } = require('pg');
  const net = require('net');
  const info = {
    databaseUrlHost: (process.env.DATABASE_URL || '').replace(/:[^:@]+@/, ':***@'),
    rawTcp: await new Promise((resolve) => {
      const start = Date.now();
      const sock = net.connect({ host: 'postgres.railway.internal', port: 5432, timeout: 5000 });
      sock.on('connect', () => { resolve({ ok: true, ms: Date.now() - start }); sock.destroy(); });
      sock.on('timeout', () => { resolve({ ok: false, ms: Date.now() - start, err: 'timeout' }); sock.destroy(); });
      sock.on('error', (e) => { resolve({ ok: false, ms: Date.now() - start, err: e.message }); });
    }),
    attempts: [],
  };
  const variants = [
    { label: 'internal ssl:false', url: process.env.DATABASE_URL, ssl: false },
    { label: 'internal ssl:{rejectUnauthorized:false}', url: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } },
    { label: 'public ssl:{rejectUnauthorized:false}', url: process.env.DATABASE_PUBLIC_URL, ssl: { rejectUnauthorized: false } },
  ];
  for (const variant of variants) {
    if (!variant.url) {
      info.attempts.push({ variant: variant.label, ok: false, message: 'URL nao configurada (var ausente)' });
      continue;
    }
    const start = Date.now();
    const client = new Client({
      connectionString: variant.url,
      ssl: variant.ssl,
      connectionTimeoutMillis: 8000,
    });
    try {
      await client.connect();
      const r = await client.query('SELECT 1 as ok, now() as ts');
      info.attempts.push({ variant: variant.label, ok: true, ms: Date.now() - start, result: r.rows[0] });
      await client.end();
    } catch (err) {
      info.attempts.push({
        variant: variant.label,
        ok: false,
        ms: Date.now() - start,
        message: err.message,
        code: err.code,
        errno: err.errno,
        syscall: err.syscall,
        address: err.address,
        port: err.port,
        cause: err.cause ? { message: err.cause.message, code: err.cause.code, library: err.cause.library, reason: err.cause.reason } : undefined,
        stackTop: (err.stack || '').split('\n').slice(0, 3).join(' | '),
      });
      try { await client.end(); } catch (_) {}
    }
  }
  res.json(info);
});

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
    checkoutUrlPack3: process.env.TICTO_CHECKOUT_PACK3 || 'https://checkout.ticto.app/O2B7D2FC2',
    checkoutUrlCarta: process.env.TICTO_CHECKOUT_CARTA || '',
    videoServiceUrl:   process.env.VIDEO_SERVICE_URL   || '',
    creditsServiceUrl: process.env.CREDITS_SERVICE_URL || '',
  });
});

// Contagem real de pedidos recentes -- alimenta a prova de demanda na landing
// (substitui a escassez genérica "alta demanda agora" por um número de verdade).
app.get('/api/stats/live', async (req, res) => {
  try {
    const count = await db.getRecentOrderCount(24);
    res.json({ count });
  } catch (err) {
    res.json({ count: null });
  }
});

app.use('/api', generateRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api', downloadRoutes);
app.use('/api', deliveryRoutes);
app.use('/api/credits', creditsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/letters', lettersRoutes);
app.use('/api/reviews', reviewsRoutes);
app.use('/api/vip', vipRoutes);

// ─── Página de obrigado ───
app.get('/obrigado', (req, res) => {
  res.sendFile(path.join(frontendPath, 'obrigado.html'));
});

// ─── Páginas legais ───
app.get('/termos', (req, res) => res.sendFile(path.join(frontendPath, 'termos.html')));
app.get('/privacidade', (req, res) => res.sendFile(path.join(frontendPath, 'privacidade.html')));
app.get('/reembolso', (req, res) => res.sendFile(path.join(frontendPath, 'reembolso.html')));

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
// initSchema() pode falhar no cold-start do container: a rede interna do
// Railway às vezes ainda não resolveu o host do Postgres no exato momento
// em que o pool abre a primeira conexão ("Connection terminated
// unexpectedly"). Sem retry, uma única falha transitória deixava o schema
// (ex.: tabela vip_access) permanentemente desatualizado até o próximo
// deploy. Retry com backoff cobre esse race condition sem mascarar erro
// real de configuração (DATABASE_URL ausente/errada continua falhando
// todas as tentativas e loga claramente no final).
async function initSchemaWithRetry(maxAttempts = 5, delayMs = 3000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await db.initSchema();
      console.log('   Postgres: ✓ schema pronto' + (attempt > 1 ? ` (tentativa ${attempt})` : ''));
      return;
    } catch (err) {
      if (attempt === maxAttempts) {
        console.error(`   Postgres: ✗ erro ao iniciar schema após ${maxAttempts} tentativas:`, err.message);
        return;
      }
      console.warn(`   Postgres: tentativa ${attempt}/${maxAttempts} falhou (${err.message}), tentando de novo em ${delayMs}ms...`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}
initSchemaWithRetry();

app.listen(PORT, () => {
  console.log(`\n🎵 SuaMúsicaAI rodando em http://localhost:${PORT}`);
  console.log(`   Ambiente: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Suno API: ${process.env.APIFRAME_API_KEY ? '✓ configurada' : '✗ faltando APIFRAME_API_KEY'}`);
  console.log(`   Kiwify:   ${process.env.KIWIFY_WEBHOOK_SECRET ? '✓ configurado' : '✗ faltando KIWIFY_WEBHOOK_SECRET'}\n`);
});

// ─── Recuperação de preview abandonado ───
// Roda em intervalo fixo (não é cron externo, é o próprio processo que já
// fica de pé o tempo todo). Primeira varredura logo após o boot, depois
// repete a cada 30 minutos.
const RECOVERY_INTERVAL_MS = 30 * 60 * 1000;
setTimeout(() => {
  runAbandonedPreviewRecovery().catch(err => console.error('[recovery] erro na varredura inicial:', err.message));
}, 2 * 60 * 1000);
setInterval(() => {
  runAbandonedPreviewRecovery().catch(err => console.error('[recovery] erro na varredura periódica:', err.message));
}, RECOVERY_INTERVAL_MS);

module.exports = app;
