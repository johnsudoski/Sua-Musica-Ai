/**
 * Serviço de email — entrega do link de download após pagamento
 *
 * Prioridade de configuração:
 *   1. RESEND_API_KEY  → API HTTP (funciona em qualquer cloud, recomendado)
 *   2. SMTP_HOST       → SMTP genérico (Brevo, MailerSend, etc.)
 *   3. GMAIL_USER      → Gmail App Password (pode sofrer timeout em cloud)
 */

const axios = require('axios');
const nodemailer = require('nodemailer');

function buildHtml({ nomeDestinatario, downloadUrl, appUrl }) {
  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sua música está pronta! 🎵</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0D0D1A; color: #fff; margin: 0; padding: 20px; }
    .container { max-width: 580px; margin: 0 auto; background: #161628; border-radius: 16px; overflow: hidden; }
    .header { background: linear-gradient(135deg, #E91E8C, #7B2FBE); padding: 40px 30px; text-align: center; }
    .header h1 { margin: 0; font-size: 28px; color: #fff; }
    .header p { margin: 8px 0 0; color: rgba(255,255,255,0.85); font-size: 16px; }
    .body { padding: 32px 30px; }
    .body p { color: #ccc; line-height: 1.6; margin: 0 0 16px; }
    .name { color: #E91E8C; font-weight: bold; }
    .btn { display: block; background: linear-gradient(135deg, #E91E8C, #7B2FBE); color: #fff !important; text-decoration: none; text-align: center; padding: 16px 32px; border-radius: 50px; font-size: 18px; font-weight: bold; margin: 24px 0; }
    .note { font-size: 13px; color: #888; }
    .footer { padding: 24px 30px; border-top: 1px solid #2a2a45; text-align: center; }
    .footer p { color: #555; font-size: 13px; margin: 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎵 SuaMúsicaAI</h1>
      <p>Sua música está pronta para download!</p>
    </div>
    <div class="body">
      <p>Olá! 💕</p>
      <p>
        A música personalizada para <span class="name">${nomeDestinatario}</span> ficou incrível!
        Clique no botão abaixo para baixar o MP3 completo:
      </p>
      <a href="${downloadUrl}" class="btn">⬇️ Baixar minha música agora</a>
      <p class="note">
        ⏰ <strong>Importante:</strong> Este link expira em 48 horas por segurança.
        Salve o arquivo no seu celular ou computador assim que baixar.
      </p>
      <p>
        Compartilhe com <span class="name">${nomeDestinatario}</span> e cause aquela emoção inesquecível! 🥺❤️
      </p>
      <p>Com carinho,<br><strong>Equipe SuaMúsicaAI</strong></p>
    </div>
    <div class="footer">
      <p>SuaMúsicaAI • O presente mais emocionante do Brasil 🇧🇷</p>
      <p style="margin-top:8px;"><a href="${appUrl}" style="color:#E91E8C;">Criar outra música</a></p>
    </div>
  </div>
</body>
</html>`.trim();
}

// ── Opção 1: Resend API HTTP (recomendado em cloud) ──
async function sendViaResend({ to, from, subject, html, text }) {
  const res = await axios.post(
    'https://api.resend.com/emails',
    { from, to, subject, html, text },
    {
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    }
  );
  return res.data;
}

// ── Opção 2: SMTP genérico ──
async function sendViaSmtp({ to, from, subject, html, text }) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transporter.sendMail({ from, to, subject, html, text });
}

// ── Opção 3: Gmail ──
async function sendViaGmail({ to, from, subject, html, text }) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
  return transporter.sendMail({ from, to, subject, html, text });
}

/**
 * Envia email com link de download da música.
 * Detecta automaticamente qual provider usar.
 */
async function sendDownloadEmail({ to, nomeDestinatario, downloadUrl, audioUrl }) {
  const appUrl = process.env.APP_URL || 'https://suamusicaai.com.br';
  const from = process.env.EMAIL_FROM || 'SuaMúsicaAI <onboarding@resend.dev>';
  const subject = `🎵 Sua música para ${nomeDestinatario} está pronta para download!`;
  const html = buildHtml({ nomeDestinatario, downloadUrl, appUrl });
  const text = `Sua música para ${nomeDestinatario} está pronta!\n\nDownload: ${downloadUrl}\n\n⏰ Link expira em 48h. Salve o arquivo!\n\nEquipe SuaMúsicaAI`;

  if (process.env.RESEND_API_KEY) {
    console.log(`[email] Enviando via Resend para ${to}`);
    const info = await sendViaResend({ to, from, subject, html, text });
    console.log(`[email] Resend OK: ${info.id}`);
    return info;
  }

  if (process.env.SMTP_HOST) {
    console.log(`[email] Enviando via SMTP (${process.env.SMTP_HOST}) para ${to}`);
    const info = await sendViaSmtp({ to, from, subject, html, text });
    console.log(`[email] SMTP OK: ${info.messageId}`);
    return info;
  }

  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    console.log(`[email] Enviando via Gmail para ${to}`);
    const info = await sendViaGmail({ to, from, subject, html, text });
    console.log(`[email] Gmail OK: ${info.messageId}`);
    return info;
  }

  // Modo log (sem config de email)
  console.log('\n====== [EMAIL - SEM CONFIG] ======');
  console.log('Para:', to);
  console.log('Download URL:', downloadUrl);
  console.log('==========================================\n');
  return { messageId: 'no-config', to };
}

// ── Template: Pacote 3 Músicas ──
function buildPack3Html({ nomeDestinatario, downloadUrls, appUrl }) {
  const buttons = downloadUrls.map((url, i) => `
      <a href="${url}" class="btn">⬇️ Baixar Música ${i + 1}</a>`).join('\n');
  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Seu Pacote 3 Músicas está pronto! 🎵</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0D0D1A; color: #fff; margin: 0; padding: 20px; }
    .container { max-width: 580px; margin: 0 auto; background: #161628; border-radius: 16px; overflow: hidden; }
    .header { background: linear-gradient(135deg, #E91E8C, #7B2FBE); padding: 40px 30px; text-align: center; }
    .header h1 { margin: 0; font-size: 28px; color: #fff; }
    .header p { margin: 8px 0 0; color: rgba(255,255,255,0.85); font-size: 16px; }
    .body { padding: 32px 30px; }
    .body p { color: #ccc; line-height: 1.6; margin: 0 0 16px; }
    .name { color: #E91E8C; font-weight: bold; }
    .btn { display: block; background: linear-gradient(135deg, #E91E8C, #7B2FBE); color: #fff !important; text-decoration: none; text-align: center; padding: 14px 32px; border-radius: 50px; font-size: 17px; font-weight: bold; margin: 12px 0; }
    .note { font-size: 13px; color: #888; }
    .footer { padding: 24px 30px; border-top: 1px solid #2a2a45; text-align: center; }
    .footer p { color: #555; font-size: 13px; margin: 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎵 SuaMúsicaAI</h1>
      <p>Seu Pacote 3 Músicas está pronto!</p>
    </div>
    <div class="body">
      <p>Olá! 💕</p>
      <p>
        Geramos <strong>3 versões únicas</strong> da música personalizada para
        <span class="name">${nomeDestinatario}</span>!
        Escolha a que mais emocionou e compartilhe:
      </p>
      ${buttons}
      <p class="note">
        ⏰ <strong>Importante:</strong> Os links expiram em 48 horas.
        Baixe e salve os arquivos agora!
      </p>
      <p>Com carinho,<br><strong>Equipe SuaMúsicaAI</strong></p>
    </div>
    <div class="footer">
      <p>SuaMúsicaAI • O presente mais emocionante do Brasil 🇧🇷</p>
      <p style="margin-top:8px;"><a href="${appUrl}" style="color:#E91E8C;">Criar outra música</a></p>
    </div>
  </div>
</body>
</html>`.trim();
}

/**
 * Envia email com 3 links de download (Pacote 3 Músicas).
 */
async function sendPack3Email({ to, nomeDestinatario, downloadUrls }) {
  const appUrl  = process.env.APP_URL || 'https://suamusicaai.com.br';
  const from    = process.env.EMAIL_FROM || 'SuaMúsicaAI <onboarding@resend.dev>';
  const subject = `🎵 Seu Pacote 3 Músicas para ${nomeDestinatario} está pronto!`;
  const html    = buildPack3Html({ nomeDestinatario, downloadUrls, appUrl });
  const text    = `Seu Pacote 3 Músicas para ${nomeDestinatario} está pronto!\n\n`
    + downloadUrls.map((url, i) => `Música ${i + 1}: ${url}`).join('\n')
    + '\n\n⏰ Links expiram em 48h. Salve os arquivos!\n\nEquipe SuaMúsicaAI';

  if (process.env.RESEND_API_KEY) {
    console.log(`[email] Enviando Pacote 3 Músicas via Resend para ${to}`);
    const info = await sendViaResend({ to, from, subject, html, text });
    console.log(`[email] Resend OK: ${info.id}`);
    return info;
  }

  if (process.env.SMTP_HOST) {
    console.log(`[email] Enviando Pacote 3 Músicas via SMTP para ${to}`);
    const info = await sendViaSmtp({ to, from, subject, html, text });
    console.log(`[email] SMTP OK: ${info.messageId}`);
    return info;
  }

  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    console.log(`[email] Enviando Pacote 3 Músicas via Gmail para ${to}`);
    const info = await sendViaGmail({ to, from, subject, html, text });
    console.log(`[email] Gmail OK: ${info.messageId}`);
    return info;
  }

  console.log('\n====== [EMAIL PACK3 - SEM CONFIG] ======');
  console.log('Para:', to);
  downloadUrls.forEach((url, i) => console.log(`Música ${i + 1}:`, url));
  console.log('==========================================\n');
  return { messageId: 'no-config', to };
}

module.exports = { sendDownloadEmail, sendPack3Email };
