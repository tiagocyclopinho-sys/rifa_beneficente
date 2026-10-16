-- =================================================================
-- RIFA BENEFICENTE — schema completo (Supabase / PostgreSQL)
-- Rodar UMA VEZ no SQL Editor do Supabase de um projeto novo.
--
-- Regras de segurança:
--  * O público (chave anon) NÃO lê tabelas direto. Só chama as funções
--    rifa_mapa / rifa_reservar / rifa_informar_pagamento / rifa_meus_numeros,
--    que devolvem apenas o necessário (nunca nome/WhatsApp de terceiros).
--  * O painel admin usa login (Supabase Auth) e só funciona para e-mails
--    cadastrados em rifa_admins.
-- =================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------
-- TABELAS
-- -----------------------------------------------------------------

create table if not exists rifa_config (
  id                 int primary key default 1 check (id = 1),
  titulo             text    not null default 'Rifa Beneficente',
  descricao          text    not null default '',
  premio             text    not null default '',
  valor_cota         numeric(10,2) not null default 20.00,
  total_numeros      int     not null default 500 check (total_numeros between 10 and 1000),
  percentual_minimo  int     not null default 80  check (percentual_minimo between 1 and 100),
  minutos_reserva    int     not null default 30  check (minutos_reserva between 5 and 1440),
  max_por_pedido     int     not null default 50,
  pix_chave          text    not null default '',
  pix_nome           text    not null default '',
  pix_cidade         text    not null default '',
  whatsapp_admin     text    not null default '',
  data_sorteio       date,
  vendas_abertas     boolean not null default true,
  -- resultado do sorteio (preenchido por rifa_sortear)
  federal_concurso   text,
  federal_premios    text[],
  numero_sorteado    int,
  premio_usado       int,      -- qual prêmio da Federal definiu o ganhador (1..5) ou 0 = número seguinte
  pedido_vencedor    uuid,
  sorteado_em        timestamptz
);
insert into rifa_config (id) values (1) on conflict do nothing;

create table if not exists rifa_pedidos (
  id               uuid primary key default gen_random_uuid(),
  codigo           text not null unique,
  nome             text not null,
  whatsapp         text not null,           -- só dígitos
  numeros          int[] not null,
  valor            numeric(10,2) not null,
  status           text not null default 'pendente'
                   check (status in ('pendente','informado','pago','cancelado','expirado')),
  origem           text not null default 'site' check (origem in ('site','manual')),
  forma_pagamento  text not null default 'pix',
  observacao       text,
  criado_em        timestamptz not null default now(),
  expira_em        timestamptz,
  informado_em     timestamptz,
  pago_em          timestamptz,
  atualizado_por   text
);
create index if not exists rifa_pedidos_status_idx   on rifa_pedidos (status);
create index if not exists rifa_pedidos_whatsapp_idx on rifa_pedidos (whatsapp);

create table if not exists rifa_numeros (
  numero     int primary key,
  status     text not null default 'livre' check (status in ('livre','reservado','pago')),
  pedido_id  uuid references rifa_pedidos(id)
);
insert into rifa_numeros (numero)
  select g from generate_series(1, (select total_numeros from rifa_config where id = 1)) g
on conflict do nothing;

create table if not exists rifa_admins (
  email text primary key
);

-- Mudou o total de números no painel? Cria/remove as linhas correspondentes.
create or replace function rifa_sync_total() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.total_numeros < old.total_numeros
     and exists (select 1 from rifa_numeros where numero > new.total_numeros and status <> 'livre') then
    raise exception 'Não dá para reduzir para %: há números acima disso já reservados/vendidos.', new.total_numeros;
  end if;
  delete from rifa_numeros where numero > new.total_numeros;
  insert into rifa_numeros (numero)
    select g from generate_series(1, new.total_numeros) g
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists rifa_sync_total on rifa_config;
create trigger rifa_sync_total after update of total_numeros on rifa_config
  for each row when (new.total_numeros is distinct from old.total_numeros)
  execute function rifa_sync_total();

-- -----------------------------------------------------------------
-- RLS: tudo fechado para o público; admins leem/escrevem
-- -----------------------------------------------------------------

alter table rifa_config  enable row level security;
alter table rifa_pedidos enable row level security;
alter table rifa_numeros enable row level security;
alter table rifa_admins  enable row level security;

