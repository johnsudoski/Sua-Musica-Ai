/**
 * Serviço de email — entrega do link de download após pagamento
 *
 * Tenta em cascata: Resend → SMTP → Gmail. Antes, só tentava o PRIMEIRO
 * provider configurado e desistia se ele falhasse -- foi assim que um
 * cliente real ficou sem receber o email quando o Resend rejeitou o envio
 * (domínio não verificado só permite mandar pro dono da conta) mesmo com
 * Gmail configurado e funcional como alternativa.
 */

const axios = require('axios');
const nodemailer = require('nodemailer');
const { generateQrDataUri } = require('./qrGenerator');

function buildQrSection({ qrDataUri, listenUrl }) {
  if (!qrDataUri || !listenUrl) return '';
  return `
      <div style="background:#1c1830;border:1px solid rgba(233,30,140,0.25);border-radius:16px;padding:24px;text-align:center;margin:24px 0;">
        <p style="color:#fff;font-weight:bold;font-size:15px;margin:0 0 12px;">📱 Ou escaneie pra ouvir na hora</p>
        <img src="${qrDataUri}" alt="QR code para ouvir a música" width="180" height="180" style="border-radius:12px;background:#fdf6ec;padding:8px;" />
        <p style="color:#888;font-size:12px;margin:12px 0 0;">Aponte a câmera do celular pro código, ou <a href="${listenUrl}" style="color:#E91E8C;">clique aqui</a></p>
      </div>`;
}

function buildLetterSection({ letterUrl }) {
  if (!letterUrl) return '';
  return `
      <div style="background:linear-gradient(135deg,rgba(233,30,140,0.12),rgba(123,47,190,0.12));border:1px solid rgba(233,30,140,0.3);border-radius:16px;padding:22px;text-align:center;margin:24px 0;">
        <p style="color:#fff;font-weight:bold;font-size:15px;margin:0 0 6px;">💌 Bônus do Pacote Presente</p>
        <p style="color:#ccc;font-size:13px;margin:0 0 14px;">Sua carta de amor escrita por IA já está pronta e liberada — sem custo extra.</p>
        <a href="${letterUrl}" style="display:inline-block;background:#fff;color:#7B2FBE;text-decoration:none;padding:12px 26px;border-radius:50px;font-size:14px;font-weight:bold;">💌 Ler minha carta</a>
      </div>`;
}

