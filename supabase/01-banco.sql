-- =====================================================================
--  Pesquisa de Relatórios — banco compartilhado (Supabase)
--
--  Como usar: Supabase > SQL Editor > New query > cole TUDO isto > Run.
--  Pode rodar mais de uma vez sem estragar nada.
--  Este arquivo NÃO guarda nenhuma senha.
-- =====================================================================

-- 1) TABELAS ----------------------------------------------------------

create table if not exists public.modulos (
  nome  text primary key,
  ordem integer not null default 0
);

create table if not exists public.relatorios (
  id              text primary key,
  modulo          text not null,
  nome            text not null,
  colunas         jsonb not null default '[]'::jsonb,
  filtros         jsonb not null default '[]'::jsonb,
  funcionalidade  text,
  imagem          text,      -- imagem do relatório (nome do arquivo no Storage)
  imagem_original text,
  imagem_filtro   text,      -- imagem do filtro (nome do arquivo no Storage)
  atualizado_em   timestamptz not null default now()
);
create index if not exists relatorios_modulo_idx on public.relatorios (modulo);

create table if not exists public.colunas_cadastradas (
  nome text primary key
);

create table if not exists public.filtros_cadastrados (
  nome   text primary key,
  tipo   text not null default 'texto',
  opcoes jsonb
);

create table if not exists public.ignorados (
  chave text primary key
);

create table if not exists public.usuarios (
  email     text primary key,
  papel     text not null check (papel in ('admin', 'editor')),
  criado_em timestamptz not null default now(),
  constraint usuarios_email_minusculo check (email = lower(email))
);

-- atualiza "atualizado_em" sozinho a cada alteração de relatório
create or replace function public.tocar_atualizado_em()
returns trigger language plpgsql as $$
begin
  new.atualizado_em = now();
  return new;
end $$;

drop trigger if exists relatorios_tocar on public.relatorios;
create trigger relatorios_tocar
  before update on public.relatorios
  for each row execute function public.tocar_atualizado_em();

-- 2) QUEM PODE O QUÊ --------------------------------------------------
-- Ler: qualquer um (a aba Pesquisar é livre).
-- Escrever: só quem está na tabela "usuarios" como admin ou editor.

create or replace function public.papel_atual()
returns text
language sql stable security definer
set search_path = public
as $$
  select u.papel
  from public.usuarios u
  where u.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1
$$;

revoke all on function public.papel_atual() from public;
grant execute on function public.papel_atual() to anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['modulos','relatorios','colunas_cadastradas','filtros_cadastrados','ignorados']
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);

    execute format('drop policy if exists "leitura publica" on public.%I', t);
    execute format('create policy "leitura publica" on public.%I for select to anon, authenticated using (true)', t);

    execute format('drop policy if exists "escrita editores" on public.%I', t);
    execute format(
      'create policy "escrita editores" on public.%I for all to authenticated
         using (public.papel_atual() in (''admin'',''editor''))
         with check (public.papel_atual() in (''admin'',''editor''))', t);

    -- tempo real: avisa os outros computadores quando algo muda
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- usuários: cada um enxerga a própria linha; o admin enxerga todas.
-- Ninguém altera essa tabela direto pelo programa: criar/excluir usuário passa pela
-- função "gerenciar-usuarios" (que confere se quem pediu é admin).
alter table public.usuarios enable row level security;
grant select on public.usuarios to authenticated;
grant all on public.usuarios to service_role;

drop policy if exists "ver proprio ou admin" on public.usuarios;
create policy "ver proprio ou admin" on public.usuarios
  for select to authenticated
  using (email = lower(coalesce(auth.jwt() ->> 'email', '')) or public.papel_atual() = 'admin');

-- 3) IMAGENS (Storage) ------------------------------------------------

insert into storage.buckets (id, name, public)
values ('imagens', 'imagens', true)
on conflict (id) do update set public = true;

drop policy if exists "imagens leitura" on storage.objects;
create policy "imagens leitura" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'imagens');

drop policy if exists "imagens inserir" on storage.objects;
create policy "imagens inserir" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'imagens' and public.papel_atual() in ('admin','editor'));

drop policy if exists "imagens atualizar" on storage.objects;
create policy "imagens atualizar" on storage.objects
  for update to authenticated
  using (bucket_id = 'imagens' and public.papel_atual() in ('admin','editor'))
  with check (bucket_id = 'imagens' and public.papel_atual() in ('admin','editor'));

drop policy if exists "imagens apagar" on storage.objects;
create policy "imagens apagar" on storage.objects
  for delete to authenticated
  using (bucket_id = 'imagens' and public.papel_atual() in ('admin','editor'));

-- 4) PRIMEIRO ADMINISTRADOR ------------------------------------------
-- Só registra o e-mail como admin. A senha você define no painel (Authentication > Users).

insert into public.usuarios (email, papel)
values ('patrimonio@patrimonio.com', 'admin')
on conflict (email) do update set papel = 'admin';
