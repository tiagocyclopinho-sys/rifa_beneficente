// =================================================================
// CONFIGURAÇÃO DA RIFA
// Preencha com os dados do projeto Supabase (Project Settings > API).
// A chave "publishable/anon" é pública por natureza: a segurança fica
// nas regras do banco (database/schema.sql).
// Título, prêmio, valor, chave Pix etc. são editados no painel admin.
// =================================================================

window.RIFA_CONFIG = {
  supabase: {
    url: 'https://rogoernmqsahpoytzbkj.supabase.co',
    anonKey: 'sb_publishable_MAbIK1ZTVlxBE6VojIlGzg_UTdpquXc'
  },
  // Atualização automática do mapa de números (ms)
  intervaloAtualizacao: 60000
};