function buildHtml({ nomeDestinatario, downloadUrl, appUrl, qrDataUri, listenUrl, reviewUrl, letterUrl }) {
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
      ${buildQrSection({ qrDataUri, listenUrl })}
      ${buildLetterSection({ letterUrl })}
      <p>
        Compartilhe com <span class="name">${nomeDestinatario}</span> e cause aquela emoção inesquecível! 🥺❤️
      </p>
      <p>Com carinho,<br><strong>Equipe SuaMúsicaAI</strong></p>
    </div>
    <div class="footer">
      <p>SuaMúsicaAI • O presente mais emocionante do Brasil 🇧🇷</p>
      ${typeof reviewUrl !== 'undefined' && reviewUrl ? `<p style="margin-top:8px;"><a href="${reviewUrl}" style="color:#E91E8C;">⭐ Já ouviu? Conta pra gente como foi</a></p>` : ''}
      <p style="margin-top:8px;"><a href="${appUrl}" style="color:#E91E8C;">Criar outra música</a></p>
      <p style="margin-top:8px;">Dúvidas? <a href="mailto:suportesuamusicaai@gmail.com" style="color:#888;">suportesuamusicaai@gmail.com</a></p>
    </div>
  </div>
</body>
</html>`.trim();
}

// ── Opção 1: Resend API HTTP (recomendado em cloud, mas exige domínio verificado) ──
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

// ── Opção 3: Gmail (sem a restrição de domínio do Resend em modo teste) ──
async function sendViaGmail({ to, from, subject, html, text }) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
  return transporter.sendMail({ from, to, subject, html, text });
}

/**
 * Envia por Resend -> SMTP -> Gmail, em cascata. Só desiste se TODOS os
 * providers configurados falharem (não só o primeiro).
 */
async function dispatchEmail({ to, subject, html, text, logLabel = '' }) {
  const errors = [];
  const label = logLabel ? `${logLabel} ` : '';

  if (process.env.RESEND_API_KEY) {
    try {
      const from = process.env.EMAIL_FROM || 'SuaMúsicaAI <onboarding@resend.dev>';
      console.log(`[email] Enviando ${label}via Resend para ${to}`);
      const info = await sendViaResend({ to, from, subject, html, text });
      console.log(`[email] Resend OK: ${info.id}`);
      return info;
    } catch (err) {
      const msg = err.response?.data?.message || err.message;
      console.error(`[email] Resend falhou (${msg}) — tentando próximo provider`);
      errors.push(`Resend: ${msg}`);
    }
  }

  if (process.env.SMTP_HOST) {
    try {
      const from = process.env.EMAIL_FROM || 'SuaMúsicaAI <onboarding@resend.dev>';
      console.log(`[email] Enviando ${label}via SMTP (${process.env.SMTP_HOST}) para ${to}`);
      const info = await sendViaSmtp({ to, from, subject, html, text });
      console.log(`[email] SMTP OK: ${info.messageId}`);
      return info;
    } catch (err) {
      console.error(`[email] SMTP falhou (${err.message}) — tentando próximo provider`);
      errors.push(`SMTP: ${err.message}`);
    }
  }

  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    try {
      const from = `SuaMúsicaAI <${process.env.GMAIL_USER}>`;
      console.log(`[email] Enviando ${label}via Gmail para ${to}`);
      const info = await sendViaGmail({ to, from, subject, html, text });
      console.log(`[email] Gmail OK: ${info.messageId}`);
      return info;
    } catch (err) {
      console.error(`[email] Gmail falhou (${err.message})`);
      errors.push(`Gmail: ${err.message}`);
    }
  }

  console.log(`\n====== [EMAIL ${logLabel} — TODOS OS PROVIDERS FALHARAM OU SEM CONFIG] ======`);
  console.log('Para:', to);
  if (errors.length) console.log('Erros:', errors.join(' | '));
  console.log('==========================================\n');

  if (errors.length) {
    throw new Error(`Falha ao enviar email (${errors.join(' | ')})`);
  }
  return { messageId: 'no-config', to };
}

/**
 * Envia email com link de download da música.
 * downloadToken (opcional) gera um QR code pra página de revelação
 * (ouvir.html) -- nunca bloqueia o envio se a geração do QR falhar.
 */
async function sendDownloadEmail({ to, nomeDestinatario, downloadUrl, audioUrl, downloadToken, letterUrl }) {
  const appUrl  = process.env.APP_URL || 'https://suamusicaai.com.br';
  const subject = `🎵 Sua música para ${nomeDestinatario} está pronta para download!`;

  let qrDataUri = null;
  let listenUrl = null;
  let reviewUrl = null;
  if (downloadToken) {
    listenUrl = `${appUrl}/ouvir.html?token=${downloadToken}`;
    reviewUrl = `${appUrl}/avaliar.html?token=${downloadToken}`;
    qrDataUri = await generateQrDataUri(listenUrl).catch(() => null);
  }

  const html = buildHtml({ nomeDestinatario, downloadUrl, appUrl, qrDataUri, listenUrl, reviewUrl, letterUrl });
  const text = `Sua música para ${nomeDestinatario} está pronta!\n\nDownload: ${downloadUrl}${listenUrl ? `\nOuvir na hora: ${listenUrl}` : ''}${letterUrl ? `\n💌 Bônus - sua carta de amor: ${letterUrl}` : ''}\n\n⏰ Link expira em 48h. Salve o arquivo!\n\nEquipe SuaMúsicaAI`;
  return dispatchEmail({ to, subject, html, text, logLabel: '' });
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
      ${typeof reviewUrl !== 'undefined' && reviewUrl ? `<p style="margin-top:8px;"><a href="${reviewUrl}" style="color:#E91E8C;">⭐ Já ouviu? Conta pra gente como foi</a></p>` : ''}
      <p style="margin-top:8px;"><a href="${appUrl}" style="color:#E91E8C;">Criar outra música</a></p>
      <p style="margin-top:8px;">Dúvidas? <a href="mailto:suportesuamusicaai@gmail.com" style="color:#888;">suportesuamusicaai@gmail.com</a></p>
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
  const subject = `🎵 Seu Pacote 3 Músicas para ${nomeDestinatario} está pronto!`;
  const html    = buildPack3Html({ nomeDestinatario, downloadUrls, appUrl });
  const text    = `Seu Pacote 3 Músicas para ${nomeDestinatario} está pronto!\n\n`
    + downloadUrls.map((url, i) => `Música ${i + 1}: ${url}`).join('\n')
    + '\n\n⏰ Links expiram em 48h. Salve os arquivos!\n\nEquipe SuaMúsicaAI';
  return dispatchEmail({ to, subject, html, text, logLabel: 'Pacote 3 Músicas' });
}

// ── Template: MP3 + Vídeo com Letra ──
function buildVideoHtml({ nomeDestinatario, mp3DownloadUrl, videoDownloadUrl, appUrl }) {
  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sua música + vídeo com letra estão prontos! 🎵</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0D0D1A; color: #fff; margin: 0; padding: 20px; }
    .container { max-width: 580px; margin: 0 auto; background: #161628; border-radius: 16px; overflow: hidden; }
    .header { background: linear-gradient(135deg, #E91E8C, #7B2FBE); padding: 40px 30px; text-align: center; }
    .header h1 { margin: 0; font-size: 28px; color: #fff; }
    .header p { margin: 8px 0 0; color: rgba(255,255,255,0.85); font-size: 16px; }
    .body { padding: 32px 30px; }
    .body p { color: #ccc; line-height: 1.6; margin: 0 0 16px; }
    .name { color: #E91E8C; font-weight: bold; }
    .btn { display: block; color: #fff !important; text-decoration: none; text-align: center; padding: 15px 32px; border-radius: 50px; font-size: 17px; font-weight: bold; margin: 12px 0; }
    .btn-mp3 { background: linear-gradient(135deg, #E91E8C, #7B2FBE); }
    .btn-video { background: linear-gradient(135deg, #7B2FBE, #3D0E6B); border: 2px solid #E91E8C; }
    .divider { border: none; border-top: 1px solid #2a2a45; margin: 24px 0; }
    .note { font-size: 13px; color: #888; }
    .footer { padding: 24px 30px; border-top: 1px solid #2a2a45; text-align: center; }
    .footer p { color: #555; font-size: 13px; margin: 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎵 SuaMúsicaAI</h1>
      <p>Música + vídeo com letra prontos para você!</p>
    </div>
    <div class="body">
      <p>Olá! 💕</p>
      <p>
        A música personalizada para <span class="name">${nomeDestinatario}</span> ficou incrível!
        Você recebeu <strong>dois arquivos</strong>:
      </p>
      <p><strong>🎵 MP3 — áudio completo</strong></p>
      <a href="${mp3DownloadUrl}" class="btn btn-mp3">⬇️ Baixar MP3 agora</a>
      <hr class="divider">
      <p><strong>🎬 MP4 — vídeo animado com letra</strong><br>
        <span style="font-size:13px;color:#aaa;">Perfeito para enviar no WhatsApp, Stories do Instagram e TikTok!</span>
      </p>
      <a href="${videoDownloadUrl}" class="btn btn-video">🎬 Baixar Vídeo com Letra</a>
      <p class="note" style="margin-top:20px;">
        ⏰ <strong>Importante:</strong> Os links expiram em 48 horas.
        Baixe e salve os arquivos agora!
      </p>
      <p>
        Cause aquela emoção inesquecível em <span class="name">${nomeDestinatario}</span>! 🥺❤️
      </p>
      <p>Com carinho,<br><strong>Equipe SuaMúsicaAI</strong></p>
    </div>
    <div class="footer">
      <p>SuaMúsicaAI • O presente mais emocionante do Brasil 🇧🇷</p>
      ${typeof reviewUrl !== 'undefined' && reviewUrl ? `<p style="margin-top:8px;"><a href="${reviewUrl}" style="color:#E91E8C;">⭐ Já ouviu? Conta pra gente como foi</a></p>` : ''}
      <p style="margin-top:8px;"><a href="${appUrl}" style="color:#E91E8C;">Criar outra música</a></p>
      <p style="margin-top:8px;">Dúvidas? <a href="mailto:suportesuamusicaai@gmail.com" style="color:#888;">suportesuamusicaai@gmail.com</a></p>
    </div>
  </div>
</body>
</html>`.trim();
}

