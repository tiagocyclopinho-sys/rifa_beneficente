// Painel do administrador: acompanhamento, conferência de Pix, vendas manuais, sorteio.

(function () {
  const $ = id => document.getElementById(id);

  let cfg = null;
  let pedidos = [];
  let numeros = [];   // [{numero, status, pedido_id}]
  let usuario = null;

  // ---------------------------------------------------------------
  // Login
  // ---------------------------------------------------------------
  async function iniciar() {
    const { data } = await sb.auth.getSession();
    if (data.session) await entrar(data.session.user);
  }

  $('fLogin').addEventListener('submit', async e => {
    e.preventDefault();
    $('errLogin').classList.add('hidden');
    const { data, error } = await sb.auth.signInWithPassword({ email: $('email').value.trim(), password: $('senha').value });
    if (error) return erroLogin(/invalid/i.test(error.message) ? 'E-mail ou senha incorretos.' : U.erro(error));
    await entrar(data.user);
  });

  async function entrar(user) {
    const { data: ok, error } = await sb.rpc('rifa_is_admin');
    if (error || !ok) {
      await sb.auth.signOut();
      return erroLogin('Este usuário não está cadastrado como administrador da rifa.');
    }
    usuario = user;
    $('telaLogin').classList.add('hidden');
    $('telaPainel').classList.remove('hidden');
    await carregar();
    setInterval(() => { if (!document.hidden) carregar(); }, RIFA_CONFIG.intervaloAtualizacao);
  }

  function erroLogin(msg) { $('errLogin').textContent = msg; $('errLogin').classList.remove('hidden'); }

  $('btnSair').addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });
  $('btnAtualizar').addEventListener('click', () => carregar().then(() => U.toast('Atualizado')));

  // ---------------------------------------------------------------
  // Dados
  // ---------------------------------------------------------------
  async function carregar() {
    await sb.rpc('rifa_mapa');   // efeito colateral: libera reservas vencidas
    const [c, p, n] = await Promise.all([
      sb.from('rifa_config').select('*').eq('id', 1).single(),
      sb.from('rifa_pedidos').select('*').order('criado_em', { ascending: false }),
      sb.from('rifa_numeros').select('numero,status,pedido_id').order('numero')
    ]);
    const err = c.error || p.error || n.error;
    if (err) { U.toast('Erro ao carregar: ' + U.erro(err), 5000); return; }
    cfg = c.data; pedidos = p.data; numeros = n.data;
    $('aTitulo').textContent = cfg.titulo;
    $('aAtualizado').textContent = `${usuario.email} · atualizado às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    pintarGeral();
    pintarPedidos();
    pintarSorteio();
    if (!$('fConfig').dataset.sujo) preencherConfig();
  }

  const pad = n => U.pad(n, cfg.total_numeros);
  const fmtNums = arr => arr.map(pad).join(', ');
  const porId = id => pedidos.find(p => p.id === id);

  function totais() {
    const t = { pagos: 0, reservados: 0, livres: 0 };
    numeros.forEach(n => { t[n.status === 'pago' ? 'pagos' : n.status === 'reservado' ? 'reservados' : 'livres']++; });
    const soma = st => pedidos.filter(p => st.includes(p.status)).reduce((s, p) => s + Number(p.valor), 0);
    const conta = st => pedidos.filter(p => st.includes(p.status)).length;
    t.arrecadado = soma(['pago']);
    t.arrecPix = pedidos.filter(p => p.status === 'pago' && p.forma_pagamento === 'pix').reduce((s, p) => s + Number(p.valor), 0);
    t.arrecOutros = t.arrecadado - t.arrecPix;
    t.conferirQtd = conta(['informado']);
    t.conferirValor = soma(['informado']);
    t.pendQtd = conta(['pendente']);
    t.pendValor = soma(['pendente']);
    t.compradores = new Set(pedidos.filter(p => p.status === 'pago').map(p => p.whatsapp)).size;
    t.meta = Math.ceil(cfg.total_numeros * cfg.percentual_minimo / 100);
    t.potencial = cfg.total_numeros * cfg.valor_cota;
    return t;
  }

  // ---------------------------------------------------------------
  // Visão geral
  // ---------------------------------------------------------------
  function pintarGeral() {
    const t = totais();
    const pct = (t.pagos / cfg.total_numeros * 100);
    $('kpis').innerHTML = [
      ['Números vendidos', `${t.pagos} <small>/ ${cfg.total_numeros}</small>`, `${pct.toFixed(1)}% · ${t.compradores} comprador(es)`],
      ['Arrecadado (confirmado)', U.brl(t.arrecadado), `Pix ${U.brl(t.arrecPix)} · outros ${U.brl(t.arrecOutros)}`],
      ['Aguardando conferência', t.conferirQtd, U.brl(t.conferirValor) + ' a conferir no extrato'],
      ['Aguardando pagamento', t.pendQtd, U.brl(t.pendValor) + ' reservados'],
      ['Números livres', t.livres, `${t.reservados} reservado(s)`],
      ['Potencial total', U.brl(t.potencial), `Faltam ${U.brl(t.potencial - t.arrecadado)}`]
    ].map(([a, b, c]) => `<div class="kpi"><span>${a}</span><b>${b}</b><small>${c}</small></div>`).join('');

    $('gBar').style.width = Math.min(100, pct) + '%';
    $('gGoal').style.left = cfg.percentual_minimo + '%';
    $('gGoal').dataset.label = `meta ${t.meta}`;
    $('gMetaTxt').textContent = t.pagos >= t.meta ? '✅ Sorteio liberado' : `Faltam ${t.meta - t.pagos} números`;

    const badge = $('badgeConferir');
    badge.hidden = !t.conferirQtd;
    badge.textContent = t.conferirQtd;

    const conferir = pedidos.filter(p => p.status === 'informado');
    $('gConferir').innerHTML = conferir.length ? `
      <div class="card">
        <h3 style="margin-top:0">🔔 Conferir no extrato (${conferir.length})</h3>
        <p class="small">O comprador avisou que pagou. Confira no app do banco se o Pix caiu e confirme.</p>
        <div class="table-wrap"><table><tbody>${conferir.map(linhaPedido).join('')}</tbody></table></div>
      </div>` : '';

    $('gMapa').innerHTML = numeros.map(n =>
      `<div class="num ${n.status === 'pago' ? 'sel' : n.status === 'reservado' ? 'reservado' : ''}" title="${pad(n.numero)}${n.pedido_id ? ' · ' + U.esc(porId(n.pedido_id)?.nome || '') : ''}">${pad(n.numero)}</div>`
    ).join('');
  }

  // ---------------------------------------------------------------
  // Pedidos
  // ---------------------------------------------------------------
  const ROTULO = { pendente: 'Aguard. pagamento', informado: 'Conferir', pago: 'Pago', cancelado: 'Cancelado', expirado: 'Expirado' };

  function linhaPedido(p) {
    const sorteado = !!cfg.sorteado_em;
    const podeConfirmar = ['pendente', 'informado', 'expirado'].includes(p.status);
    const podeCancelar = !sorteado && ['pendente', 'informado', 'pago'].includes(p.status);
    const msgWa = p.status === 'pago'
      ? `Olá, ${p.nome.split(' ')[0]}! Seu pagamento da rifa "${cfg.titulo}" foi confirmado ✅\nPedido ${p.codigo}\nSeus números: ${fmtNums(p.numeros)}\nBoa sorte! 🍀`
      : `Olá, ${p.nome.split(' ')[0]}! Sobre seu pedido ${p.codigo} da rifa "${cfg.titulo}" (números ${fmtNums(p.numeros)}, ${U.brl(p.valor)}):`;
    return `<tr>
      <td><b>${U.esc(p.codigo)}</b><div class="small">${U.data(p.criado_em)}${p.origem === 'manual' ? ' · manual' : ''}</div></td>
      <td>${U.esc(p.nome)}<div class="small">${U.esc(U.fone(p.whatsapp))}</div></td>
      <td><div class="nums">${fmtNums(p.numeros)}</div><div class="small">${p.numeros.length} nº</div></td>
      <td>${U.brl(p.valor)}<div class="small">${U.esc(p.forma_pagamento)}</div></td>
      <td><span class="badge ${p.status}">${ROTULO[p.status]}</span>${p.observacao ? `<div class="small">${U.esc(p.observacao)}</div>` : ''}</td>
      <td><div class="row-actions">
        ${podeConfirmar ? `<button class="btn sm" data-acao="confirmar" data-id="${p.id}">✔ Confirmar</button>` : ''}
        <a class="btn sm ghost" href="${U.wa(p.whatsapp, msgWa)}" target="_blank" rel="noopener" style="text-decoration:none">WhatsApp</a>
        ${podeCancelar ? `<button class="btn sm ghost" data-acao="cancelar" data-id="${p.id}" style="color:var(--danger);border-color:var(--danger)">Cancelar</button>` : ''}
      </div></td>
    </tr>`;
  }

  function filtrarPedidos() {
    const st = $('pStatus').value;
    const lista = st === 'abertos' ? ['informado', 'pendente'] : st ? st.split(',') : null;
    const q = $('pBusca').value.trim().toLowerCase();
    const qNum = /^\d+$/.test(q) ? +q : null;
    return pedidos
      .filter(p => !lista || lista.includes(p.status))
      .filter(p => !q ||
        p.nome.toLowerCase().includes(q) ||
        p.codigo.toLowerCase().includes(q) ||
        p.whatsapp.includes(U.soDigitos(q) || '§') ||
        (qNum !== null && p.numeros.includes(qNum)))
      .sort((a, b) => (a.status === 'informado' ? 0 : 1) - (b.status === 'informado' ? 0 : 1));
  }

  function pintarPedidos() {
    const l = filtrarPedidos();
    $('pLinhas').innerHTML = l.map(linhaPedido).join('');
    $('pVazio').hidden = l.length > 0;
  }
  $('pStatus').addEventListener('change', pintarPedidos);
  $('pBusca').addEventListener('input', pintarPedidos);

  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-acao]');
    if (!b) return;
    const p = porId(b.dataset.id);
    if (!p) return;

    if (b.dataset.acao === 'confirmar') {
      if (!confirm(`Confirmar pagamento de ${U.brl(p.valor)} de ${p.nome}?\nPedido ${p.codigo} — números ${fmtNums(p.numeros)}\n\nConfira antes no extrato do banco.`)) return;
      b.disabled = true;
      const { error } = await sb.rpc('rifa_confirmar', { p_pedido: p.id });
      if (error) { b.disabled = false; return alert(U.erro(error)); }
      U.toast(`Pedido ${p.codigo} confirmado. Use o botão WhatsApp para avisar o comprador.`, 4000);
    }

    if (b.dataset.acao === 'cancelar') {
      const aviso = p.status === 'pago' ? '\n\n⚠ Este pedido está PAGO. Cancelar devolve os números para venda; lembre de devolver o dinheiro.' : '';
      const motivo = prompt(`Cancelar o pedido ${p.codigo} de ${p.nome}?${aviso}\n\nMotivo (opcional):`, '');
      if (motivo === null) return;
      b.disabled = true;
      const { error } = await sb.rpc('rifa_cancelar', { p_pedido: p.id, p_motivo: motivo || null });
      if (error) { b.disabled = false; return alert(U.erro(error)); }
      U.toast(`Pedido ${p.codigo} cancelado; números liberados.`);
    }
    carregar();
  });

  $('btnCsv').addEventListener('click', () => {
    const cab = ['Pedido', 'Nome', 'WhatsApp', 'Números', 'Qtd', 'Valor', 'Status', 'Forma', 'Origem', 'Criado em', 'Pago em', 'Observação'];
    const linhas = pedidos.map(p => [
      p.codigo, p.nome, U.fone(p.whatsapp), fmtNums(p.numeros), p.numeros.length,
      Number(p.valor).toFixed(2).replace('.', ','), ROTULO[p.status], p.forma_pagamento, p.origem,
      U.data(p.criado_em), U.data(p.pago_em), p.observacao || ''
    ]);
    const csv = [cab, ...linhas].map(l => l.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `rifa-pedidos-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // ---------------------------------------------------------------
  // Venda manual
  // ---------------------------------------------------------------
  $('mNums').addEventListener('input', () => {
    const nums = U.faixa($('mNums').value);
    const ocupados = nums.filter(n => numeros[n - 1] && numeros[n - 1].status !== 'livre');
    const fora = nums.filter(n => n < 1 || n > cfg.total_numeros);
    $('mResumo').innerHTML = nums.length
      ? `${nums.length} número(s) · <b>${U.brl(nums.length * cfg.valor_cota)}</b>` +
        (ocupados.length ? `<br><span style="color:var(--danger)">Já ocupados: ${fmtNums(ocupados)}</span>` : '') +
        (fora.length ? `<br><span style="color:var(--danger)">Fora da faixa: ${fora.join(', ')}</span>` : '')
      : '';
  });

  $('fManual').addEventListener('submit', async e => {
    e.preventDefault();
    const nums = U.faixa($('mNums').value);
    const msg = $('mMsg');
    const { data, error } = await sb.rpc('rifa_venda_manual', {
      p_nome: $('mNome').value, p_whatsapp: $('mWhats').value, p_numeros: nums, p_forma: $('mForma').value
    });
    msg.classList.remove('hidden', 'err', 'ok');
    if (error) { msg.classList.add('err'); msg.textContent = U.erro(error); return; }
    msg.classList.add('ok');
    msg.textContent = `Venda lançada! Pedido ${data.codigo} — ${nums.length} número(s).`;
    $('fManual').reset();
    $('mResumo').textContent = '';
    carregar();
  });

  // ---------------------------------------------------------------
  // Sorteio
  // ---------------------------------------------------------------
  let estadoSorteio = '';
  function pintarSorteio() {
    const t = totais();
    const el = $('sConteudo');
    // não redesenha (e apaga o que está sendo digitado) se nada relevante mudou
    const estado = [cfg.sorteado_em, t.pagos, t.reservados].join('|');
    if (estado === estadoSorteio) return;
    estadoSorteio = estado;

    if (cfg.sorteado_em) {
      const p = porId(cfg.pedido_vencedor);
      const origem = cfg.premio_usado > 0 ? `${cfg.premio_usado}º prêmio (${U.esc(cfg.federal_premios[cfg.premio_usado - 1])})` : 'próximo número vendido (nenhum dos 5 prêmios foi vendido)';
      el.innerHTML = `
        <div class="card result">
          <div class="small">Loteria Federal · concurso ${U.esc(cfg.federal_concurso)} · apurado em ${U.data(cfg.sorteado_em)}</div>
          <div class="big">${pad(cfg.numero_sorteado)}</div>
          <h2 style="margin:4px 0">${U.esc(p?.nome || '')}</h2>
          <div>${U.esc(U.fone(p?.whatsapp))} · pedido ${U.esc(p?.codigo || '')}</div>
          <p class="small">Definido pelo ${origem}</p>
          ${p ? `<a class="btn" style="text-decoration:none;display:inline-block;margin-top:8px" target="_blank" rel="noopener"
               href="${U.wa(p.whatsapp, `Parabéns, ${p.nome.split(' ')[0]}! 🎉 Seu número ${pad(cfg.numero_sorteado)} foi o ganhador da rifa "${cfg.titulo}" (Loteria Federal, concurso ${cfg.federal_concurso}). Vamos combinar a entrega do prêmio: ${cfg.premio}`)}">Avisar o ganhador no WhatsApp</a>` : ''}
        </div>
        <div class="card"><b>Prêmios informados:</b> ${cfg.federal_premios.map((x, i) => `${i + 1}º ${U.esc(x)}`).join(' · ')}</div>`;
      return;
    }

    if (t.pagos < t.meta) {
      el.innerHTML = `
        <div class="card" style="text-align:center">
          <div style="font-size:2.5rem">🔒</div>
          <h3>Sorteio bloqueado</h3>
          <p>${t.pagos} de ${cfg.total_numeros} números pagos. O sorteio libera com <b>${t.meta}</b> (${cfg.percentual_minimo}%).</p>
          <p class="small">Faltam <b>${t.meta - t.pagos}</b> números.</p>
        </div>`;
      return;
    }

    el.innerHTML = `
      <div class="card">
        <h3 style="margin-top:0">🍀 Apurar ganhador pela Loteria Federal</h3>
        ${t.reservados ? `<div class="alert warn">Há ${t.reservados} número(s) reservados/em conferência. Confirme ou cancele esses pedidos antes de apurar.</div>` : ''}
        <p class="small">Após a extração, copie do site da Caixa (loterias.caixa.gov.br → Federal) o número do concurso e os 5 prêmios.
          Pela regra: últimos 3 dígitos; acima de ${cfg.total_numeros} subtrai ${cfg.total_numeros}; 000 = ${pad(U.federalParaNumero('000', cfg.total_numeros))}.</p>
        <form id="fSorteio">
          <div class="form-grid">
            <div><label for="sConc">Concurso</label><input id="sConc" required inputmode="numeric"></div>
            ${[1, 2, 3, 4, 5].map(i => `<div><label for="sP${i}">${i}º prêmio</label><input id="sP${i}" data-premio required inputmode="numeric" maxlength="6"><div class="small" id="sR${i}"></div></div>`).join('')}
          </div>
          <div id="sPrevia" class="alert ok hidden"></div>
          <div id="sErr" class="alert err hidden"></div>
          <button class="btn" type="submit" ${t.reservados ? 'disabled' : ''}>Registrar resultado oficial</button>
        </form>
      </div>`;

    el.querySelectorAll('[data-premio]').forEach(inp => inp.addEventListener('input', previaSorteio));
    $('fSorteio').addEventListener('submit', async e => {
      e.preventDefault();
      const premios = [1, 2, 3, 4, 5].map(i => $('sP' + i).value.trim());
      if (!confirm(`Registrar o resultado do concurso ${$('sConc').value}?\n\nEsta ação é DEFINITIVA, encerra as vendas e publica o ganhador no site.`)) return;
      const { error } = await sb.rpc('rifa_sortear', { p_concurso: $('sConc').value, p_premios: premios });
      if (error) { $('sErr').textContent = U.erro(error); $('sErr').classList.remove('hidden'); return; }
      U.toast('Resultado registrado!');
      carregar();
    });
  }

  // Prévia ao vivo (mesma regra do banco), para conferir antes de gravar
  function previaSorteio() {
    let ganhador = null, usado = null, primeiro = null;
    for (let i = 1; i <= 5; i++) {
      const n = U.federalParaNumero($('sP' + i).value, cfg.total_numeros);
      const r = $('sR' + i);
      if (n === null) { r.textContent = ''; continue; }
      if (i === 1) primeiro = n;
      const num = numeros[n - 1];
      const vendido = num && num.status === 'pago';
      r.innerHTML = `→ nº <b>${pad(n)}</b> ${vendido ? '✅ vendido' : '— não vendido'}`;
      if (vendido && ganhador === null) { ganhador = n; usado = i; }
    }
    if (ganhador === null && primeiro !== null && [1, 2, 3, 4, 5].every(i => U.soDigitos($('sP' + i).value).length >= 3)) {
      const pagos = numeros.filter(n => n.status === 'pago').map(n => n.numero);
      ganhador = pagos.find(n => n > primeiro) ?? pagos[0];
      usado = 0;
    }
    const pv = $('sPrevia');
    if (ganhador === null) { pv.classList.add('hidden'); return; }
    const p = porId(numeros[ganhador - 1].pedido_id);
    pv.classList.remove('hidden');
    pv.innerHTML = `Prévia: número <b>${pad(ganhador)}</b> — ${U.esc(p?.nome || '')} (${usado ? usado + 'º prêmio' : 'próximo vendido'})`;
  }

  // ---------------------------------------------------------------
  // Configurações
  // ---------------------------------------------------------------
  const CAMPOS = {
    cTitulo: 'titulo', cPremio: 'premio', cDescricao: 'descricao', cValor: 'valor_cota', cTotal: 'total_numeros',
    cPct: 'percentual_minimo', cData: 'data_sorteio', cMin: 'minutos_reserva', cMax: 'max_por_pedido',
    cChave: 'pix_chave', cPixNome: 'pix_nome', cCidade: 'pix_cidade', cWa: 'whatsapp_admin'
  };

  function preencherConfig() {
    Object.entries(CAMPOS).forEach(([id, col]) => { $(id).value = cfg[col] ?? ''; });
    $('cAbertas').checked = cfg.vendas_abertas;
    const temVenda = numeros.some(n => n.status !== 'livre');
    $('cTotal').disabled = temVenda;
    $('cTotal').title = temVenda ? 'Não é possível mudar a quantidade depois que as vendas começaram.' : '';
    $('cValor').disabled = temVenda;
    $('cValor').title = temVenda ? 'Não é possível mudar o valor depois que as vendas começaram.' : '';
  }

  $('fConfig').addEventListener('input', () => { $('fConfig').dataset.sujo = '1'; });

  $('fConfig').addEventListener('submit', async e => {
    e.preventDefault();
    const upd = {};
    Object.entries(CAMPOS).forEach(([id, col]) => { if (!$(id).disabled) upd[col] = $(id).value.trim() || null; });
    ['valor_cota', 'total_numeros', 'percentual_minimo', 'minutos_reserva', 'max_por_pedido'].forEach(k => { if (k in upd) upd[k] = Number(upd[k]); });
    ['titulo', 'premio', 'descricao', 'pix_chave', 'pix_nome', 'pix_cidade'].forEach(k => { upd[k] = upd[k] ?? ''; });
    upd.whatsapp_admin = U.soDigitos(upd.whatsapp_admin);
    upd.vendas_abertas = $('cAbertas').checked;

    const msg = $('cMsg');
    const { error } = await sb.from('rifa_config').update(upd).eq('id', 1);
    msg.classList.remove('hidden', 'err', 'ok');
    if (error) { msg.classList.add('err'); msg.textContent = U.erro(error); return; }
    msg.classList.add('ok');
    msg.textContent = 'Configurações salvas.';
    delete $('fConfig').dataset.sujo;
    carregar();
  });

  $('btnTestePix').addEventListener('click', () => {
    const copia = Pix.gerar({ chave: $('cChave').value, nome: $('cPixNome').value, cidade: $('cCidade').value, valor: 0.01, txid: 'TESTE' });
    $('cTeste').classList.remove('hidden');
    $('cCopia').value = copia;
    $('cQr').innerHTML = '';
    new QRCode($('cQr'), { text: copia, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });
  });
  $('btnCopiaTeste').addEventListener('click', () => U.copiar($('cCopia').value));

  // ---------------------------------------------------------------
  // Abas
  // ---------------------------------------------------------------
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
    ['tGeral', 'tPedidos', 'tManual', 'tSorteio', 'tConfig'].forEach(t => $(t).classList.toggle('hidden', t !== b.dataset.tab));
  }));

  iniciar();
})();
