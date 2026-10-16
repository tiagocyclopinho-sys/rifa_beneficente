// Página pública: escolher números, reservar, pagar com Pix.

(function () {
  const $ = id => document.getElementById(id);
  const CHAVE_PEDIDO = 'rifa_pedido_aberto';

  let cfg = null;
  let pagos = new Set();
  let reservados = new Set();
  const sel = new Set();
  let filtro = 'todos';
  let botoes = [];
  let pedido = null;      // pedido em pagamento (retorno de rifa_reservar)
  let timerH = null;

  // ---------------------------------------------------------------
  // Carregar mapa
  // ---------------------------------------------------------------
  async function carregar() {
    const { data, error } = await sb.rpc('rifa_mapa');
    if (error) {
      $('atualizado').textContent = 'Não foi possível atualizar: ' + U.erro(error);
      return;
    }
    cfg = data;
    pagos = new Set(cfg.pagos);
    reservados = new Set(cfg.reservados);
    // número que alguém pegou enquanto estava selecionado aqui
    let perdidos = [];
    sel.forEach(n => { if (pagos.has(n) || reservados.has(n)) { sel.delete(n); perdidos.push(n); } });
    if (perdidos.length) U.toast(`Os números ${perdidos.map(n => U.pad(n, cfg.total_numeros)).join(', ')} acabaram de ser escolhidos por outra pessoa.`, 4500);

    pintarCabecalho();
    montarGrade();
    pintarGrade();
    pintarCarrinho();
    $('atualizado').textContent = 'Atualizado às ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function pintarCabecalho() {
    document.title = cfg.titulo;
    $('titulo').textContent = cfg.titulo;
    $('descricao').textContent = cfg.descricao || '';
    $('premio').hidden = !cfg.premio;
    $('premio').textContent = '🏆 Prêmio: ' + cfg.premio;
    $('valorCota').textContent = U.brl(cfg.valor_cota);
    $('dataSorteioBox').hidden = !cfg.data_sorteio;
    $('dataSorteio').textContent = U.data(cfg.data_sorteio, false);

    const total = cfg.total_numeros;
    const vend = pagos.size;
    const pct = Math.floor((vend / total) * 100);
    const meta = Math.ceil(total * cfg.percentual_minimo / 100);
    $('vendidos').textContent = vend;
    $('total').textContent = total;
    $('pct').textContent = pct + '%';
    $('barFill').style.width = Math.min(100, (vend / total) * 100) + '%';
    $('barGoal').style.left = cfg.percentual_minimo + '%';
    $('barGoal').dataset.label = 'meta ' + cfg.percentual_minimo + '%';
    $('metaTxt').textContent = vend >= meta
      ? '✅ Meta atingida! O sorteio está liberado e será feito pela Loteria Federal.'
      : `O sorteio é liberado quando ${meta} números (${cfg.percentual_minimo}%) forem vendidos. Faltam ${meta - vend}.`;

    // Resultado
    const r = cfg.resultado;
    $('resultado').classList.toggle('hidden', !r);
    if (r) {
      const origem = r.premio_usado > 0
        ? `${r.premio_usado}º prêmio da Loteria Federal (${U.esc(r.premios[r.premio_usado - 1])})`
        : 'número vendido seguinte (regra do regulamento)';
      $('resultado').innerHTML = `
        <div class="small">🎉 Resultado — Loteria Federal, concurso ${U.esc(r.concurso)}</div>
        <div class="big">${U.pad(r.numero, total)}</div>
        <div><b>${U.esc(r.ganhador || '')}</b></div>
        <div class="small">Definido pelo ${origem}</div>`;
      $('progresso').classList.remove('lift');
    }

    const encerrado = !cfg.vendas_abertas || r;
    $('avisoEncerrado').classList.toggle('hidden', !encerrado);
    $('avisoEncerrado').textContent = r ? 'Sorteio realizado. Obrigado a todos que participaram!' : 'As vendas estão pausadas no momento.';
    document.body.classList.toggle('encerrado', !!encerrado);

    montarRegulamento(meta);
  }

  function montarRegulamento(meta) {
    const t = cfg.total_numeros;
    const regra500 = t === 500
      ? 'De 001 a 500 vale o próprio número; de 501 a 999 subtrai-se 500 (ex.: 734 → 234); 000 vale 500.'
      : `Se o valor passar de ${t}, subtrai-se ${t} até ficar dentro da faixa (000 vale 1000).`;
    $('regulamento').innerHTML = [
      `Serão ${t} números, de ${U.pad(1, t)} a ${U.pad(t, t)}, a ${U.brl(cfg.valor_cota)} cada. Cada pessoa pode comprar quantos quiser.`,
      `Ao escolher, os números ficam <b>reservados por ${cfg.minutos_reserva} minutos</b> para pagamento via Pix. Sem pagamento, voltam a ficar livres.`,
      `O número só passa a valer depois que o pagamento for conferido (aparece como <b>vendido</b>).`,
      `O sorteio só acontece após a venda de pelo menos <b>${meta} números (${cfg.percentual_minimo}%)</b>${cfg.data_sorteio ? `, na extração da Loteria Federal prevista para ${U.data(cfg.data_sorteio, false)} ou na primeira extração após atingir a meta` : ''}.`,
      `<b>Como o ganhador é definido:</b> usam-se os 3 últimos dígitos do 1º prêmio da Loteria Federal. ${regra500}`,
      `Se esse número não tiver sido vendido, repete-se a regra com o 2º, 3º, 4º e 5º prêmios. Se nenhum deles tiver sido vendido, ganha o próximo número vendido acima do obtido no 1º prêmio.`,
      `O resultado oficial pode ser conferido por qualquer pessoa em loterias.caixa.gov.br.`
    ].map(li => `<li>${li}</li>`).join('');
  }

  // ---------------------------------------------------------------
  // Grade
  // ---------------------------------------------------------------
  function montarGrade() {
    if (botoes.length === cfg.total_numeros) return;
    const g = $('grid');
    g.innerHTML = '';
    botoes = [];
    for (let n = 1; n <= cfg.total_numeros; n++) {
      const b = document.createElement('button');
      b.className = 'num';
      b.type = 'button';
      b.textContent = U.pad(n, cfg.total_numeros);
      b.dataset.n = n;
      g.appendChild(b);
      botoes.push(b);
    }
  }

  function pintarGrade() {
    const encerrado = !cfg.vendas_abertas || cfg.resultado;
    botoes.forEach(b => {
      const n = +b.dataset.n;
      const pago = pagos.has(n), res = reservados.has(n);
      b.className = 'num' + (pago ? ' pago' : res ? ' reservado' : sel.has(n) ? ' sel' : '');
      if (cfg.resultado && cfg.resultado.numero === n) b.classList.add('ganhador');
      b.disabled = pago || res || !!encerrado;
      b.hidden = filtro === 'livres' && (pago || res);
      b.title = pago ? 'Vendido' : res ? 'Reservado (aguardando pagamento)' : 'Livre';
    });
  }

  $('grid').addEventListener('click', e => {
    const b = e.target.closest('.num');
    if (!b || b.disabled) return;
    const n = +b.dataset.n;
    sel.has(n) ? sel.delete(n) : sel.add(n);
    if (sel.size > cfg.max_por_pedido) {
      sel.delete(n);
      U.toast(`Máximo de ${cfg.max_por_pedido} números por pedido. Finalize este e faça outro.`);
    }
    pintarGrade();
    pintarCarrinho();
  });

  document.querySelectorAll('[data-filtro]').forEach(c => c.addEventListener('click', () => {
    filtro = c.dataset.filtro;
    document.querySelectorAll('[data-filtro]').forEach(x => x.classList.toggle('on', x === c));
    pintarGrade();
  }));

  $('busca').addEventListener('change', () => {
    const n = +$('busca').value;
    const b = botoes[n - 1];
    if (!b) return;
    if (b.hidden) { filtro = 'todos'; document.querySelector('[data-filtro=todos]').click(); }
    b.scrollIntoView({ behavior: 'smooth', block: 'center' });
    b.animate([{ transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 600 });
  });

  $('btnSurpresa').addEventListener('click', () => {
    if (!cfg.vendas_abertas || cfg.resultado) return;
    const qtd = parseInt(prompt('Quantos números aleatórios você quer?', '1'), 10);
    if (!qtd || qtd < 1) return;
    const livres = [];
    for (let n = 1; n <= cfg.total_numeros; n++) if (!pagos.has(n) && !reservados.has(n) && !sel.has(n)) livres.push(n);
    const max = Math.min(qtd, livres.length, cfg.max_por_pedido - sel.size);
    for (let i = 0; i < max; i++) {
      const j = i + Math.floor(Math.random() * (livres.length - i));
      [livres[i], livres[j]] = [livres[j], livres[i]];
      sel.add(livres[i]);
    }
    if (max < qtd) U.toast(`Selecionados ${max} (limite por pedido ou números disponíveis).`);
    pintarGrade();
    pintarCarrinho();
  });

  // ---------------------------------------------------------------
  // Carrinho
  // ---------------------------------------------------------------
  function listaSel() {
    return [...sel].sort((a, b) => a - b);
  }

  function pintarCarrinho() {
    const q = sel.size;
    $('cartbar').classList.toggle('show', q > 0);
    document.body.classList.toggle('has-cart', q > 0);
    $('cartQtd').textContent = q;
    $('cartTotal').textContent = U.brl(q * (cfg?.valor_cota || 0));
    $('cartNums').textContent = listaSel().map(n => U.pad(n, cfg.total_numeros)).join(', ');
  }

  $('btnLimpar').addEventListener('click', () => { sel.clear(); pintarGrade(); pintarCarrinho(); });

  $('btnContinuar').addEventListener('click', () => {
    const nums = listaSel();
    $('resumoNums').textContent = nums.map(n => U.pad(n, cfg.total_numeros)).join(', ');
    $('resumoValor').textContent = U.brl(nums.length * cfg.valor_cota);
    const salvo = U.storage.get('rifa_comprador');
    if (salvo) { $('nome').value ||= salvo.nome; $('whats').value ||= salvo.whats; }
    mostrarPasso('passoDados');
    abrir('mCompra');
  });

  // ---------------------------------------------------------------
  // Reserva + Pix
  // ---------------------------------------------------------------
  $('fDados').addEventListener('submit', async e => {
    e.preventDefault();
    const nome = $('nome').value.trim();
    const whats = U.soDigitos($('whats').value);
    $('errDados').classList.add('hidden');
    if (whats.length < 10) return mostrarErro('errDados', 'Informe o WhatsApp com DDD.');

    $('btnReservar').disabled = true;
    $('btnReservar').textContent = 'Reservando...';
    const { data, error } = await sb.rpc('rifa_reservar', { p_nome: nome, p_whatsapp: whats, p_numeros: listaSel() });
    $('btnReservar').disabled = false;
    $('btnReservar').textContent = 'Reservar e gerar Pix';

    if (error) {
      mostrarErro('errDados', U.erro(error));
      carregar();
      return;
    }
    U.storage.set('rifa_comprador', { nome, whats });
    U.storage.set(CHAVE_PEDIDO, data);
    sel.clear();
    abrirPix(data);
    carregar();
  });

  function abrirPix(p) {
    pedido = p;
    const total = cfg?.total_numeros || 500;
    const copia = Pix.gerar({ chave: p.pix_chave, nome: p.pix_nome, cidade: p.pix_cidade, valor: p.valor, txid: p.codigo });
    $('pixCodigo').textContent = p.codigo;
    $('pixNums').textContent = p.numeros.map(n => U.pad(n, total)).join(', ');
    $('pixValor').textContent = U.brl(p.valor);
    $('pixNome').textContent = p.pix_nome || '—';
    $('pixCopia').value = copia;
    $('pixQr').innerHTML = '';
    new QRCode($('pixQr'), { text: copia, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });
    $('errPix').classList.add('hidden');
    $('btnPaguei').disabled = false;
    iniciarTimer(p.expira_em);
    mostrarPasso('passoPix');
    abrir('mCompra');
  }

  function iniciarTimer(expira) {
    clearInterval(timerH);
    const fim = new Date(expira).getTime();
    const tick = () => {
      const s = Math.max(0, Math.round((fim - Date.now()) / 1000));
      $('pixTimer').textContent = s > 0
        ? `Reserva válida por ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
        : 'Tempo de reserva esgotado. Se já pagou, envie o comprovante mesmo assim.';
      if (s === 0) clearInterval(timerH);
    };
    tick();
    timerH = setInterval(tick, 1000);
  }

  $('btnCopiar').addEventListener('click', () => U.copiar($('pixCopia').value));

  $('btnPaguei').addEventListener('click', async () => {
    if (!pedido) return;
    const total = cfg?.total_numeros || 500;
    const msg = `Olá! Paguei a rifa "${cfg?.titulo || ''}".\nPedido: ${pedido.codigo}\nNúmeros: ${pedido.numeros.map(n => U.pad(n, total)).join(', ')}\nValor: ${U.brl(pedido.valor)}\nSegue o comprovante:`;
    const link = U.wa(pedido.whatsapp_admin, msg);
    // abre o WhatsApp antes do await para o navegador não bloquear o pop-up
    if (pedido.whatsapp_admin) window.open(link, '_blank', 'noopener');

    $('btnPaguei').disabled = true;
    const { error } = await sb.rpc('rifa_informar_pagamento', { p_codigo: pedido.codigo });
    $('btnPaguei').disabled = false;
    if (error) return mostrarErro('errPix', U.erro(error));

    clearInterval(timerH);
    U.storage.del(CHAVE_PEDIDO);
    $('fimCodigo').textContent = pedido.codigo;
    $('fimWa').textContent = U.fone(pedido.whatsapp_admin);
    $('fimWa').href = link;
    mostrarPasso('passoFim');
    carregar();
  });

  // Pedido em aberto (pessoa recarregou a página antes de pagar)
  function lembrarPedidoAberto() {
    const p = U.storage.get(CHAVE_PEDIDO);
    if (!p) return;
    if (new Date(p.expira_em) < new Date()) { U.storage.del(CHAVE_PEDIDO); return; }
    const aviso = document.createElement('div');
    aviso.className = 'alert warn';
    aviso.innerHTML = `Você tem o pedido <b>${U.esc(p.codigo)}</b> aguardando pagamento. <a href="#" id="verPix">Ver Pix</a>`;
    $('progresso').after(aviso);
    aviso.querySelector('#verPix').addEventListener('click', e => { e.preventDefault(); abrirPix(p); });
  }

  // ---------------------------------------------------------------
  // Meus números
  // ---------------------------------------------------------------
  $('btnMeus').addEventListener('click', () => {
    const salvo = U.storage.get('rifa_comprador');
    if (salvo && !$('meusWhats').value) $('meusWhats').value = salvo.whats;
    abrir('mMeus');
  });

  $('fMeus').addEventListener('submit', async e => {
    e.preventDefault();
    $('meusRes').innerHTML = '<p class="small">Buscando...</p>';
    const { data, error } = await sb.rpc('rifa_meus_numeros', { p_whatsapp: $('meusWhats').value });
    if (error) { $('meusRes').innerHTML = `<div class="alert err">${U.esc(U.erro(error))}</div>`; return; }
    if (!data.length) { $('meusRes').innerHTML = '<p class="small">Nenhum pedido encontrado para este WhatsApp.</p>'; return; }
    const total = cfg?.total_numeros || 500;
    const rotulo = { pendente: 'Aguardando pagamento', informado: 'Em conferência', pago: 'Confirmado' };
    $('meusRes').innerHTML = data.map(p => `
      <div class="card" style="padding:12px;margin-bottom:8px;box-shadow:none;border:1px solid var(--line)">
        <div style="display:flex;justify-content:space-between;gap:8px">
          <b>${U.esc(p.codigo)}</b><span class="badge ${p.status}">${rotulo[p.status] || p.status}</span>
        </div>
        <div style="margin:6px 0;font-variant-numeric:tabular-nums">${p.numeros.map(n => U.pad(n, total)).join(', ')}</div>
        <div class="small">${U.brl(p.valor)} · ${U.data(p.criado_em)}</div>
      </div>`).join('');
  });

  // ---------------------------------------------------------------
  // Modais
  // ---------------------------------------------------------------
  function abrir(id) { $(id).classList.add('open'); }
  function fechar(m) { m.classList.remove('open'); }
  function mostrarPasso(id) {
    ['passoDados', 'passoPix', 'passoFim'].forEach(p => $(p).classList.toggle('hidden', p !== id));
  }
  function mostrarErro(id, msg) { $(id).textContent = msg; $(id).classList.remove('hidden'); }

  document.querySelectorAll('.modal').forEach(m => {
    m.addEventListener('click', e => {
      if (e.target === m || e.target.closest('[data-fechar]')) fechar(m);
    });
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.querySelectorAll('.modal.open').forEach(fechar);
  });

  // ---------------------------------------------------------------
  // Início
  // ---------------------------------------------------------------
  carregar().then(lembrarPedidoAberto);
  setInterval(() => { if (!document.hidden) carregar(); }, RIFA_CONFIG.intervaloAtualizacao);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) carregar(); });
})();