create or replace function rifa_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from rifa_admins where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

drop policy if exists admin_all on rifa_config;
create policy admin_all on rifa_config  for all to authenticated using (rifa_is_admin()) with check (rifa_is_admin());
drop policy if exists admin_all on rifa_pedidos;
create policy admin_all on rifa_pedidos for all to authenticated using (rifa_is_admin()) with check (rifa_is_admin());
drop policy if exists admin_all on rifa_numeros;
create policy admin_all on rifa_numeros for select to authenticated using (rifa_is_admin());
drop policy if exists admin_read on rifa_admins;
create policy admin_read on rifa_admins for select to authenticated using (rifa_is_admin());

-- -----------------------------------------------------------------
-- FUNÇÕES INTERNAS
-- -----------------------------------------------------------------

-- Libera reservas vencidas (pedido 'pendente' com expira_em no passado).
-- Chamada no início de cada função pública — dispensa agendador (cron).
create or replace function rifa_liberar_expiradas() returns void
language plpgsql security definer set search_path = public as $$
begin
  with exp as (
    update rifa_pedidos set status = 'expirado'
     where status = 'pendente' and expira_em < now()
    returning id
  )
  update rifa_numeros n set status = 'livre', pedido_id = null
    from exp where n.pedido_id = exp.id and n.status = 'reservado';
end $$;

create or replace function rifa_gerar_codigo() returns text
language plpgsql as $$
declare
  alfabeto text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   -- sem 0/O/1/I
  c text;
begin
  loop
    c := 'R';
    for i in 1..6 loop
      c := c || substr(alfabeto, 1 + floor(random() * length(alfabeto))::int, 1);
    end loop;
    exit when not exists (select 1 from rifa_pedidos where codigo = c);
  end loop;
  return c;
end $$;

create or replace function rifa_exigir_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not rifa_is_admin() then
    raise exception 'Acesso restrito ao administrador.';
  end if;
end $$;

-- -----------------------------------------------------------------
-- FUNÇÕES PÚBLICAS (comprador)
-- -----------------------------------------------------------------

-- Mapa da rifa: configuração pública + números ocupados.
create or replace function rifa_mapa() returns json
language plpgsql security definer set search_path = public as $$
declare r json;
begin
  perform rifa_liberar_expiradas();
  select json_build_object(
    'titulo', c.titulo, 'descricao', c.descricao, 'premio', c.premio,
    'valor_cota', c.valor_cota, 'total_numeros', c.total_numeros,
    'percentual_minimo', c.percentual_minimo, 'minutos_reserva', c.minutos_reserva,
    'max_por_pedido', c.max_por_pedido, 'whatsapp_admin', c.whatsapp_admin,
    'data_sorteio', c.data_sorteio, 'vendas_abertas', c.vendas_abertas,
    'pix_nome', c.pix_nome,
    'resultado', case when c.sorteado_em is null then null else json_build_object(
        'concurso', c.federal_concurso, 'premios', c.federal_premios,
        'numero', c.numero_sorteado, 'premio_usado', c.premio_usado,
        'ganhador', (select regexp_replace(p.nome, '^(\S+).*$', '\1') || ' — final ' || right(p.whatsapp, 4)
                       from rifa_pedidos p where p.id = c.pedido_vencedor),
        'sorteado_em', c.sorteado_em) end,
    'pagos',      coalesce((select json_agg(numero order by numero) from rifa_numeros where status = 'pago'), '[]'),
    'reservados', coalesce((select json_agg(numero order by numero) from rifa_numeros where status = 'reservado'), '[]')
  ) into r from rifa_config c where c.id = 1;
  return r;
end $$;

-- Reserva números e cria o pedido. Devolve os dados para gerar o Pix.
create or replace function rifa_reservar(p_nome text, p_whatsapp text, p_numeros int[]) returns json
language plpgsql security definer set search_path = public as $$
declare
  c rifa_config;
  v_whats text := regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g');
  v_nome  text := btrim(coalesce(p_nome, ''));
  v_nums  int[];
  v_ocupados int[];
  v_ped rifa_pedidos;
