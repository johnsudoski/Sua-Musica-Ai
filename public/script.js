/* ═══════════════════════════════════════════════
   SuaMúsicaAI — Frontend Logic
   Fluxo: POST /generate-preview → jobId → poll /preview-status/:jobId → showPreview
═══════════════════════════════════════════════ */

var API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:3000'
  : '';

// ─── FAQ accordion ───
document.querySelectorAll('.faq-q').forEach(function(btn) {
  btn.addEventListener('click', function() {
    var item = btn.closest('.faq-item');
    var isOpen = item.classList.contains('open');
    document.querySelectorAll('.faq-item.open').forEach(function(i) { i.classList.remove('open'); });
    if (!isOpen) item.classList.add('open');
  });
});

// ─── Contador de caracteres ───
var textarea = document.getElementById('memoria');
var charCountEl = document.getElementById('charCount');
if (textarea && charCountEl) {
  textarea.addEventListener('input', function() {
    charCountEl.textContent = textarea.value.length;
  });
}

// ─── Estado ───
var _orderId      = null;
var _previewUrl   = null;
var _pollTO       = null;
var _pollDone     = false;
var _loadTimerTO  = null;
var _loadTimerSec = 0;
var _previewTO    = null;
var _previewSec   = 0;
var _audioPlaying = false;

// ─── DOM ───
var form           = document.getElementById('musicForm');
var generateBtn    = document.getElementById('generateBtn');
var loadingSection = document.getElementById('loadingSection');
var loadingText    = document.getElementById('loadingText');
var previewSection = document.getElementById('previewSection');
var playBtn        = document.getElementById('playBtn');
var buyBtnMp3      = document.getElementById('buyBtnMp3');
var buyBtnVideo    = document.getElementById('buyBtnVideo');
var audioEl        = document.getElementById('previewAudio');

// ─── Timer de carregamento (setTimeout recursivo) ───
function startLoadTimer() {
  _loadTimerSec = 0;
  function tick() {
    _loadTimerSec++;
    var el = document.getElementById('loadingTimer');
    if (el) el.textContent = _loadTimerSec + 's';
    if (loadingText) {
      if (_loadTimerSec < 30) {
        loadingText.innerHTML = 'Compondo a letra com a história de vocês... <span id="loadingTimer">' + _loadTimerSec + 's</span>';
      } else if (_loadTimerSec < 70) {
        loadingText.innerHTML = 'Criando a melodia e os arranjos... <span id="loadingTimer">' + _loadTimerSec + 's</span>';
      } else {
        loadingText.innerHTML = 'Finalizando sua música única... <span id="loadingTimer">' + _loadTimerSec + 's</span>';
      }
    }
    _loadTimerTO = setTimeout(tick, 1000);
  }
  _loadTimerTO = setTimeout(tick, 1000);
}

function stopLoadTimer() {
  if (_loadTimerTO) { clearTimeout(_loadTimerTO); _loadTimerTO = null; }
}

// ─── Polling do status do job (setTimeout recursivo — sem setInterval) ───
function startPolling(jobId, nome) {
  _pollDone = false;

  function doPoll() {
    if (_pollDone) return;

    fetch(API_BASE + '/api/preview-status/' + jobId)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (_pollDone) return;

        if (data.status === 'ready' && data.previewUrl) {
          _pollDone = true;
          stopLoadTimer();
          _orderId = data.orderId || _orderId;
          showPreview(data.previewUrl, nome);

        } else if (data.status === 'error') {
          _pollDone = true;
          stopLoadTimer();
          resetUI('Não conseguimos gerar a música. Tente novamente em instantes.');

        } else {
          // Ainda gerando — tenta novamente em 5s
          _pollTO = setTimeout(doPoll, 5000);
        }
      })
      .catch(function() {
        if (!_pollDone) _pollTO = setTimeout(doPoll, 6000);
      });
  }

  // Primeira checagem após 15s (a geração leva ~60-90s total)
  _pollTO = setTimeout(doPoll, 15000);
}

