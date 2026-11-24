const N8N_WEBHOOK_URL = 'http://localhost:5678/webhook-test/predict';

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
  };
});

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