/**
 * Envia email com MP3 + vídeo com letra (produto Vídeo com Letra).
 */
async function sendVideoEmail({ to, nomeDestinatario, mp3DownloadUrl, videoDownloadUrl }) {
  const appUrl  = process.env.APP_URL || 'https://suamusicaai.com.br';
  const subject = `🎵🎬 Sua música + vídeo com letra para ${nomeDestinatario} estão prontos!`;
  const html    = buildVideoHtml({ nomeDestinatario, mp3DownloadUrl, videoDownloadUrl, appUrl });
  const text    = `Sua música + vídeo para ${nomeDestinatario} estão prontos!\n\n`
    + `MP3: ${mp3DownloadUrl}\nVídeo: ${videoDownloadUrl}\n\n`
    + '⏰ Links expiram em 48h. Baixe agora!\n\nEquipe SuaMúsicaAI';
  return dispatchEmail({ to, subject, html, text, logLabel: 'Vídeo+MP3' });
}

// ── Template: Créditos liberados (Pacote 3 Músicas) ──
function buildCreditsHtml({ balance, creditsUrl }) {
  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Seus créditos estão liberados! 🎵</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0D0D1A; color: #fff; margin: 0; padding: 20px; }
    .container { max-width: 580px; margin: 0 auto; background: #161628; border-radius: 16px; overflow: hidden; }
    .header { background: linear-gradient(135deg, #E91E8C, #7B2FBE); padding: 40px 30px; text-align: center; }
    .header h1 { margin: 0; font-size: 28px; color: #fff; }
    .header p { margin: 8px 0 0; color: rgba(255,255,255,0.85); font-size: 16px; }
    .body { padding: 32px 30px; }
    .body p { color: #ccc; line-height: 1.6; margin: 0 0 16px; }
    .balance { color: #E91E8C; font-weight: bold; font-size: 22px; }
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
      <p>Seu Pacote 3 Músicas está liberado!</p>
    </div>
    <div class="body">
      <p>Olá! 💕</p>
      <p>
        Sua compra foi confirmada. Você tem <span class="balance">${balance} música${balance === 1 ? '' : 's'}</span>
        disponíve${balance === 1 ? 'l' : 'is'} para criar quando quiser, uma de cada vez.
      </p>
      <a href="${creditsUrl}" class="btn">🎶 Criar minha música agora</a>
      <p class="note">
        Use o mesmo email desta compra na página acima para acessar seus créditos.
      </p>
      <p>Com carinho,<br><strong>Equipe SuaMúsicaAI</strong></p>
    </div>
    <div class="footer">
      <p>SuaMúsicaAI • O presente mais emocionante do Brasil 🇧🇷</p>
      <p style="margin-top:8px;">Dúvidas? <a href="mailto:suportesuamusicaai@gmail.com" style="color:#888;">suportesuamusicaai@gmail.com</a></p>
    </div>
  </div>
</body>
</html>`.trim();
}

/**
 * Envia email avisando que os créditos do Pacote 3 Músicas foram liberados.
 */
async function sendCreditsEmail({ to, balance, creditsUrl }) {
  const subject = `🎵 Seus ${balance} créditos de música estão liberados!`;
  const html    = buildCreditsHtml({ balance, creditsUrl });
  const text    = `Sua compra foi confirmada! Você tem ${balance} música(s) disponível(is).\n\nCrie agora: ${creditsUrl}\n\nUse o mesmo email desta compra.\n\nEquipe SuaMúsicaAI`;
  return dispatchEmail({ to, subject, html, text, logLabel: 'créditos' });
}

module.exports = { sendDownloadEmail, sendPack3Email, sendVideoEmail, sendCreditsEmail };