// ─── Mostrar preview ───
function showPreview(url, nome) {
  _previewUrl = url;

  if (loadingSection) loadingSection.classList.add('hidden');
  if (previewSection) {
    previewSection.classList.remove('hidden');
    previewSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  if (generateBtn) {
    generateBtn.disabled  = false;
    generateBtn.textContent = '🎧 Criar outra música';
  }

  // Configurar áudio
  if (audioEl) {
    audioEl.src = url;
    audioEl.load();

    // Limitar a 30 segundos
    audioEl.addEventListener('timeupdate', function() {
      if (audioEl.currentTime >= 30) {
        audioEl.pause();
        audioEl.currentTime = 30;
        _audioPlaying = false;
        if (playBtn) playBtn.textContent = '▶ Ouvir preview novamente';
        showPost30(nome);
      }
    });

    // Tentar auto-play
    var pp = audioEl.play();
    if (pp && typeof pp.catch === 'function') {
      pp.then(function() { _audioPlaying = true; if (playBtn) playBtn.textContent = '⏸ Pausar'; })
        .catch(function() {
          if (playBtn) playBtn.textContent = '▶ Toque para ouvir os primeiros 30 segundos';
        });
    }
  }
}

// ─── CTA pós-30 segundos ───
function showPost30(nome) {
  var post30 = document.getElementById('post30Cta');
  if (!post30) return;
  var nomeEl = document.getElementById('post30Nome');
  if (nomeEl && nome) nomeEl.textContent = nome;
  post30.style.display = 'block';
  post30.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ─── Resetar UI após erro ───
function resetUI(msg) {
  stopLoadTimer();
  if (loadingSection) loadingSection.classList.add('hidden');
  if (generateBtn) {
    generateBtn.disabled  = false;
    generateBtn.textContent = '🎧 Ouvir meu preview grátis agora';
  }
  if (msg) alert(msg);
}

// ─── Botão play/pause ───
if (playBtn) {
  playBtn.addEventListener('click', function() {
    if (!audioEl || !audioEl.src) return;
    if (_audioPlaying) {
      audioEl.pause();
      _audioPlaying = false;
      playBtn.textContent = '▶ Ouvir preview grátis';
    } else {
      if (audioEl.currentTime >= 30) audioEl.currentTime = 0;
      audioEl.play().then(function() {
        _audioPlaying = true;
        playBtn.textContent = '⏸ Pausar';
      }).catch(function() {});
    }
  });
}

// ─── Submit do formulário ───
if (form) {
  form.addEventListener('submit', function(e) {
    e.preventDefault();

    var nome    = (document.getElementById('nomeDestinatario') || {value:''}).value.trim();
    var relacao = (document.getElementById('relacao') || {value:''}).value;
    var memoria = (document.getElementById('memoria') || {value:''}).value.trim();
    var gEl     = document.querySelector('input[name="genero"]:checked');
    var genero  = gEl ? gEl.value : '';
    var email   = (document.getElementById('emailEntrega') || {value:''}).value.trim();

    if (!nome || !relacao || !memoria) {
      alert('Preencha todos os campos para criar a música 🎵');
      return;
    }
    if (!genero) {
      alert('Escolha um estilo musical 🎸');
      return;
    }

    // Reset de estado anterior
    _pollDone = false;
    if (_pollTO) { clearTimeout(_pollTO); _pollTO = null; }
    if (audioEl) { audioEl.pause(); audioEl.src = ''; }
    _audioPlaying = false;
    _previewUrl   = null;

    // UI: loading
    if (generateBtn) { generateBtn.disabled = true; generateBtn.textContent = '⏳ Criando sua música...'; }
    if (loadingSection) loadingSection.classList.remove('hidden');
    if (previewSection) previewSection.classList.add('hidden');
    var p30 = document.getElementById('post30Cta');
    if (p30) p30.style.display = 'none';
    if (loadingSection) loadingSection.scrollIntoView({ behavior: 'smooth', block: 'center' });

    startLoadTimer();

    // POST → recebe jobId imediatamente (~2s)
    fetch(API_BASE + '/api/generate-preview', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        nomeDestinatario: nome,
        relacao:          relacao,
        memoria:          memoria,
        genero:           genero,
        emailEntrega:     email,
      }),
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.success || !data.jobId) {
        throw new Error(data.error || 'Erro ao iniciar geração');
      }
      _orderId = data.orderId;
      startPolling(data.jobId, nome);
    })
    .catch(function(err) {
      resetUI('Ops! ' + (err.message || 'Erro inesperado') + '. Tente novamente.');
    });
  });
}

// ─── Abrir checkout ───
function openCheckout(productType) {
  var email = (document.getElementById('emailEntrega') || {value:''}).value;
  var nome  = (document.getElementById('nomeDestinatario') || {value:''}).value;

  if (_orderId) sessionStorage.setItem('sua_musica_orderId', _orderId);
  if (nome)     sessionStorage.setItem('sua_musica_nome', nome);
  if (_previewUrl) sessionStorage.setItem('sua_musica_previewUrl', _previewUrl);
  sessionStorage.setItem('sua_musica_product', productType);

  var checkoutUrls = {
    mp3:   window._checkoutUrlMp3   || window._checkoutUrl || 'https://checkout.ticto.app/OD11F0BEB',
    video: window._checkoutUrlVideo || 'https://checkout.ticto.app/OD8AA1433',
  };
  var baseUrl = checkoutUrls[productType] || checkoutUrls.mp3;

  try {
    var url = new URL(baseUrl);
    if (_orderId) url.searchParams.set('utm_campaign', _orderId);
    if (email)    url.searchParams.set('email', email);
    window.open(url.toString(), '_blank');
  } catch(_) {
    window.open(baseUrl, '_blank');
  }
}

if (buyBtnMp3)   buyBtnMp3.addEventListener('click',   function() { openCheckout('mp3');   });
if (buyBtnVideo) buyBtnVideo.addEventListener('click',  function() { openCheckout('video'); });

// ─── Links → scroll para formulário ───
document.querySelectorAll('a[href="#criar"]').forEach(function(link) {
  link.addEventListener('click', function(e) {
    e.preventDefault();
    var el = document.getElementById('criar');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  });
});

// ─── Esconder botão flutuante quando botão principal estiver visível ───
var floatCta = document.getElementById('floatCta');
var mainBtn  = document.getElementById('generateBtn');
function checkFloat() {
  if (!mainBtn || !floatCta) return;
  var r = mainBtn.getBoundingClientRect();
  floatCta.style.display = (r.top >= 0 && r.bottom <= window.innerHeight) ? 'none' : 'flex';
}
window.addEventListener('scroll', checkFloat, { passive: true });
checkFloat();

// ─── Carregar URLs de checkout do backend ───
fetch(API_BASE + '/api/config')
  .then(function(r) { return r.json(); })
  .then(function(cfg) {
    if (cfg.checkoutUrl)      window._checkoutUrl      = cfg.checkoutUrl;
    if (cfg.checkoutUrlMp3)   window._checkoutUrlMp3   = cfg.checkoutUrlMp3;
    if (cfg.checkoutUrlVideo) window._checkoutUrlVideo = cfg.checkoutUrlVideo;
  })
  .catch(function() {});