begin
  perform rifa_liberar_expiradas();
  select * into c from rifa_config where id = 1;

  if not c.vendas_abertas or c.sorteado_em is not null then
    raise exception 'As vendas estão encerradas.';
  end if;
  if length(v_nome) < 3 then raise exception 'Informe seu nome completo.'; end if;
  if length(v_whats) not between 10 and 13 then raise exception 'WhatsApp inválido. Use DDD + número.'; end if;

  select array_agg(distinct x order by x) into v_nums from unnest(p_numeros) x;
  if v_nums is null then raise exception 'Escolha pelo menos um número.'; end if;
  if array_length(v_nums, 1) > c.max_por_pedido then
    raise exception 'Máximo de % números por pedido. Faça outro pedido para mais.', c.max_por_pedido;
  end if;
  if exists (select 1 from unnest(v_nums) x where x < 1 or x > c.total_numeros) then
    raise exception 'Número fora da faixa 1 a %.', c.total_numeros;
  end if;
  if (select count(*) from rifa_pedidos where whatsapp = v_whats and status = 'pendente') >= 3 then
    raise exception 'Você já tem 3 pedidos aguardando pagamento. Pague ou aguarde expirarem.';
  end if;

  -- trava as linhas para evitar dois compradores pegando o mesmo número
  perform 1 from rifa_numeros where numero = any(v_nums) order by numero for update;
  select array_agg(numero order by numero) into v_ocupados
    from rifa_numeros where numero = any(v_nums) and status <> 'livre';
  if v_ocupados is not null then
    raise exception 'Estes números acabaram de ser escolhidos por outra pessoa: %. Escolha outros.',
      array_to_string(v_ocupados, ', ');
  end if;

  insert into rifa_pedidos (codigo, nome, whatsapp, numeros, valor, expira_em)
  values (rifa_gerar_codigo(), v_nome, v_whats, v_nums,
          c.valor_cota * array_length(v_nums, 1),
          now() + make_interval(mins => c.minutos_reserva))
  returning * into v_ped;

  update rifa_numeros set status = 'reservado', pedido_id = v_ped.id where numero = any(v_nums);

  return json_build_object(
    'codigo', v_ped.codigo, 'numeros', v_ped.numeros, 'valor', v_ped.valor,
    'expira_em', v_ped.expira_em,
    'pix_chave', c.pix_chave, 'pix_nome', c.pix_nome, 'pix_cidade', c.pix_cidade,
    'whatsapp_admin', c.whatsapp_admin);
end $$;

-- Comprador avisa "já paguei": a reserva deixa de expirar até o admin conferir.
create or replace function rifa_informar_pagamento(p_codigo text) returns json
language plpgsql security definer set search_path = public as $$
declare v_ped rifa_pedidos;
begin
  perform rifa_liberar_expiradas();
  update rifa_pedidos set status = 'informado', informado_em = now(), expira_em = null
   where codigo = upper(btrim(p_codigo)) and status = 'pendente'
  returning * into v_ped;
  if v_ped.id is null then
    select * into v_ped from rifa_pedidos where codigo = upper(btrim(p_codigo));
    if v_ped.id is null then raise exception 'Pedido não encontrado.'; end if;
    if v_ped.status = 'expirado' then
      raise exception 'Este pedido expirou. Se você já pagou, envie o comprovante pelo WhatsApp com o código %.', v_ped.codigo;
    end if;
  end if;
  return json_build_object('codigo', v_ped.codigo, 'status', v_ped.status);
end $$;

-- Consulta "meus números" pelo WhatsApp.
create or replace function rifa_meus_numeros(p_whatsapp text) returns json
language plpgsql security definer set search_path = public as $$
declare v_whats text := regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g');
begin
  perform rifa_liberar_expiradas();
  if length(v_whats) < 10 then raise exception 'WhatsApp inválido.'; end if;
  return coalesce((
    select json_agg(json_build_object(
             'codigo', codigo, 'numeros', numeros, 'valor', valor,
             'status', status, 'criado_em', criado_em, 'expira_em', expira_em)
           order by criado_em desc)
      from rifa_pedidos
     where whatsapp = v_whats and status in ('pendente','informado','pago')), '[]');
end $$;

-- -----------------------------------------------------------------
-- FUNÇÕES DO ADMINISTRADOR
-- -----------------------------------------------------------------

