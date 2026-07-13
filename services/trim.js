/**
 * Corte de áudio no servidor — usado para gerar o preview grátis (40s)
 * sem nunca expor ao navegador a URL da música completa.
 */

const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

ffmpeg.setFfmpegPath(ffmpegPath);

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
