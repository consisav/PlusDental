-- Plus Dental — usuarios y tipos de usuario
-- Ejecutar una sola vez en Supabase: SQL Editor → New query → pegar todo → Run.

-- Tipos de usuario
create type public.rol_usuario as enum ('cliente', 'administrador', 'super_administrador');

-- Un perfil por cada usuario creado en Supabase Auth
create table public.perfiles (
  id     uuid primary key references auth.users (id) on delete cascade,
  nombre text,
  correo text,
  rol    public.rol_usuario not null default 'cliente',
  creado timestamptz not null default now()
);

alter table public.perfiles enable row level security;

-- ¿El usuario conectado es Super Administrador?
-- security definer: consulta la tabla sin pasar por sus propias reglas (evita un ciclo).
create or replace function public.es_super_administrador()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.perfiles
    where id = auth.uid() and rol = 'super_administrador'
  );
$$;

-- Cada usuario nuevo nace como Cliente
create or replace function public.crear_perfil()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.perfiles (id, nombre, correo)
  values (new.id, new.raw_user_meta_data ->> 'nombre', new.email);
  return new;
end;
$$;

create trigger al_crear_usuario
  after insert on auth.users
  for each row execute function public.crear_perfil();

-- Reglas de acceso:
--  · cada usuario ve solo su perfil; el Super Administrador ve todos
--  · solo el Super Administrador cambia el tipo de usuario
--  · nadie puede cambiarse su propio tipo desde la página
create policy "ver perfiles"
  on public.perfiles for select
  using (id = auth.uid() or public.es_super_administrador());

create policy "super administrador cambia tipos"
  on public.perfiles for update
  using (public.es_super_administrador() and id <> auth.uid())
  with check (public.es_super_administrador() and id <> auth.uid());

-- PRIMER SUPER ADMINISTRADOR
-- Después de crear tu usuario desde la página (botón «Crear usuario»), ejecuta esta línea
-- cambiando el correo por el tuyo:
--
-- update public.perfiles set rol = 'super_administrador' where correo = 'TU-CORREO@ejemplo.com';
