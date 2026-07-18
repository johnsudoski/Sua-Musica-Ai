/**
 * Geração de QR code para a página de revelação (ouvir.html).
 * Nunca lança erro pra fora -- se falhar, o email/entrega segue sem o QR.
 */

const QRCode = require('qrcode');

async function generateQrDataUri(url) {
  try {
    return await QRCode.toDataURL(url, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 400,
      color: { dark: '#3a2e22', light: '#fdf6ecff' },
    });
  } catch (err) {
    console.error('[qrGenerator] Falha ao gerar QR code:', err.message);
    return null;
  }
}

module.exports = { generateQrDataUri };
