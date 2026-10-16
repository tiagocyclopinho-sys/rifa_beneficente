// =================================================================
// Gerador de "Pix Copia e Cola" (BR Code estático com valor)
// Padrão EMV do Banco Central. Funciona com qualquer banco (Nubank,
// Neon...) sem API: o dinheiro cai direto na chave Pix configurada.
// =================================================================

window.Pix = (function () {
  function campo(id, valor) {
    return id + String(valor.length).padStart(2, '0') + valor;
  }

  function crc16(s) {
    let crc = 0xffff;
    for (let i = 0; i < s.length; i++) {
      crc ^= s.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j++) {
        crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
        crc &= 0xffff;
      }
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }

  // Bancos rejeitam acentos e símbolos no nome/cidade do recebedor
  function limpar(s, max) {
    return String(s || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9 ]/g, '')
      .toUpperCase().trim().slice(0, max);
  }

  function gerar({ chave, nome, cidade, valor, txid }) {
    const conta = campo('00', 'br.gov.bcb.pix') + campo('01', String(chave).trim());
    const id = String(txid || '***').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***';
    let p =
      campo('00', '01') +
      campo('26', conta) +
      campo('52', '0000') +
      campo('53', '986') +
      (valor ? campo('54', Number(valor).toFixed(2)) : '') +
      campo('58', 'BR') +
      campo('59', limpar(nome, 25) || 'RECEBEDOR') +
      campo('60', limpar(cidade, 15) || 'BRASIL') +
      campo('62', campo('05', id)) +
      '6304';
    return p + crc16(p);
  }

  return { gerar, crc16 };
})();
