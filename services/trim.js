/**
 * Corte de áudio no servidor — usado para gerar o preview grátis (40s)
 * sem nunca expor ao navegador a URL da música completa.
 */

const { execSync } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');

// Prioriza o ffmpeg do sistema (instalado via nixpacks.toml no Railway — build nativo
// pro container, sem os SIGSEGV que o binário estático do @ffmpeg-installer costuma dar
// em alguns ambientes Linux). Só cai pro binário do pacote npm em dev local (ex: Windows).
try {
  execSync('ffmpeg -version', { stdio: 'ignore' });
} catch {
  ffmpeg.setFfmpegPath(require('@ffmpeg-installer/ffmpeg').path);
}

/**
 * Baixa `sourceUrl` e grava em `outputPath` já cortado para os primeiros `seconds` segundos.
 * ffmpeg lê a URL remota diretamente (sem passo intermediário de download).
 */
function trimToFile(sourceUrl, outputPath, seconds = 40) {
  return new Promise((resolve, reject) => {
    ffmpeg(sourceUrl)
      .setStartTime(0)
      .duration(seconds)
      .audioCodec('libmp3lame')
      .format('mp3')
      .on('error', reject)
      .on('end', () => resolve(outputPath))
      .save(outputPath);
  });
}

module.exports = { trimToFile };
