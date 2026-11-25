const N8N_WEBHOOK_URL = 'http://localhost:5678/webhook/predict';
const EMAILJS_PUBLIC_KEY = 'z_fRa6B1swiyrPFD6';
const EMAILJS_SERVICE_ID = 'service_5hsfx08';
const EMAILJS_TEMPLATE_ID = 'template_e6rfayy';

if (window.emailjs && typeof window.emailjs.init === 'function') {
  window.emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
} else {
  console.error('[UMKMetrics] EmailJS SDK gagal dimuat.');
}

window.addEventListener('load', () => {
  const originalSaveEvaluasi = window.saveEvaluasi;
  if (typeof originalSaveEvaluasi !== 'function') {
    console.error('[UMKMetrics] saveEvaluasi tidak ditemukan; integrasi n8n tidak diaktifkan.');
    return;
  }

  window.saveEvaluasi = async function () {
    if (typeof countUnanswered === 'function' && countUnanswered() > 0) {
      return originalSaveEvaluasi.apply(this, arguments);
    }

    window._lastN8nResult = null;
    window._lastN8nError = null;

    const answers = typeof collectAnswers === 'function' ? collectAnswers() : {};
    const user = typeof AppState !== 'undefined' && AppState.currentUser
      ? AppState.currentUser
      : {};
    const payload = {
      nama_umkm: user.umkm_name || user.nama_umkm || user.displayName || 'UMKM Mitra',
      role: user.role || 'UMKM Mitra',
      ...answers,
    };
    window._lastN8nPayload = payload;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);

    try {
      const response = await fetch(N8N_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`n8n mengembalikan status HTTP ${response.status}.`);
      }

      const result = await response.json();
      window._lastN8nResult = Array.isArray(result) ? result[0] : result;
    } catch (error) {
      window._lastN8nError = error && error.name === 'AbortError'
        ? 'Waktu tunggu webhook n8n habis (12 detik).'
        : (error && error.message) || 'Webhook n8n tidak dapat dihubungi.';
      console.warn('[UMKMetrics] Webhook n8n tidak tersedia; evaluasi tetap disimpan ke Supabase.', window._lastN8nError);
    } finally {
      window.clearTimeout(timeout);
    }

    return originalSaveEvaluasi.apply(this, arguments);
  };

  window.showFeedbackPopup = function (data, elapsed) {
    window._lastEvaluationData = data || {};
    const result = window._lastN8nResult || {};
    const composite = data && data.composite ? data.composite : {};
    const scores = result.scores || (data && data.scores) || {};
    const status = String(result.status_keputusan || composite.category || '--');
    const isIntervention = status.toUpperCase().includes('BUTUH INTERVENSI');
    const isError = !!window._lastN8nError || isIntervention;
    const scoreFallback = Number.isFinite(Number(composite.composite))
      ? Number(composite.composite) * 100
      : Number(composite.scoreOn5) * 20;
    const score = toPercent(result.skor_fundamental, scoreFallback);
    const category = result.kategori || composite.category || '--';
    const mitra = result.mitra
      || (typeof AppState !== 'undefined' && AppState.currentUser &&
        (AppState.currentUser.umkm_name || AppState.currentUser.nama_umkm || AppState.currentUser.displayName))
      || 'UMKM Mitra';
    const recommendation = result.rekomendasi_ai || 'Belum ada rekomendasi AI yang tersedia.';
    const factorLabels = { INS: 'INS', OPS: 'OPS', ECT: 'ECT', OV: 'OV', LDI: 'LDI', WEQ: 'WEQ' };
    const factorRows = Object.keys(factorLabels).map(key => {
      const factorScore = scores[key] !== undefined ? scores[key] : scores[key.toLowerCase()];
      const percent = factorPercent(factorScore);
      return `<div class="n8n-factor">
        <div class="n8n-factor-head"><span class="n8n-label">${factorLabels[key]}</span><span class="n8n-value">${percent}%</span></div>
        <div class="n8n-bar"><div class="n8n-bar-fill" style="width:${percent}%"></div></div>
      </div>`;
    }).join('');

    const popup = document.getElementById('feedbackPopup');
    if (popup) popup.remove();
    const modal = document.createElement('div');
    modal.id = 'feedbackPopup';
    modal.className = 'n8n-feedback-backdrop';
    modal.innerHTML = `
      <section class="n8n-feedback${isError ? ' n8n-feedback-error' : ''}" role="dialog" aria-modal="true" aria-labelledby="n8n-feedback-title">
        <div class="n8n-connection n8n-label">${isError
          ? '[!] N8N WEBHOOK TIDAK TERHUBUNG'
          : '[✓] SUPABASE + N8N WEBHOOK TERHUBUNG'}</div>
        <h2 id="n8n-feedback-title">HASIL EVALUASI</h2>
        <div class="n8n-summary">
          <div class="n8n-field"><span class="n8n-label">MITRA</span><strong>${escapeN8n(mitra)}</strong></div>
          <div class="n8n-field"><span class="n8n-label">KATEGORI</span><strong>${escapeN8n(category)}</strong></div>
          <div class="n8n-field"><span class="n8n-label">STATUS KEPUTUSAN</span><strong>${escapeN8n(status)}</strong></div>
        </div>
        <div class="n8n-score-block">
          <span class="n8n-label">SKOR FUNDAMENTAL</span>
          <div class="n8n-score">${Number.isFinite(score) ? Math.round(score) : '--'}<span>/100</span></div>
          <div class="n8n-bar"><div class="n8n-bar-fill" style="width:${Number.isFinite(score) ? Math.round(score) : 0}%"></div></div>
        </div>
        <div class="n8n-factors">${factorRows}</div>
        <div class="n8n-recommendation"><span class="n8n-label">REKOMENDASI AI</span><p>${escapeN8n(recommendation)}</p></div>
        ${window._lastN8nError ? `<p class="n8n-error-message">${escapeN8n(window._lastN8nError)} Skor komposit Supabase ditampilkan sebagai fallback.</p>` : ''}
        <div class="n8n-email-section">
          <div class="n8n-label">KIRIM LAPORAN KE EMAIL DOSEN</div>
          <div class="n8n-email-compose">
            <input id="n8n-email-recipient" type="email" placeholder="Masukkan email dosen (contoh: dosen@kampus.ac.id)" aria-label="Email dosen" required>
            <button type="button" id="n8n-send-email-btn">KIRIM KE EMAIL DOSEN</button>
          </div>
          <div id="n8n-email-status" class="n8n-email-status" role="status" aria-live="polite"></div>
        </div>
        <div class="n8n-actions">
          <button type="button" class="n8n-primary" onclick="document.getElementById('feedbackPopup').remove();navigate('home')">LIHAT DASHBOARD</button>
          <button type="button" class="n8n-secondary" onclick="document.getElementById('feedbackPopup').remove()">TUTUP</button>
        </div>
      </section>
      <style>
        .n8n-feedback-backdrop{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.9);overflow-y:auto}
        .n8n-feedback,.n8n-feedback *{box-sizing:border-box;border-radius:0!important}
        .n8n-feedback{width:min(100%,560px);max-height:calc(100vh - 32px);overflow-y:auto;padding:24px;background:#0A0A0A;color:#FFFFFF;border:2px solid #FFFFFF;font-family:'Pixelify Sans',monospace}
        .n8n-feedback-error{border-style:dashed}
        .n8n-feedback h2{margin:18px 0;font:600 26px 'Pixelify Sans',monospace;color:#FFFFFF}
        .n8n-label{display:block;color:#FFFFFF;font:400 12px 'Silkscreen',monospace;letter-spacing:.08em;text-transform:uppercase}
        .n8n-connection{padding:10px;border:2px solid #FFFFFF;background:#000000}
        .n8n-feedback-error .n8n-connection{border-style:dashed}
        .n8n-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
        .n8n-field,.n8n-score-block,.n8n-recommendation{padding:12px;border:2px solid #FFFFFF;background:#000000;min-width:0}
        .n8n-field:first-child{grid-column:1/-1}
        .n8n-field strong{display:block;margin-top:6px;overflow-wrap:anywhere;font-weight:500}
        .n8n-score-block{margin-top:12px}
        .n8n-score{margin:4px 0 8px;font:400 48px 'VT323',monospace;line-height:1;color:#FFFFFF}
        .n8n-score span{margin-left:6px;font-size:24px}
        .n8n-bar{height:12px;margin-top:8px;background:#0A0A0A;border:2px solid #FFFFFF;overflow:hidden}
        .n8n-bar-fill{height:100%;background:#FFFFFF}
        .n8n-factors{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:12px}
        .n8n-factor{padding:10px;border:2px solid #FFFFFF;background:#000000}
        .n8n-factor-head{display:flex;justify-content:space-between;gap:8px}
        .n8n-value{font:400 18px 'VT323',monospace;color:#FFFFFF}
        .n8n-recommendation{margin-top:12px}
        .n8n-recommendation p{margin:8px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}
        .n8n-error-message{padding:10px;border:2px dashed #FFFFFF;background:#000000}
        .n8n-email-section{margin-top:18px;padding:12px;border:1px solid #FFFFFF;background:#000000}
        .n8n-email-compose{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;margin-top:10px}
        .n8n-email-compose input,.n8n-email-compose button{min-width:0;min-height:44px;padding:10px;border:1px solid #FFFFFF;border-radius:0;background:#000000;color:#FFFFFF;font:400 12px monospace}
        .n8n-email-compose button{cursor:pointer;font-family:'Silkscreen',monospace}
        .n8n-email-compose button:disabled{opacity:.6;cursor:wait}
        .n8n-email-status{min-height:20px;margin-top:8px;color:#FFFFFF;font:400 12px monospace;overflow-wrap:anywhere}
        .n8n-actions{display:flex;gap:12px;margin-top:18px}
        .n8n-actions button{min-height:44px;padding:10px 14px;border:2px solid #FFFFFF;font:400 12px 'Silkscreen',monospace;letter-spacing:.04em;cursor:pointer}
        .n8n-primary{flex:1;background:#FFFFFF;color:#000000;box-shadow:4px 4px 0 #4A4A4A}
        .n8n-secondary{background:#000000;color:#FFFFFF}
        @media(max-width:480px){.n8n-feedback{padding:16px}.n8n-summary,.n8n-factors{grid-template-columns:1fr}.n8n-field:first-child{grid-column:auto}.n8n-actions{flex-direction:column}}
      </style>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', event => {
      if (event.target === modal) modal.remove();
    });
    modal.querySelector('#n8n-send-email-btn').addEventListener('click', sendEvaluationEmail);
  };
});

async function sendEvaluationEmail(event) {
  const button = event.currentTarget;
  const input = document.getElementById('n8n-email-recipient');
  const status = document.getElementById('n8n-email-status');
  const recipient = input.value.trim();
  if (!input.reportValidity()) return;

  button.disabled = true;
  button.textContent = 'MENGIRIM LAPORAN...';
  status.textContent = '';

  try {
    if (!window.emailjs || typeof window.emailjs.send !== 'function') {
      throw new Error('EmailJS SDK tidak tersedia. Muat ulang halaman dan coba lagi.');
    }

    const evaluation = window._lastEvaluationData || {};
    const result = window._lastN8nResult || {};
    const composite = evaluation.composite || {};
    const fallbackScore = Number.isFinite(Number(composite.composite))
      ? Number(composite.composite) * 100
      : Number(composite.scoreOn5) * 20;
    const score = toPercent(result.skor_fundamental, fallbackScore);
    if (!Number.isFinite(score)) {
      throw new Error('Skor evaluasi tidak tersedia.');
    }
    const roundedScore = Math.round(score);
    const mitra = result.mitra
      || (typeof AppState !== 'undefined' && AppState.currentUser &&
        (AppState.currentUser.umkm_name || AppState.currentUser.nama_umkm || AppState.currentUser.displayName))
      || 'UMKM Mitra';
    const kategori = result.kategori || composite.category || '--';
    const statusKeputusan = result.status_keputusan || composite.category || '--';
    const scores = result.scores || evaluation.scores || {};
    const getScore = key => factorPercent(scores[key] !== undefined ? scores[key] : scores[key.toLowerCase()]);
    let persona;

    if (roundedScore >= 80) {
      persona = {
        persona_badge: 'PERSONA: VISIONARY SCALER (SIAP TUMBUH)',
        persona_narasi: 'Sebagai pemimpin usaha pada ' + mitra + ', fondasi sumber daya dan operasional Anda sudah terstandarisasi dengan sangat baik. Tantangan utama Anda bukan lagi bertahan hidup, melainkan menjaga konsistensi kualitas saat membuka kanal distribusi atau cabang baru.',
        langkah_1: 'Replikasi SOP operasional yang sudah berjalan ke lini produk atau cabang baru.',
        langkah_2: 'Alokasikan surplus arus kas untuk ekspansi pemasaran digital dan kemitraan B2B.',
        langkah_3: 'Lakukan evaluasi berkala bersama pegawai agar budaya kerja tetap selaras.',
      };
    } else if (roundedScore >= 60) {
      persona = {
        persona_badge: 'PERSONA: RESILIENT BUILDER (FASE KONSOLIDASI)',
        persona_narasi: 'Sebagai pengelola ' + mitra + ', bisnis Anda memiliki daya tahan yang baik dan arus transaksi yang berjalan, namun masih bergantung pada kontrol harian pemilik. Sebelum melakukan ekspansi, fokus utama Anda adalah merapikan efisiensi biaya dan dokumentasi kerja.',
        langkah_1: 'Audit ulang struktur HPP dan negosiasi ulang kontrak pemasok bahan baku utama.',
        langkah_2: 'Susun SOP tertulis untuk alur kerja harian agar tidak bergantung pada satu individu.',
        langkah_3: 'Ajak pegawai mengisi kuesioner faktor internal (OV, LDI, WEQ) untuk memetakan kebutuhan tim.',
      };
    } else {
      persona = {
        persona_badge: 'PERSONA: SURVIVAL NAVIGATOR (PRIORITAS PEMULIHAN)',
        persona_narasi: 'Saat ini ' + mitra + ' berada pada fase krusial yang membutuhkan keputusan cepat dan terukur. Prioritas utama Anda sebagai pemilik usaha adalah mengamankan likuiditas kas, memangkas pemborosan operasional, dan membangun ulang ritme komunikasi tim.',
        langkah_1: 'Hentikan sementara pengeluaran non-esensial dan pisahkan pencatatan kas pribadi vs usaha.',
        langkah_2: 'Tetapkan target evaluasi mingguan untuk memantau perbaikan indikator terendah.',
        langkah_3: 'Lakukan briefing rutin dengan seluruh pegawai untuk menyelaraskan target penyelamatan usaha.',
      };
    }

    const templateParams = {
      to_email: recipient,
      tanggal: new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date()),
      mitra,
      skor_fundamental: roundedScore,
      kategori,
      status_keputusan: statusKeputusan,
      ...persona,
      ins: getScore('INS'),
      ops: getScore('OPS'),
      ect: getScore('ECT'),
      ov: getScore('OV'),
      ldi: getScore('LDI'),
      weq: getScore('WEQ'),
      rekomendasi_ai: result.rekomendasi_ai || 'Belum ada rekomendasi AI yang tersedia.',
    };
    await window.emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, templateParams);
    status.textContent = `[✓] LAPORAN BERHASIL DIKIRIM KE ${recipient}`;
    button.textContent = 'LAPORAN TERKIRIM';
  } catch (error) {
    const message = (error && (error.text || error.message)) || 'Periksa konfigurasi EmailJS lalu coba lagi.';
    console.error('[UMKMetrics] Gagal mengirim laporan melalui EmailJS.', error);
    status.textContent = `[!] GAGAL MENGIRIM LAPORAN: ${message}`;
    button.disabled = false;
    button.textContent = 'KIRIM KE EMAIL DOSEN';
  }
}

function toPercent(value, fallback) {
  const number = Number(value);
  const candidate = value !== null && value !== undefined && value !== '' && Number.isFinite(number)
    ? number
    : fallback;
  return Number.isFinite(candidate) ? Math.max(0, Math.min(100, candidate)) : NaN;
}

function factorPercent(score) {
  if (score && typeof score === 'object') {
    if (score.normScore !== undefined) return toPercent(Number(score.normScore) * 100, 0);
    if (score.scoreOn5 !== undefined) return toPercent(Number(score.scoreOn5) * 20, 0);
    score = score.score !== undefined ? score.score : score.value;
  }
  const number = Number(score);
  if (!Number.isFinite(number)) return 0;
  return toPercent(number <= 1 ? number * 100 : number <= 5 ? number * 20 : number, 0);
}

function escapeN8n(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