-- Confirma o pagamento de um pedido (Pix conferido no extrato).
-- Funciona também para pedido expirado, se os números ainda estiverem livres.
create or replace function rifa_confirmar(p_pedido uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_ped rifa_pedidos; v_tomados int[];
begin
  perform rifa_exigir_admin();
  select * into v_ped from rifa_pedidos where id = p_pedido for update;
  if v_ped.id is null then raise exception 'Pedido não encontrado.'; end if;
  if v_ped.status = 'pago' then return; end if;

  perform 1 from rifa_numeros where numero = any(v_ped.numeros) order by numero for update;
  select array_agg(numero order by numero) into v_tomados
    from rifa_numeros
   where numero = any(v_ped.numeros) and status <> 'livre' and pedido_id is distinct from v_ped.id;
  if v_tomados is not null then
    raise exception 'Os números % já pertencem a outro pedido. Cancele este e lance uma venda manual com outros números, ou devolva o valor.',
      array_to_string(v_tomados, ', ');
  end if;

  update rifa_numeros set status = 'pago', pedido_id = v_ped.id where numero = any(v_ped.numeros);
  update rifa_pedidos set status = 'pago', pago_em = now(), expira_em = null,
         atualizado_por = auth.jwt() ->> 'email'
   where id = v_ped.id;
end $$;

-- Cancela um pedido e devolve os números para venda.
create or replace function rifa_cancelar(p_pedido uuid, p_motivo text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rifa_exigir_admin();
  if (select sorteado_em from rifa_config where id = 1) is not null then
    raise exception 'O sorteio já foi realizado; não é possível cancelar pedidos.';
  end if;
  update rifa_numeros set status = 'livre', pedido_id = null where pedido_id = p_pedido;
  update rifa_pedidos set status = 'cancelado', expira_em = null,
         observacao = nullif(concat_ws(' | ', observacao, p_motivo), ''),
         atualizado_por = auth.jwt() ->> 'email'
   where id = p_pedido;
end $$;

-- Venda manual (dinheiro, Pix recebido fora do site, etc.): já entra como paga.
create or replace function rifa_venda_manual(p_nome text, p_whatsapp text, p_numeros int[], p_forma text default 'dinheiro')
returns json language plpgsql security definer set search_path = public as $$
declare
  c rifa_config;
  v_nums int[];
  v_ocupados int[];
  v_ped rifa_pedidos;
begin
  perform rifa_exigir_admin();
  perform rifa_liberar_expiradas();
  select * into c from rifa_config where id = 1;
  if c.sorteado_em is not null then raise exception 'O sorteio já foi realizado.'; end if;

  select array_agg(distinct x order by x) into v_nums from unnest(p_numeros) x;
  if v_nums is null then raise exception 'Informe os números.'; end if;
  if exists (select 1 from unnest(v_nums) x where x < 1 or x > c.total_numeros) then
    raise exception 'Número fora da faixa 1 a %.', c.total_numeros;
  end if;

  perform 1 from rifa_numeros where numero = any(v_nums) order by numero for update;
  select array_agg(numero order by numero) into v_ocupados
    from rifa_numeros where numero = any(v_nums) and status <> 'livre';
  if v_ocupados is not null then
    raise exception 'Números já ocupados: %.', array_to_string(v_ocupados, ', ');
  end if;

  insert into rifa_pedidos (codigo, nome, whatsapp, numeros, valor, status, origem, forma_pagamento, pago_em, atualizado_por)
  values (rifa_gerar_codigo(), btrim(p_nome), regexp_replace(coalesce(p_whatsapp,''), '\D', '', 'g'), v_nums,
          c.valor_cota * array_length(v_nums, 1), 'pago', 'manual', coalesce(nullif(p_forma, ''), 'dinheiro'),
          now(), auth.jwt() ->> 'email')
  returning * into v_ped;

  update rifa_numeros set status = 'pago', pedido_id = v_ped.id where numero = any(v_nums);
  return json_build_object('codigo', v_ped.codigo);
end $$;

-- Sorteio pela Loteria Federal.
-- Regra (mostrada no regulamento do site):
--   1. Pega os 3 últimos dígitos do 1º prêmio (000 vale 1000).
--   2. Enquanto o valor passar do total de números, subtrai o total
--      (com 500 números: 001–500 = ele mesmo; 501–000 = valor − 500).
--   3. Se o número não estiver PAGO, repete com o 2º, 3º, 4º e 5º prêmios.
--   4. Se nenhum dos 5 estiver pago, vale o próximo número pago acima
--      do obtido com o 1º prêmio (voltando ao 1 após o último).
create or replace function rifa_sortear(p_concurso text, p_premios text[]) returns json
language plpgsql security definer set search_path = public as $$
declare
  c rifa_config;
  v_pagos int;
  v_min int;
  v_premio text;
  v_n int;
  v_primeiro int;
  v_ganhador int;
  v_usado int;
  v_ped uuid;
begin
  perform rifa_exigir_admin();
  perform rifa_liberar_expiradas();
  select * into c from rifa_config where id = 1 for update;
  if c.sorteado_em is not null then raise exception 'O sorteio já foi realizado.'; end if;

  select count(*) into v_pagos from rifa_numeros where status = 'pago';
  v_min := ceil(c.total_numeros * c.percentual_minimo / 100.0);
  if v_pagos < v_min then
    raise exception 'Sorteio bloqueado: % de % cotas pagas (mínimo %).', v_pagos, c.total_numeros, v_min;
  end if;
  if exists (select 1 from rifa_numeros where status = 'reservado') then
    raise exception 'Ainda há números reservados aguardando pagamento. Confirme ou cancele esses pedidos antes de sortear.';
  end if;
  if p_premios is null or array_length(p_premios, 1) is null then
    raise exception 'Informe os prêmios da Loteria Federal.';
  end if;

  for i in 1..least(array_length(p_premios, 1), 5) loop
    v_premio := regexp_replace(coalesce(p_premios[i], ''), '\D', '', 'g');
    if length(v_premio) < 3 then raise exception 'O %º prêmio está incompleto.', i; end if;
    v_n := right(v_premio, 3)::int;
    if v_n = 0 then v_n := 1000; end if;
    while v_n > c.total_numeros loop v_n := v_n - c.total_numeros; end loop;
    if i = 1 then v_primeiro := v_n; end if;
    if exists (select 1 from rifa_numeros where numero = v_n and status = 'pago') then
      v_ganhador := v_n; v_usado := i; exit;
    end if;
  end loop;

  if v_ganhador is null then
    select numero into v_ganhador from rifa_numeros
     where status = 'pago'
     order by (numero <= v_primeiro), numero   -- primeiro os acima; depois volta ao início
     limit 1;
    v_usado := 0;
  end if;

  select pedido_id into v_ped from rifa_numeros where numero = v_ganhador;

  update rifa_config set
    federal_concurso = btrim(p_concurso), federal_premios = p_premios,
    numero_sorteado = v_ganhador, premio_usado = v_usado,
    pedido_vencedor = v_ped, sorteado_em = now(), vendas_abertas = false
  where id = 1;

  return json_build_object('numero', v_ganhador, 'premio_usado', v_usado, 'pedido_id', v_ped);
end $$;

-- -----------------------------------------------------------------
-- PERMISSÕES
-- -----------------------------------------------------------------

revoke all on function rifa_liberar_expiradas() from public, anon, authenticated;
revoke all on function rifa_gerar_codigo()      from public, anon, authenticated;

grant execute on function rifa_mapa()                          to anon, authenticated;
grant execute on function rifa_reservar(text, text, int[])     to anon, authenticated;
grant execute on function rifa_informar_pagamento(text)        to anon, authenticated;
grant execute on function rifa_meus_numeros(text)              to anon, authenticated;

revoke all on function rifa_confirmar(uuid)                    from public, anon;
revoke all on function rifa_cancelar(uuid, text)               from public, anon;
revoke all on function rifa_venda_manual(text, text, int[], text) from public, anon;
revoke all on function rifa_sortear(text, text[])              from public, anon;
grant execute on function rifa_confirmar(uuid)                 to authenticated;
grant execute on function rifa_cancelar(uuid, text)            to authenticated;
grant execute on function rifa_venda_manual(text, text, int[], text) to authenticated;
grant execute on function rifa_sortear(text, text[])           to authenticated;
grant execute on function rifa_is_admin()                      to authenticated;

-- -----------------------------------------------------------------
-- DEPOIS DE RODAR: cadastre seu e-mail de administrador
--   insert into rifa_admins (email) values ('seu-email@exemplo.com');
-- e crie o mesmo usuário em Authentication > Users > Add user.
-- -----------------------------------------------------------------
