// Utilidades compartilhadas entre a página pública e o painel admin.

window.sb = window.supabase.createClient(RIFA_CONFIG.supabase.url, RIFA_CONFIG.supabase.anonKey);

window.U = {
  brl(v) {
    return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  },
  pad(n, total) {
    return String(n).padStart(String(total || 500).length, '0');
  },
  esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },
  soDigitos(s) {
    return String(s || '').replace(/\D/g, '');
  },
  fone(s) {
    const d = U.soDigitos(s).replace(/^55(?=\d{10,11}$)/, '');
    if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return s || '';
  },
  // Link wa.me sempre com DDI 55
  wa(fone, texto) {
    let d = U.soDigitos(fone);
    if (d && !d.startsWith('55')) d = '55' + d;
    return `https://wa.me/${d}${texto ? '?text=' + encodeURIComponent(texto) : ''}`;
  },
  data(iso, comHora = true) {
    if (!iso) return '';
    const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
    return comHora ? d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : d.toLocaleDateString('pt-BR');
  },
  // "1, 5, 10-15" -> [1,5,10,11,12,13,14,15]
  faixa(txt) {
    const out = new Set();
    String(txt || '').split(/[,;\s]+/).filter(Boolean).forEach(p => {
      const m = p.match(/^(\d+)-(\d+)$/);
      if (m) { for (let i = +m[1]; i <= +m[2]; i++) out.add(i); }
      else if (/^\d+$/.test(p)) out.add(+p);
    });
    return [...out].sort((a, b) => a - b);
  },
  erro(e) {
    const msg = e?.message || String(e);
    if (/Failed to fetch|NetworkError/i.test(msg)) return 'Sem conexão. Verifique sua internet e tente de novo.';
    return msg;
  },
  toast(msg, ms = 2600) {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('show'), ms);
  },
  async copiar(txt) {
    try { await navigator.clipboard.writeText(txt); U.toast('Copiado!'); }
    catch { U.toast('Selecione o texto e copie manualmente.'); }
  },
  storage: {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem storage */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* sem storage */ } }
  }
};

// Regra de conversão Loteria Federal -> número da rifa (espelha rifa_sortear no banco)
U.federalParaNumero = function (premio, total) {
  const d = U.soDigitos(premio);
  if (d.length < 3) return null;
  let n = parseInt(d.slice(-3), 10);
  if (n === 0) n = 1000;
  while (n > total) n -= total;
  return n;
};
