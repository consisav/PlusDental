-- Plus Dental — usuarios y tipos de usuario
-- Se puede ejecutar completo cuantas veces haga falta: Supabase SQL Editor → New query → pegar todo → Run.
-- Lo que ya existe se mantiene y solo se crea lo que falta.
-- Se ingresa con nombre de usuario y clave. Supabase exige un correo, así que la página
-- guarda cada usuario como <usuario>@usuarios.plusdental.com (correo interno que nadie recibe).
-- En Authentication → Sign In / Providers → Email, desactivar «Confirm email».

-- Tipos de usuario
do $$ begin
  create type public.rol_usuario as enum ('cliente', 'administrador', 'super_administrador');
exception when duplicate_object then null;
end $$;

-- Un perfil por cada usuario creado en Supabase Auth
create table if not exists public.perfiles (
  id      uuid primary key references auth.users (id) on delete cascade,
  usuario text unique,
  nombre  text,
  correo  text,
  rol     public.rol_usuario not null default 'cliente',
  creado  timestamptz not null default now()
);

alter table public.perfiles add column if not exists usuario text unique;
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
  insert into public.perfiles (id, usuario, nombre, correo)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'usuario', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'nombre',
    new.email
  );
  return new;
end;
$$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'al_crear_usuario' and tgrelid = 'auth.users'::regclass) then
    create trigger al_crear_usuario
    after insert on auth.users
    for each row execute function public.crear_perfil();
  end if;
end $$;

-- Reglas de acceso:
--  · cada usuario ve solo su perfil; el Super Administrador ve todos
--  · solo el Super Administrador cambia el tipo de usuario
--  · nadie puede cambiarse su propio tipo desde la página
drop policy if exists "ver perfiles" on public.perfiles;
create policy "ver perfiles"
  on public.perfiles for select
  using (id = auth.uid() or public.es_super_administrador());

drop policy if exists "super administrador cambia tipos" on public.perfiles;
create policy "super administrador cambia tipos"
  on public.perfiles for update
  using (public.es_super_administrador() and id <> auth.uid())
  with check (public.es_super_administrador() and id <> auth.uid());

-- ===== Panel de Administración: ver usuarios y cambiar claves =====

-- ¿El usuario conectado es Administrador o Super Administrador?
create or replace function public.es_personal()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.perfiles
    where id = auth.uid() and rol in ('administrador', 'super_administrador')
  );
$$;

-- Administrador y Super Administrador ven a todos los usuarios
drop policy if exists "ver perfiles" on public.perfiles;
create policy "ver perfiles"
  on public.perfiles for select
  using (id = auth.uid() or public.es_personal());

-- Cambiar la clave de otro usuario.
--  · Super Administrador: cualquier usuario
--  · Administrador: solo Clientes
-- (Para la clave propia la página usa la función normal de Supabase.)
create extension if not exists pgcrypto with schema extensions;

create or replace function public.cambiar_clave(uid uuid, nueva text)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare
  rol_objetivo public.rol_usuario;
begin
  if nueva is null or length(nueva) < 8 then
    raise exception 'La clave debe tener al menos 8 caracteres';
  end if;
  if uid = auth.uid() then
    raise exception 'Usa «Cambiar mi clave» para tu propio usuario';
  end if;

  select rol into rol_objetivo from public.perfiles where id = uid;
  if rol_objetivo is null then
    raise exception 'Usuario no encontrado';
  end if;

  if not (public.es_super_administrador()
          or (public.es_personal() and rol_objetivo = 'cliente')) then
    raise exception 'No tienes permiso para cambiar la clave de este usuario';
  end if;

  update auth.users
     set encrypted_password = extensions.crypt(nueva, extensions.gen_salt('bf')),
         updated_at = now()
   where id = uid;
end;
$$;

revoke execute on function public.cambiar_clave(uuid, text) from public, anon;
grant execute on function public.cambiar_clave(uuid, text) to authenticated;

-- ===== Agenda de citas =====
-- Todo el horario de atención está disponible salvo lo reservado o bloqueado por el personal.

do $$ begin
  create type public.estado_cita as enum ('pendiente', 'confirmada', 'cancelada');
exception when duplicate_object then null;
end $$;

create table if not exists public.citas (
  id         bigint generated always as identity primary key,
  creada     timestamptz not null default now(),
  fecha      date not null,
  hora       time not null,
  servicio   text not null,
  nombre     text not null,
  telefono   text not null,
  usuario_id uuid references auth.users (id) on delete set null,
  estado     public.estado_cita not null default 'pendiente'
);

-- (El cupo por horario se define en «Agenda de clínicas»: uno por dentista y uno por sala.)

alter table public.citas enable row level security;

-- Nombre y teléfono de los pacientes: solo los ve el personal
drop policy if exists "personal ve citas" on public.citas;
create policy "personal ve citas" on public.citas for select using (public.es_personal());
drop policy if exists "personal actualiza citas" on public.citas;
create policy "personal actualiza citas" on public.citas for update
  using (public.es_personal()) with check (public.es_personal());

create table if not exists public.bloqueos (
  id     bigint generated always as identity primary key,
  fecha  date not null,
  hora   time,            -- vacío = todo el día
  motivo text,
  creado timestamptz not null default now()
);

alter table public.bloqueos enable row level security;

drop policy if exists "personal gestiona bloqueos" on public.bloqueos;
create policy "personal gestiona bloqueos" on public.bloqueos for all
  using (public.es_personal()) with check (public.es_personal());

-- Horario de atención: lunes a viernes 6 turnos, sábado 3, domingo cerrado
create or replace function public.turnos_del_dia(d date)
returns setof time
language sql immutable
as $$
  select t::time from unnest(
    case
      when extract(isodow from d) between 1 and 5 then array['08:00', '09:30', '11:00', '14:00', '15:30', '17:00']
      when extract(isodow from d) = 6 then array['08:00', '09:30', '11:00']
      else array[]::text[]
    end) as t;
$$;

-- Horarios de un rango de fechas y si están libres (sin datos de pacientes).
-- Más abajo («Agenda por dentista») se redefine para tener en cuenta el horario de los dentistas.
create or replace function public.disponibilidad(desde date, hasta date)
returns table (fecha date, hora text, libre boolean)
language sql stable security definer set search_path = public
as $$
  with turnos as (
    select dia::date as f, h
    from generate_series(desde::timestamp, least(hasta, desde + 31)::timestamp, interval '1 day') as dia,
         lateral public.turnos_del_dia(dia::date) as h
  )
  select t.f,
         to_char(t.h, 'HH24:MI'),
         (t.f + t.h) > (now() at time zone 'America/Guatemala') + interval '1 hour'
         and not exists (select 1 from public.citas c
                         where c.fecha = t.f and c.hora = t.h and c.estado <> 'cancelada')
         and not exists (select 1 from public.bloqueos b
                         where b.fecha = t.f and (b.hora is null or b.hora = t.h))
  from turnos t
  order by 1, 2;
$$;

-- Registrar una solicitud de cita desde la página (cualquier visitante)
create or replace function public.solicitar_cita(p_fecha date, p_hora text, p_servicio text, p_nombre text, p_telefono text)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_id bigint;
begin
  if coalesce(trim(p_nombre), '') = '' or coalesce(trim(p_telefono), '') = '' then
    raise exception 'Escribe tu nombre y tu WhatsApp';
  end if;
  if length(p_nombre) > 120 or length(p_telefono) > 40 or length(p_servicio) > 60 then
    raise exception 'Los datos son demasiado largos';
  end if;
  if not exists (select 1 from public.disponibilidad(p_fecha, p_fecha) d where d.hora = p_hora and d.libre) then
    raise exception 'Ese horario ya no está disponible';
  end if;

  insert into public.citas (fecha, hora, servicio, nombre, telefono, usuario_id)
  values (p_fecha, p_hora::time, trim(p_servicio), trim(p_nombre), trim(p_telefono), auth.uid())
  returning id into v_id;
  return v_id;
exception
  when unique_violation then
    raise exception 'Ese horario ya no está disponible';
end;
$$;

grant execute on function public.disponibilidad(date, date) to anon, authenticated;
grant execute on function public.solicitar_cita(date, text, text, text, text) to anon, authenticated;

-- ===== Expedientes de pacientes (solo Administrador y Super Administrador) =====

create table if not exists public.pacientes (
  id                  bigint generated always as identity primary key,
  nombre              text not null,
  dpi                 text,
  fecha_nacimiento    date,
  telefono            text,
  direccion           text,
  emergencia_nombre   text,
  emergencia_telefono text,
  alergias            text,
  enfermedades        text,
  medicamentos        text,
  odontograma         jsonb not null default '{}'::jsonb,  -- { "16": "caries", "21": "corona", ... }
  creado              timestamptz not null default now(),
  actualizado         timestamptz not null default now()
);

-- Un DPI no puede repetirse
create unique index if not exists pacientes_dpi_unico on public.pacientes (dpi) where dpi is not null and dpi <> '';

alter table public.pacientes enable row level security;
drop policy if exists "personal ve pacientes" on public.pacientes;
create policy "personal ve pacientes" on public.pacientes for select using (public.es_personal());
drop policy if exists "personal crea pacientes" on public.pacientes;
create policy "personal crea pacientes" on public.pacientes for insert with check (public.es_personal());
drop policy if exists "personal edita pacientes" on public.pacientes;
create policy "personal edita pacientes" on public.pacientes for update
  using (public.es_personal()) with check (public.es_personal());
drop policy if exists "super administrador borra pacientes" on public.pacientes;
create policy "super administrador borra pacientes" on public.pacientes for delete using (public.es_super_administrador());

create or replace function public.marcar_actualizado()
returns trigger language plpgsql as $$
begin
  new.actualizado := now();
  return new;
end;
$$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'pacientes_actualizado' and tgrelid = 'public.pacientes'::regclass) then
    create trigger pacientes_actualizado before update on public.pacientes
    for each row execute function public.marcar_actualizado();
  end if;
end $$;

-- Notas de cada visita
create table if not exists public.notas_visita (
  id            bigint generated always as identity primary key,
  paciente_id   bigint not null references public.pacientes (id) on delete cascade,
  fecha         date not null default current_date,
  texto         text not null,
  autor         uuid references auth.users (id) on delete set null,
  autor_usuario text,
  creada        timestamptz not null default now()
);
create index if not exists notas_visita_paciente on public.notas_visita (paciente_id, fecha desc);

alter table public.notas_visita enable row level security;
drop policy if exists "personal ve notas" on public.notas_visita;
create policy "personal ve notas" on public.notas_visita for select using (public.es_personal());
drop policy if exists "personal escribe notas" on public.notas_visita;
create policy "personal escribe notas" on public.notas_visita for insert with check (public.es_personal());
drop policy if exists "super administrador borra notas" on public.notas_visita;
create policy "super administrador borra notas" on public.notas_visita for delete using (public.es_super_administrador());

-- Quien escribe la nota queda registrado automáticamente
create or replace function public.firmar_nota()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.autor := auth.uid();
  new.autor_usuario := (select usuario from public.perfiles where id = auth.uid());
  return new;
end;
$$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'notas_visita_firma' and tgrelid = 'public.notas_visita'::regclass) then
    create trigger notas_visita_firma before insert on public.notas_visita
    for each row execute function public.firmar_nota();
  end if;
end $$;

-- Radiografías y fotografías clínicas: almacenamiento privado (máx. 10 MB por archivo)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('expedientes', 'expedientes', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'personal ve archivos de expedientes') then
    create policy "personal ve archivos de expedientes" on storage.objects for select
    using (bucket_id = 'expedientes' and public.es_personal());
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'personal sube archivos de expedientes') then
    create policy "personal sube archivos de expedientes" on storage.objects for insert
    with check (bucket_id = 'expedientes' and public.es_personal());
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'super administrador borra archivos de expedientes') then
    create policy "super administrador borra archivos de expedientes" on storage.objects for delete
    using (bucket_id = 'expedientes' and public.es_super_administrador());
  end if;
end $$;

-- ===== Presupuestos =====
-- Precios con IVA incluido. El costo se carga a la cuenta del paciente cuando cada tratamiento
-- de un presupuesto aprobado se marca como realizado.

-- Catálogo de tratamientos con precio base
create table if not exists public.tratamientos (
  id     bigint generated always as identity primary key,
  nombre text not null,
  precio numeric(10,2) not null default 0 check (precio >= 0),
  activo boolean not null default true,
  creado timestamptz not null default now()
);
create unique index if not exists tratamientos_nombre_unico on public.tratamientos (lower(nombre));
alter table public.tratamientos enable row level security;
drop policy if exists "personal ve tratamientos" on public.tratamientos;
create policy "personal ve tratamientos" on public.tratamientos for select using (public.es_personal());
drop policy if exists "personal crea tratamientos" on public.tratamientos;
create policy "personal crea tratamientos" on public.tratamientos for insert with check (public.es_personal());
drop policy if exists "personal edita tratamientos" on public.tratamientos;
create policy "personal edita tratamientos" on public.tratamientos for update
  using (public.es_personal()) with check (public.es_personal());

do $$ begin
  create type public.estado_presupuesto as enum ('borrador', 'enviado', 'aprobado', 'rechazado');
exception when duplicate_object then null;
end $$;

create table if not exists public.presupuestos (
  id            bigint generated always as identity primary key,
  paciente_id   bigint not null references public.pacientes (id) on delete cascade,
  fecha         date not null default current_date,
  estado        public.estado_presupuesto not null default 'borrador',
  descuento_pct numeric(5,2) not null default 0 check (descuento_pct between 0 and 100),
  notas         text,
  creado_por    text,
  creado        timestamptz not null default now(),
  actualizado   timestamptz not null default now()
);
create index if not exists presupuestos_paciente on public.presupuestos (paciente_id);
alter table public.presupuestos enable row level security;
drop policy if exists "personal ve presupuestos" on public.presupuestos;
create policy "personal ve presupuestos" on public.presupuestos for select using (public.es_personal());
drop policy if exists "personal crea presupuestos" on public.presupuestos;
create policy "personal crea presupuestos" on public.presupuestos for insert with check (public.es_personal());
drop policy if exists "personal edita presupuestos" on public.presupuestos;
create policy "personal edita presupuestos" on public.presupuestos for update
  using (public.es_personal()) with check (public.es_personal());
drop policy if exists "super administrador borra presupuestos no aprobados" on public.presupuestos;
create policy "super administrador borra presupuestos no aprobados" on public.presupuestos for delete
  using (public.es_super_administrador() and estado <> 'aprobado');

create table if not exists public.presupuesto_items (
  id             bigint generated always as identity primary key,
  presupuesto_id bigint not null references public.presupuestos (id) on delete cascade,
  orden          int not null default 0,
  tratamiento    text not null,
  pieza          text,
  cantidad       int not null default 1 check (cantidad > 0),
  precio         numeric(10,2) not null default 0 check (precio >= 0),
  realizado      boolean not null default false,
  realizado_en   date
);
create index if not exists presupuesto_items_presupuesto on public.presupuesto_items (presupuesto_id);
alter table public.presupuesto_items enable row level security;
-- Se leen directo; se escriben solo con las funciones de abajo, que validan el estado
drop policy if exists "personal ve items" on public.presupuesto_items;
create policy "personal ve items" on public.presupuesto_items for select using (public.es_personal());

-- Quién creó el presupuesto
create or replace function public.firmar_presupuesto()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.creado_por := (select usuario from public.perfiles where id = auth.uid());
  return new;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'presupuestos_firma' and tgrelid = 'public.presupuestos'::regclass) then
    create trigger presupuestos_firma before insert on public.presupuestos
    for each row execute function public.firmar_presupuesto();
  end if;
end $$;

-- Un presupuesto aprobado con tratamientos realizados no cambia de estado ni de descuento
create or replace function public.antes_de_cambiar_presupuesto()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.estado = 'aprobado' and exists (
       select 1 from public.presupuesto_items where presupuesto_id = old.id and realizado) then
    if new.estado <> 'aprobado' then
      raise exception 'Este presupuesto ya tiene tratamientos realizados; no puede dejar de estar aprobado';
    end if;
    if new.descuento_pct <> old.descuento_pct then
      raise exception 'Este presupuesto ya tiene tratamientos realizados; el descuento no se puede cambiar';
    end if;
  end if;
  new.actualizado := now();
  return new;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'presupuestos_cambio' and tgrelid = 'public.presupuestos'::regclass) then
    create trigger presupuestos_cambio before update on public.presupuestos
    for each row execute function public.antes_de_cambiar_presupuesto();
  end if;
end $$;

-- Guardar tratamientos, descuento y notas de un presupuesto en borrador o enviado (todo o nada)
create or replace function public.guardar_presupuesto(p_id bigint, p_descuento numeric, p_notas text, p_items jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_estado public.estado_presupuesto;
begin
  if not public.es_personal() then
    raise exception 'No tienes permiso para esta acción';
  end if;
  select estado into v_estado from public.presupuestos where id = p_id;
  if v_estado is null then
    raise exception 'Presupuesto no encontrado';
  end if;
  if v_estado in ('aprobado', 'rechazado') then
    raise exception 'Un presupuesto aprobado o rechazado ya no se puede modificar';
  end if;

  update public.presupuestos
     set descuento_pct = coalesce(p_descuento, 0), notas = nullif(trim(p_notas), '')
   where id = p_id;

  delete from public.presupuesto_items where presupuesto_id = p_id;
  insert into public.presupuesto_items (presupuesto_id, orden, tratamiento, pieza, cantidad, precio)
  select p_id, t.ord, trim(t.i ->> 'tratamiento'), nullif(trim(t.i ->> 'pieza'), ''),
         greatest(coalesce((t.i ->> 'cantidad')::int, 1), 1), greatest(coalesce((t.i ->> 'precio')::numeric, 0), 0)
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as t(i, ord)
  where coalesce(trim(t.i ->> 'tratamiento'), '') <> '';
end;
$$;

-- Marcar un tratamiento como realizado (solo en presupuestos aprobados)
create or replace function public.marcar_realizado(p_item bigint, p_realizado boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.es_personal() then
    raise exception 'No tienes permiso para esta acción';
  end if;
  if not exists (select 1 from public.presupuesto_items i
                 join public.presupuestos p on p.id = i.presupuesto_id
                 where i.id = p_item and p.estado = 'aprobado') then
    raise exception 'Solo se marcan como realizados los tratamientos de un presupuesto aprobado';
  end if;
  update public.presupuesto_items
     set realizado = p_realizado,
         realizado_en = case when p_realizado then current_date else null end
   where id = p_item;
end;
$$;

revoke execute on function public.guardar_presupuesto(bigint, numeric, text, jsonb) from public, anon;
revoke execute on function public.marcar_realizado(bigint, boolean) from public, anon;
grant execute on function public.guardar_presupuesto(bigint, numeric, text, jsonb) to authenticated;
grant execute on function public.marcar_realizado(bigint, boolean) to authenticated;

-- ===== Cobros y pagos + Estados de cuenta =====
-- El número de recibo es el id del pago. Los pagos no se borran: el Super Administrador los anula con un motivo.

do $$ begin
  create type public.metodo_pago as enum ('efectivo', 'tarjeta', 'transferencia', 'deposito');
exception when duplicate_object then null;
end $$;

create table if not exists public.pagos (
  id             bigint generated always as identity primary key,
  paciente_id    bigint not null references public.pacientes (id) on delete restrict,
  presupuesto_id bigint references public.presupuestos (id) on delete set null,
  fecha          date not null default current_date,
  monto          numeric(10,2) not null check (monto > 0),
  metodo         public.metodo_pago not null,
  referencia     text,
  concepto       text,
  registrado_por text,
  creado         timestamptz not null default now(),
  anulado        boolean not null default false,
  anulado_motivo text,
  anulado_por    text,
  anulado_en     timestamptz
);
create index if not exists pagos_paciente on public.pagos (paciente_id);
create index if not exists pagos_fecha on public.pagos (fecha desc);

alter table public.pagos enable row level security;
drop policy if exists "personal ve pagos" on public.pagos;
create policy "personal ve pagos" on public.pagos for select using (public.es_personal());
drop policy if exists "personal registra pagos" on public.pagos;
create policy "personal registra pagos" on public.pagos for insert with check (public.es_personal());
-- Sin reglas de update ni delete: solo se anulan con la función anular_pago

create or replace function public.firmar_pago()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.registrado_por := (select usuario from public.perfiles where id = auth.uid());
  new.anulado := false;
  new.anulado_motivo := null;
  new.anulado_por := null;
  new.anulado_en := null;
  return new;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'pagos_firma' and tgrelid = 'public.pagos'::regclass) then
    create trigger pagos_firma before insert on public.pagos
    for each row execute function public.firmar_pago();
  end if;
end $$;

create or replace function public.anular_pago(p_id bigint, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.es_super_administrador() then
    raise exception 'Solo el Super Administrador puede anular pagos';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Escribe el motivo de la anulación';
  end if;
  update public.pagos
     set anulado = true, anulado_motivo = trim(p_motivo), anulado_en = now(),
         anulado_por = (select usuario from public.perfiles where id = auth.uid())
   where id = p_id and not anulado;
  if not found then
    raise exception 'El pago no existe o ya estaba anulado';
  end if;
end;
$$;
revoke execute on function public.anular_pago(bigint, text) from public, anon;
grant execute on function public.anular_pago(bigint, text) to authenticated;

-- Movimientos de cuenta: cargos (tratamientos realizados con su descuento) y abonos (pagos no anulados).
-- security_invoker: respeta las reglas de las tablas, así que solo el personal ve resultados.
create or replace view public.movimientos_cuenta with (security_invoker = true) as
  select i.realizado_en as fecha,
         p.paciente_id,
         'cargo'::text as tipo,
         i.tratamiento || coalesce(' (pieza ' || i.pieza || ')', '') ||
           case when i.cantidad > 1 then ' x' || i.cantidad else '' end ||
           ' · Presupuesto N.º ' || p.id as concepto,
         round(i.cantidad * i.precio * (1 - p.descuento_pct / 100), 2) as cargo,
         0::numeric(10,2) as abono,
         i.id as referencia_id
    from public.presupuesto_items i
    join public.presupuestos p on p.id = i.presupuesto_id
   where i.realizado and p.estado = 'aprobado'
  union all
  select g.fecha,
         g.paciente_id,
         'pago'::text,
         'Pago · recibo N.º ' || g.id || ' · ' || g.metodo::text || coalesce(' · ' || g.concepto, ''),
         0::numeric(10,2),
         g.monto,
         g.id
    from public.pagos g
   where not g.anulado;

create or replace view public.saldos_pacientes with (security_invoker = true) as
  select pa.id as paciente_id,
         pa.nombre,
         pa.telefono,
         coalesce(sum(m.cargo), 0) as cargos,
         coalesce(sum(m.abono), 0) as abonos,
         coalesce(sum(m.cargo), 0) - coalesce(sum(m.abono), 0) as saldo,
         max(m.fecha) as ultimo_movimiento
    from public.pacientes pa
    left join public.movimientos_cuenta m on m.paciente_id = pa.id
   group by pa.id, pa.nombre, pa.telefono;

-- ===== Historial de cambios del odontograma =====
-- Cada cambio de una pieza queda registrado con su fecha (editable), observaciones (editables),
-- usuario y hora de registro (automáticos).

create table if not exists public.odontograma_cambios (
  id            bigint generated always as identity primary key,
  paciente_id   bigint not null references public.pacientes (id) on delete cascade,
  pieza         int,            -- vacío = cambio general (por ejemplo, la dentición)
  descripcion   text not null,
  fecha_cambio  timestamptz not null default now(),
  observaciones text,
  usuario       text,
  registrado_en timestamptz not null default now(),
  editado_por   text,
  editado_en    timestamptz
);
create index if not exists odontograma_cambios_paciente on public.odontograma_cambios (paciente_id, fecha_cambio desc);

alter table public.odontograma_cambios enable row level security;
drop policy if exists "personal ve cambios del odontograma" on public.odontograma_cambios;
create policy "personal ve cambios del odontograma" on public.odontograma_cambios for select using (public.es_personal());
-- Se escriben solo con las funciones de abajo

-- Guardar el odontograma y su registro de cambios (todo o nada)
create or replace function public.guardar_odontograma(p_paciente bigint, p_odontograma jsonb, p_cambios jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_usuario text := (select usuario from public.perfiles where id = auth.uid());
begin
  if not public.es_personal() then
    raise exception 'No tienes permiso para esta acción';
  end if;
  update public.pacientes set odontograma = coalesce(p_odontograma, '{}'::jsonb) where id = p_paciente;
  if not found then
    raise exception 'Paciente no encontrado';
  end if;
  insert into public.odontograma_cambios (paciente_id, pieza, descripcion, fecha_cambio, observaciones, usuario)
  select p_paciente,
         nullif(c ->> 'pieza', '')::int,
         left(c ->> 'descripcion', 500),
         coalesce(nullif(c ->> 'fecha_cambio', '')::timestamptz, now()),
         nullif(left(trim(c ->> 'observaciones'), 1000), ''),
         v_usuario
  from jsonb_array_elements(coalesce(p_cambios, '[]'::jsonb)) as c
  where coalesce(c ->> 'descripcion', '') <> '';
end;
$$;

-- Corregir la fecha o las observaciones de un cambio ya registrado (queda anotado quién lo editó)
create or replace function public.editar_cambio_odontograma(p_id bigint, p_fecha timestamptz, p_observaciones text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.es_personal() then
    raise exception 'No tienes permiso para esta acción';
  end if;
  update public.odontograma_cambios
     set fecha_cambio  = coalesce(p_fecha, fecha_cambio),
         observaciones = nullif(left(trim(p_observaciones), 1000), ''),
         editado_por   = (select usuario from public.perfiles where id = auth.uid()),
         editado_en    = now()
   where id = p_id;
  if not found then
    raise exception 'Registro no encontrado';
  end if;
end;
$$;

revoke execute on function public.guardar_odontograma(bigint, jsonb, jsonb) from public, anon;
revoke execute on function public.editar_cambio_odontograma(bigint, timestamptz, text) from public, anon;
grant execute on function public.guardar_odontograma(bigint, jsonb, jsonb) to authenticated;
grant execute on function public.editar_cambio_odontograma(bigint, timestamptz, text) to authenticated;

-- ===== Posiciones (sub-clínicas / boxes) y personal de la clínica =====

-- Personal: odontólogos, especialistas, higienistas y auxiliares (no necesitan usuario en la página)
create table if not exists public.personal (
  id          bigint generated always as identity primary key,
  nombre      text not null,
  rol         text not null default 'odontologo'
              check (rol in ('odontologo', 'especialista', 'higienista', 'auxiliar', 'otro')),
  especialidad text,
  colegiado   text,
  telefono    text,
  activo      boolean not null default true,
  creado      timestamptz not null default now()
);
alter table public.personal enable row level security;
drop policy if exists "personal ve el personal" on public.personal;
create policy "personal ve el personal" on public.personal for select using (public.es_personal());
drop policy if exists "personal agrega personal" on public.personal;
create policy "personal agrega personal" on public.personal for insert with check (public.es_personal());
drop policy if exists "personal edita personal" on public.personal;
create policy "personal edita personal" on public.personal for update
  using (public.es_personal()) with check (public.es_personal());

do $$ begin
  create type public.estado_posicion as enum ('libre', 'ocupado', 'limpieza', 'mantenimiento');
exception when duplicate_object then null;
end $$;

create table if not exists public.posiciones (
  id            bigint generated always as identity primary key,
  codigo        text not null,                       -- ID de clínica (número o código)
  nombre        text not null,
  ubicacion     text,
  tipo_sillon   text,
  equipamiento  text[] not null default '{}',
  especialidad  text,
  responsables  bigint[] not null default '{}',      -- ids de personal
  soporte       bigint[] not null default '{}',      -- ids de personal
  horario       jsonb not null default '{}'::jsonb,  -- { "1": { "abre": "08:00", "cierra": "18:00" }, ... } 1 = lunes
  estado        public.estado_posicion not null default 'libre',
  estado_desde  timestamptz not null default now(),
  estado_por    text,
  activa        boolean not null default true,
  notas         text,
  creado        timestamptz not null default now(),
  actualizado   timestamptz not null default now()
);
create unique index if not exists posiciones_codigo_unico on public.posiciones (lower(codigo));
alter table public.posiciones enable row level security;
drop policy if exists "personal ve posiciones" on public.posiciones;
create policy "personal ve posiciones" on public.posiciones for select using (public.es_personal());
drop policy if exists "personal crea posiciones" on public.posiciones;
create policy "personal crea posiciones" on public.posiciones for insert with check (public.es_personal());
drop policy if exists "personal edita posiciones" on public.posiciones;
create policy "personal edita posiciones" on public.posiciones for update
  using (public.es_personal()) with check (public.es_personal());
drop policy if exists "super administrador borra posiciones" on public.posiciones;
create policy "super administrador borra posiciones" on public.posiciones for delete using (public.es_super_administrador());

-- Cada cambio de estado anota desde cuándo y quién lo hizo
create or replace function public.antes_de_guardar_posicion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.actualizado := now();
  if tg_op = 'INSERT' or new.estado is distinct from old.estado then
    new.estado_desde := now();
    new.estado_por := (select usuario from public.perfiles where id = auth.uid());
  end if;
  return new;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'posiciones_guardar' and tgrelid = 'public.posiciones'::regclass) then
    create trigger posiciones_guardar before insert or update on public.posiciones
      for each row execute function public.antes_de_guardar_posicion();
  end if;
end $$;

-- Historial de mantenimiento
create table if not exists public.mantenimientos (
  id             bigint generated always as identity primary key,
  posicion_id    bigint not null references public.posiciones (id) on delete cascade,
  fecha          date not null default current_date,
  tipo           text not null check (tipo in ('revision_sillon', 'calibracion_rx', 'filtros', 'otro')),
  descripcion    text,
  responsable    text,          -- técnico o empresa que lo hizo
  proxima        date,          -- próxima revisión
  registrado_por text,
  creado         timestamptz not null default now()
);
create index if not exists mantenimientos_posicion on public.mantenimientos (posicion_id, fecha desc);
alter table public.mantenimientos enable row level security;
drop policy if exists "personal ve mantenimientos" on public.mantenimientos;
create policy "personal ve mantenimientos" on public.mantenimientos for select using (public.es_personal());
drop policy if exists "personal registra mantenimientos" on public.mantenimientos;
create policy "personal registra mantenimientos" on public.mantenimientos for insert with check (public.es_personal());
drop policy if exists "super administrador borra mantenimientos" on public.mantenimientos;
create policy "super administrador borra mantenimientos" on public.mantenimientos for delete using (public.es_super_administrador());

create or replace function public.firmar_mantenimiento()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.registrado_por := (select usuario from public.perfiles where id = auth.uid());
  return new;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'mantenimientos_firma' and tgrelid = 'public.mantenimientos'::regclass) then
    create trigger mantenimientos_firma before insert on public.mantenimientos
      for each row execute function public.firmar_mantenimiento();
  end if;
end $$;

-- Agenda vinculada: cada cita puede asignarse a una posición
alter table public.citas add column if not exists posicion_id bigint references public.posiciones (id) on delete set null;
create index if not exists citas_posicion on public.citas (posicion_id, fecha);

-- Estado en tiempo real: avisar a las pantallas abiertas cuando cambia una posición
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'posiciones') then
    alter publication supabase_realtime add table public.posiciones;
  end if;
end $$;

-- ===== Pacientes: estado, foto y quién registra / modifica =====
do $$ begin
  create type public.estado_paciente as enum ('activo', 'inactivo', 'suspendido', 'baja');
exception when duplicate_object then null;
end $$;

alter table public.pacientes add column if not exists estado public.estado_paciente not null default 'activo';
alter table public.pacientes add column if not exists foto text;              -- ruta en el almacenamiento privado
alter table public.pacientes add column if not exists registrado_por text;
alter table public.pacientes add column if not exists actualizado_por text;

-- "Paciente desde" (creado) y "registrado por" se fijan al crear; "actualizado por" en cada cambio
create or replace function public.firmar_paciente()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_usuario text := (select usuario from public.perfiles where id = auth.uid());
begin
  if tg_op = 'INSERT' then
    new.creado := now();
    new.registrado_por := v_usuario;
  else
    new.creado := old.creado;
    new.registrado_por := old.registrado_por;
  end if;
  new.actualizado_por := v_usuario;
  return new;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'pacientes_firma' and tgrelid = 'public.pacientes'::regclass) then
    create trigger pacientes_firma before insert or update on public.pacientes
      for each row execute function public.firmar_paciente();
  end if;
end $$;

-- La foto de cada paciente se reemplaza en el mismo archivo (fotos/<id>.jpg)
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                 and policyname = 'personal reemplaza fotos de pacientes') then
    create policy "personal reemplaza fotos de pacientes" on storage.objects for update
      using (bucket_id = 'expedientes' and name like 'fotos/%' and public.es_personal())
      with check (bucket_id = 'expedientes' and name like 'fotos/%' and public.es_personal());
  end if;
end $$;

-- ===== Dentistas =====
do $$ begin
  create type public.estado_dentista as enum ('activo', 'inactivo', 'baja');
exception when duplicate_object then null;
end $$;

create table if not exists public.dentistas (
  id               bigint generated always as identity primary key,
  codigo           text not null,
  nombre           text not null,
  telefono         text,
  direccion        text,
  colegiado        text,                                   -- código de colegiado activo (opcional)
  inicio_profesion date,                                   -- desde cuándo ejerce como odontólogo
  especialidades   text[] not null default '{}',
  fecha_ingreso    date not null default current_date,     -- inicio en la clínica
  fecha_salida     date,                                   -- fin en la clínica
  posicion_id      bigint references public.posiciones (id) on delete set null,
  asistente_id     bigint references public.personal (id) on delete set null,
  horario          jsonb not null default '{}'::jsonb,     -- { "1": { "abre": "08:00", "cierra": "17:00" }, ... } 1 = lunes
  foto             text,
  estado           public.estado_dentista not null default 'activo',
  notas            text,
  registrado_por   text,
  creado           timestamptz not null default now(),
  actualizado_por  text,
  actualizado      timestamptz not null default now(),
  constraint dentistas_fechas check (fecha_salida is null or fecha_salida >= fecha_ingreso)
);
create unique index if not exists dentistas_codigo_unico on public.dentistas (lower(codigo));
alter table public.dentistas enable row level security;
drop policy if exists "personal ve dentistas" on public.dentistas;
create policy "personal ve dentistas" on public.dentistas for select using (public.es_personal());
drop policy if exists "personal crea dentistas" on public.dentistas;
create policy "personal crea dentistas" on public.dentistas for insert with check (public.es_personal());
drop policy if exists "personal edita dentistas" on public.dentistas;
create policy "personal edita dentistas" on public.dentistas for update
  using (public.es_personal()) with check (public.es_personal());
drop policy if exists "super administrador borra dentistas" on public.dentistas;
create policy "super administrador borra dentistas" on public.dentistas for delete using (public.es_super_administrador());

-- Usuario y fecha de registro fijos; usuario y fecha de la última modificación en cada cambio
create or replace function public.firmar_dentista()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_usuario text := (select usuario from public.perfiles where id = auth.uid());
begin
  if tg_op = 'INSERT' then
    new.creado := now();
    new.registrado_por := v_usuario;
  else
    new.creado := old.creado;
    new.registrado_por := old.registrado_por;
  end if;
  new.actualizado := now();
  new.actualizado_por := v_usuario;
  return new;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'dentistas_firma' and tgrelid = 'public.dentistas'::regclass) then
    create trigger dentistas_firma before insert or update on public.dentistas
      for each row execute function public.firmar_dentista();
  end if;
end $$;

-- Títulos (con archivo escaneado opcional)
create table if not exists public.dentista_titulos (
  id             bigint generated always as identity primary key,
  dentista_id    bigint not null references public.dentistas (id) on delete cascade,
  titulo         text not null,
  institucion    text,
  anio           int check (anio between 1950 and 2100),
  archivo        text,
  registrado_por text,
  creado         timestamptz not null default now()
);
create index if not exists dentista_titulos_dentista on public.dentista_titulos (dentista_id);
alter table public.dentista_titulos enable row level security;
drop policy if exists "personal ve titulos" on public.dentista_titulos;
create policy "personal ve titulos" on public.dentista_titulos for select using (public.es_personal());
drop policy if exists "personal registra titulos" on public.dentista_titulos;
create policy "personal registra titulos" on public.dentista_titulos for insert with check (public.es_personal());
drop policy if exists "super administrador borra titulos" on public.dentista_titulos;
create policy "super administrador borra titulos" on public.dentista_titulos for delete using (public.es_super_administrador());

create or replace function public.firmar_titulo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.registrado_por := (select usuario from public.perfiles where id = auth.uid());
  new.creado := now();
  return new;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'dentista_titulos_firma' and tgrelid = 'public.dentista_titulos'::regclass) then
    create trigger dentista_titulos_firma before insert on public.dentista_titulos
      for each row execute function public.firmar_titulo();
  end if;
end $$;
-- Fotos de dentistas: fotos/dentista-<id>.jpg (usa la regla de "fotos/" ya creada).
-- Títulos escaneados: dentistas/<id>/... (usa las reglas generales del almacenamiento de expedientes).

-- ===== Dentistas: principal o alterno en su sala =====
do $$ begin
  create type public.rol_sala as enum ('principal', 'alterno');
exception when duplicate_object then null;
end $$;

alter table public.dentistas add column if not exists rol_sala public.rol_sala not null default 'principal';

-- Si una sala quedó con más de un principal, se conserva el primero registrado y los demás pasan a alternos
update public.dentistas d
   set rol_sala = 'alterno'
 where d.rol_sala = 'principal'
   and d.posicion_id is not null
   and exists (select 1 from public.dentistas o
               where o.posicion_id = d.posicion_id and o.rol_sala = 'principal' and o.id < d.id);

-- Un solo principal por sala: al marcar uno como principal, el anterior de esa sala pasa a alterno
create or replace function public.un_principal_por_sala()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.rol_sala = 'principal' and new.posicion_id is not null then
    update public.dentistas
       set rol_sala = 'alterno'
     where posicion_id = new.posicion_id and id <> new.id and rol_sala = 'principal';
  end if;
  return null;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'dentistas_un_principal' and tgrelid = 'public.dentistas'::regclass) then
    create trigger dentistas_un_principal after insert or update of rol_sala, posicion_id on public.dentistas
      for each row execute function public.un_principal_por_sala();
  end if;
end $$;

-- ===== Equipo en la página pública =====
-- Solo se publican: nombre, especialidades, colegiado, años de experiencia y foto de dentistas activos
-- que tengan marcada la casilla "Mostrar en la página pública".

alter table public.dentistas add column if not exists mostrar_en_web boolean not null default true;
alter table public.dentistas add column if not exists foto_publica text;   -- ruta en el almacenamiento público

create or replace function public.equipo_publico()
returns table (nombre text, especialidades text[], colegiado text, inicio_profesion date, foto_publica text, actualizado timestamptz)
language sql stable security definer set search_path = public as $$
  select d.nombre, d.especialidades, d.colegiado, d.inicio_profesion, d.foto_publica, d.actualizado
    from public.dentistas d
   where d.estado = 'activo' and d.mostrar_en_web
   order by (d.rol_sala = 'alterno'), d.nombre;
$$;
grant execute on function public.equipo_publico() to anon, authenticated;

-- Almacenamiento público (solo fotos para la web, máx. 2 MB). Cualquiera puede verlas; solo el personal las cambia.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('publico', 'publico', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'personal sube fotos publicas') then
    create policy "personal sube fotos publicas" on storage.objects for insert
      with check (bucket_id = 'publico' and public.es_personal());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'personal reemplaza fotos publicas') then
    create policy "personal reemplaza fotos publicas" on storage.objects for update
      using (bucket_id = 'publico' and public.es_personal())
      with check (bucket_id = 'publico' and public.es_personal());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'personal borra fotos publicas') then
    create policy "personal borra fotos publicas" on storage.objects for delete
      using (bucket_id = 'publico' and public.es_personal());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'personal ve fotos publicas') then
    create policy "personal ve fotos publicas" on storage.objects for select
      using (bucket_id = 'publico' and public.es_personal());
  end if;
end $$;

-- ===== Agenda por dentista =====
-- La agenda pública ofrece solo los horarios en que atiende al menos un dentista activo
-- (si aún no hay dentistas con horario, se usa el horario general de la clínica).
-- Estas versiones de disponibilidad() y solicitar_cita() reemplazan a las de la sección de agenda.

alter table public.citas add column if not exists dentista_id bigint references public.dentistas (id) on delete set null;
create index if not exists citas_dentista on public.citas (dentista_id, fecha);

-- ¿El dentista atiende ese día y a esa hora?
create or replace function public.dentista_atiende(d public.dentistas, f date, h time)
returns boolean language sql stable as $$
  select d.estado = 'activo'
     and f >= d.fecha_ingreso
     and (d.fecha_salida is null or f <= d.fecha_salida)
     and (d.horario -> extract(isodow from f)::int::text) is not null
     and h >= ((d.horario -> extract(isodow from f)::int::text) ->> 'abre')::time
     and h <  ((d.horario -> extract(isodow from f)::int::text) ->> 'cierra')::time;
$$;

create or replace function public.disponibilidad(desde date, hasta date)
returns table (fecha date, hora text, libre boolean)
language sql stable security definer set search_path = public
as $$
  with turnos as (
    select dia::date as f, h
    from generate_series(desde::timestamp, least(hasta, desde + 31)::timestamp, interval '1 day') as dia,
         lateral public.turnos_del_dia(dia::date) as h
  ),
  con_horario as (
    select exists (select 1 from public.dentistas where estado = 'activo' and horario <> '{}'::jsonb) as hay
  )
  select t.f,
         to_char(t.h, 'HH24:MI'),
         (t.f + t.h) > (now() at time zone 'America/Guatemala') + interval '1 hour'
         and not exists (select 1 from public.citas c
                         where c.fecha = t.f and c.hora = t.h and c.estado <> 'cancelada')
         and not exists (select 1 from public.bloqueos b
                         where b.fecha = t.f and (b.hora is null or b.hora = t.h))
         and (not (select hay from con_horario)
              or exists (select 1 from public.dentistas d where public.dentista_atiende(d, t.f, t.h)))
  from turnos t
  order by 1, 2;
$$;

create or replace function public.solicitar_cita(p_fecha date, p_hora text, p_servicio text, p_nombre text, p_telefono text)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_id bigint;
  v_dentista bigint;
  v_posicion bigint;
begin
  if coalesce(trim(p_nombre), '') = '' or coalesce(trim(p_telefono), '') = '' then
    raise exception 'Escribe tu nombre y tu WhatsApp';
  end if;
  if length(p_nombre) > 120 or length(p_telefono) > 40 or length(p_servicio) > 60 then
    raise exception 'Los datos son demasiado largos';
  end if;
  if not exists (select 1 from public.disponibilidad(p_fecha, p_fecha) d where d.hora = p_hora and d.libre) then
    raise exception 'Ese horario ya no está disponible';
  end if;

  -- Dentista que atiende a esa hora (primero el principal de su sala) y su sala
  select d.id, d.posicion_id into v_dentista, v_posicion
    from public.dentistas d
   where public.dentista_atiende(d, p_fecha, p_hora::time)
   order by (d.rol_sala = 'alterno'), d.nombre
   limit 1;

  insert into public.citas (fecha, hora, servicio, nombre, telefono, usuario_id, dentista_id, posicion_id)
  values (p_fecha, p_hora::time, trim(p_servicio), trim(p_nombre), trim(p_telefono), auth.uid(), v_dentista, v_posicion)
  returning id into v_id;
  return v_id;
exception
  when unique_violation then
    raise exception 'Ese horario ya no está disponible';
end;
$$;

grant execute on function public.disponibilidad(date, date) to anon, authenticated;
grant execute on function public.solicitar_cita(date, text, text, text, text) to anon, authenticated;

-- ===== Pacientes: médico asignado =====
alter table public.pacientes add column if not exists dentista_id bigint references public.dentistas (id) on delete set null;
create index if not exists pacientes_dentista on public.pacientes (dentista_id);

-- ===== Agenda de clínicas: agendar desde el panel, varias salas a la vez =====
-- Cada dentista y cada sala tiene su propio cupo por horario (antes había un solo paciente por horario).
-- Estas versiones de disponibilidad() y solicitar_cita() reemplazan a las anteriores.

alter table public.citas add column if not exists paciente_id bigint references public.pacientes (id) on delete set null;
alter table public.citas add column if not exists prioridad text not null default 'normal';
alter table public.citas add column if not exists notas text;
alter table public.citas add column if not exists creada_por text;
create index if not exists citas_paciente on public.citas (paciente_id);
do $$ begin
  alter table public.citas add constraint citas_prioridad check (prioridad in ('normal', 'urgente'));
exception when duplicate_object then null;
end $$;

drop index if exists public.citas_un_paciente_por_horario;
create unique index if not exists citas_dentista_horario on public.citas (fecha, hora, dentista_id)
  where estado <> 'cancelada' and dentista_id is not null;
create unique index if not exists citas_posicion_horario on public.citas (fecha, hora, posicion_id)
  where estado <> 'cancelada' and posicion_id is not null;
create unique index if not exists citas_sin_asignar_horario on public.citas (fecha, hora)
  where estado <> 'cancelada' and dentista_id is null and posicion_id is null;

-- ¿El dentista atiende a esa hora y tanto él como su sala están libres?
create or replace function public.dentista_libre(d public.dentistas, f date, h time)
returns boolean language sql stable security definer set search_path = public as $$
  select public.dentista_atiende(d, f, h)
     and not exists (select 1 from public.citas c
                     where c.fecha = f and c.hora = h and c.estado <> 'cancelada' and c.dentista_id = d.id)
     and (d.posicion_id is null or not exists (select 1 from public.citas c
                     where c.fecha = f and c.hora = h and c.estado <> 'cancelada' and c.posicion_id = d.posicion_id));
$$;

create or replace function public.disponibilidad(desde date, hasta date)
returns table (fecha date, hora text, libre boolean)
language sql stable security definer set search_path = public
as $$
  with turnos as (
    select dia::date as f, h
    from generate_series(desde::timestamp, least(hasta, desde + 31)::timestamp, interval '1 day') as dia,
         lateral public.turnos_del_dia(dia::date) as h
  ),
  con_horario as (
    select exists (select 1 from public.dentistas where estado = 'activo' and horario <> '{}'::jsonb) as hay
  )
  select t.f,
         to_char(t.h, 'HH24:MI'),
         (t.f + t.h) > (now() at time zone 'America/Guatemala') + interval '1 hour'
         and not exists (select 1 from public.bloqueos b
                         where b.fecha = t.f and (b.hora is null or b.hora = t.h))
         and case
               when (select hay from con_horario)
                 then exists (select 1 from public.dentistas d where public.dentista_libre(d, t.f, t.h))
               else not exists (select 1 from public.citas c
                                where c.fecha = t.f and c.hora = t.h and c.estado <> 'cancelada')
             end
  from turnos t
  order by 1, 2;
$$;

create or replace function public.solicitar_cita(p_fecha date, p_hora text, p_servicio text, p_nombre text, p_telefono text)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_id bigint;
  v_dentista bigint;
  v_posicion bigint;
begin
  if coalesce(trim(p_nombre), '') = '' or coalesce(trim(p_telefono), '') = '' then
    raise exception 'Escribe tu nombre y tu WhatsApp';
  end if;
  if length(p_nombre) > 120 or length(p_telefono) > 40 or length(p_servicio) > 60 then
    raise exception 'Los datos son demasiado largos';
  end if;
  if not exists (select 1 from public.disponibilidad(p_fecha, p_fecha) d where d.hora = p_hora and d.libre) then
    raise exception 'Ese horario ya no está disponible';
  end if;

  -- Dentista libre a esa hora (primero el principal de su sala) y su sala
  select d.id, d.posicion_id into v_dentista, v_posicion
    from public.dentistas d
   where public.dentista_libre(d, p_fecha, p_hora::time)
   order by (d.rol_sala = 'alterno'), d.nombre
   limit 1;

  insert into public.citas (fecha, hora, servicio, nombre, telefono, usuario_id, dentista_id, posicion_id)
  values (p_fecha, p_hora::time, trim(p_servicio), trim(p_nombre), trim(p_telefono), auth.uid(), v_dentista, v_posicion)
  returning id into v_id;
  return v_id;
exception
  when unique_violation then
    raise exception 'Ese horario ya no está disponible';
end;
$$;

-- Agendar desde el panel (personal): paciente del expediente o nuevo, dentista, sala, prioridad y notas
create or replace function public.agendar_cita(
  p_fecha date, p_hora text, p_paciente_id bigint, p_nombre text, p_telefono text, p_servicio text,
  p_dentista_id bigint, p_posicion_id bigint, p_prioridad text, p_notas text, p_estado text)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_id bigint;
  v_nombre text := trim(coalesce(p_nombre, ''));
  v_tel text := trim(coalesce(p_telefono, ''));
begin
  if not public.es_personal() then
    raise exception 'No tienes permiso para esta acción';
  end if;
  if p_paciente_id is not null then
    select coalesce(nullif(v_nombre, ''), nombre), coalesce(nullif(v_tel, ''), telefono, '')
      into v_nombre, v_tel
      from public.pacientes where id = p_paciente_id;
  end if;
  if coalesce(v_nombre, '') = '' then
    raise exception 'Indica el paciente';
  end if;
  if exists (select 1 from public.bloqueos b where b.fecha = p_fecha and (b.hora is null or b.hora = p_hora::time)) then
    raise exception 'Ese horario está bloqueado';
  end if;

  insert into public.citas (fecha, hora, servicio, nombre, telefono, paciente_id, dentista_id, posicion_id,
                            prioridad, notas, estado, creada_por)
  values (p_fecha, p_hora::time, coalesce(nullif(trim(p_servicio), ''), 'Evaluación general'), v_nombre, v_tel,
          p_paciente_id, p_dentista_id, p_posicion_id,
          case when p_prioridad = 'urgente' then 'urgente' else 'normal' end,
          nullif(trim(p_notas), ''),
          case when p_estado = 'pendiente' then 'pendiente'::public.estado_cita else 'confirmada'::public.estado_cita end,
          (select usuario from public.perfiles where id = auth.uid()))
  returning id into v_id;
  return v_id;
exception
  when unique_violation then
    raise exception 'Ese horario ya está ocupado para ese dentista o esa sala';
end;
$$;

grant execute on function public.disponibilidad(date, date) to anon, authenticated;
grant execute on function public.solicitar_cita(date, text, text, text, text) to anon, authenticated;
revoke execute on function public.agendar_cita(date, text, bigint, text, text, text, bigint, bigint, text, text, text) from public, anon;
grant execute on function public.agendar_cita(date, text, bigint, text, text, text, bigint, bigint, text, text, text) to authenticated;

-- ===== Correo electrónico de pacientes y dentistas (avisos y recordatorios) =====
alter table public.pacientes add column if not exists correo text;
alter table public.dentistas add column if not exists correo text;

-- ===== Recordatorios automáticos por correo =====
-- La función «recordatorios» marca aquí cuándo envió el recordatorio de cada cita (para no repetirlo).
-- Lo usan tanto la función «recordatorios» (Brevo) como el script de Google (Gmail) de la sección siguiente.
alter table public.citas add column if not exists recordatorio_enviado timestamptz;

-- ===== Recordatorios por correo desde Gmail (Google Apps Script) =====
-- Un script de Google en la cuenta de la clínica consulta cada mañana las citas de mañana y envía los correos.
-- Para poder leerlas usa una clave privada que se guarda en config_privada (nunca en este archivo).

create table if not exists public.config_privada (
  clave text primary key,
  valor text not null
);
alter table public.config_privada enable row level security;
-- Sin reglas de acceso: nadie puede leerla desde la página; solo las funciones de abajo.

create or replace function public.clave_valida(p_clave text, p_valor text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_valor is not null and exists (select 1 from public.config_privada where clave = p_clave and valor = p_valor);
$$;
revoke execute on function public.clave_valida(text, text) from public, anon, authenticated;

-- Citas de mañana (hora de Guatemala) con correo del paciente y sin recordatorio enviado
create or replace function public.recordatorios_pendientes(p_secreto text)
returns table (cita_id bigint, cita_fecha date, cita_hora text, tratamiento text, paciente text, correo text, dentista text, sala text)
language plpgsql security definer set search_path = public as $$
begin
  if not public.clave_valida('recordatorios', p_secreto) then
    raise exception 'No autorizado';
  end if;
  return query
  select c.id, c.fecha, to_char(c.hora, 'HH24:MI'), c.servicio, c.nombre, p.correo, d.nombre,
         case when s.id is null then null else s.codigo || ' · ' || s.nombre end
    from public.citas c
    join public.pacientes p on p.id = c.paciente_id
    left join public.dentistas d on d.id = c.dentista_id
    left join public.posiciones s on s.id = c.posicion_id
   where c.fecha = ((now() at time zone 'America/Guatemala')::date + 1)
     and c.estado in ('pendiente', 'confirmada')
     and c.recordatorio_enviado is null
     and coalesce(trim(p.correo), '') <> ''
   order by c.hora;
end;
$$;

create or replace function public.marcar_recordatorio(p_secreto text, p_cita bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.clave_valida('recordatorios', p_secreto) then
    raise exception 'No autorizado';
  end if;
  update public.citas set recordatorio_enviado = now() where id = p_cita;
end;
$$;

grant execute on function public.recordatorios_pendientes(text) to anon, authenticated;
grant execute on function public.marcar_recordatorio(text, bigint) to anon, authenticated;

-- ===== Historias de impacto =====
-- Fotos, videos y casos de antes y después de pacientes que autorizaron su publicación.
-- La página pública solo ve las historias marcadas como publicadas; el personal las administra.

create table if not exists public.historias (
  id bigint generated always as identity primary key,
  tipo text not null default 'foto' check (tipo in ('foto', 'video', 'antes_despues')),
  titulo text not null check (char_length(titulo) between 1 and 120),
  descripcion text check (char_length(descripcion) <= 600),
  tratamiento text check (char_length(tratamiento) <= 80),
  detalle text check (char_length(detalle) <= 80),          -- ej.: «14 meses», «3 citas»
  archivo text,                                              -- foto, video subido o foto de «antes»
  archivo2 text,                                             -- foto de «después»
  video_url text check (char_length(video_url) <= 300),     -- enlace de YouTube
  consentimiento boolean not null default false,             -- el paciente firmó la autorización
  publicada boolean not null default false,
  orden int not null default 0,
  creado_por uuid default auth.uid() references auth.users (id) on delete set null,
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now(),
  constraint historias_con_permiso check (not publicada or consentimiento),
  constraint historias_con_medios check (not publicada or case tipo
    when 'foto' then archivo is not null
    when 'video' then archivo is not null or video_url is not null
    else archivo is not null and archivo2 is not null end)
);
create index if not exists historias_publicadas on public.historias (publicada, orden, creado desc);

create or replace function public.historias_actualizado()
returns trigger language plpgsql set search_path = public as $$
begin
  new.actualizado := now();
  return new;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'historias_actualizado' and tgrelid = 'public.historias'::regclass) then
    create trigger historias_actualizado before update on public.historias
      for each row execute function public.historias_actualizado();
  end if;
end $$;

alter table public.historias enable row level security;
drop policy if exists "historias publicadas visibles" on public.historias;
create policy "historias publicadas visibles" on public.historias for select
  using (publicada and consentimiento);
drop policy if exists "personal administra historias" on public.historias;
create policy "personal administra historias" on public.historias for all
  using (public.es_personal()) with check (public.es_personal());
grant select on public.historias to anon, authenticated;
grant insert, update, delete on public.historias to authenticated;

-- Almacenamiento de las historias: fotos y videos (máx. 50 MB por archivo). Cualquiera puede verlos; solo el personal los sube.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('historias', 'historias', true, 52428800,
        array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'personal sube historias') then
    create policy "personal sube historias" on storage.objects for insert
      with check (bucket_id = 'historias' and public.es_personal());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'personal reemplaza historias') then
    create policy "personal reemplaza historias" on storage.objects for update
      using (bucket_id = 'historias' and public.es_personal())
      with check (bucket_id = 'historias' and public.es_personal());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'personal borra historias') then
    create policy "personal borra historias" on storage.objects for delete
      using (bucket_id = 'historias' and public.es_personal());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'personal ve historias') then
    create policy "personal ve historias" on storage.objects for select
      using (bucket_id = 'historias' and public.es_personal());
  end if;
end $$;

-- ===== Agentes comerciales (vendedores) =====
-- Código, nombre, fecha de inicio, % de comisión y estado. Quién lo ingresó, cuándo, y el último
-- cambio de estado (fecha y usuario) los pone el sistema automáticamente. Solo para el personal.

create table if not exists public.agentes (
  id bigint generated always as identity primary key,
  codigo text not null check (char_length(codigo) between 1 and 20),
  nombre text not null check (char_length(nombre) between 1 and 150),
  fecha_inicio date not null default current_date,
  comision numeric(5,2) not null default 0 check (comision between 0 and 100),
  estado text not null default 'activo' check (estado in ('activo', 'suspendido', 'inactivo')),
  registrado_por text,
  creado timestamptz not null default now(),
  estado_cambiado timestamptz,
  estado_cambiado_por text,
  actualizado timestamptz not null default now()
);
create unique index if not exists agentes_codigo_unico on public.agentes (upper(codigo));
alter table public.agentes add column if not exists telefono text check (char_length(telefono) <= 40);
alter table public.agentes add column if not exists foto text;   -- ruta en el almacenamiento privado (expedientes/fotos/agente-ID.jpg)

create or replace function public.agentes_auditoria()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_usuario text := (select usuario from public.perfiles where id = auth.uid());
begin
  if tg_op = 'INSERT' then
    -- El código lo asigna el sistema: el siguiente número (1, 2, 3…). Lo que se envíe se ignora.
    -- Solo el agente 0 «NINGUNO» se crea con su código, y únicamente si todavía no existe.
    if new.codigo is distinct from '0' or exists (select 1 from public.agentes where codigo = '0') then
      perform pg_advisory_xact_lock(hashtext('agentes_codigo'));   -- dos altas a la vez no reciben el mismo número
      new.codigo := (select coalesce(max(codigo::int), 0) + 1 from public.agentes where codigo ~ '^\d+$')::text;
    end if;
    new.registrado_por := coalesce(v_usuario, 'sistema');
    new.creado := now();
    new.estado_cambiado := null;
    new.estado_cambiado_por := null;
  else
    new.codigo := old.codigo;   -- el código no se puede cambiar
    new.registrado_por := old.registrado_por;
    new.creado := old.creado;
    if new.estado is distinct from old.estado then
      new.estado_cambiado := now();
      new.estado_cambiado_por := v_usuario;
    else
      new.estado_cambiado := old.estado_cambiado;
      new.estado_cambiado_por := old.estado_cambiado_por;
    end if;
  end if;
  new.nombre := trim(new.nombre);
  new.actualizado := now();
  return new;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'agentes_auditoria' and tgrelid = 'public.agentes'::regclass) then
    create trigger agentes_auditoria before insert or update on public.agentes
      for each row execute function public.agentes_auditoria();
  end if;
end $$;

alter table public.agentes enable row level security;
drop policy if exists "personal administra agentes" on public.agentes;
create policy "personal administra agentes" on public.agentes for all
  using (public.es_personal()) with check (public.es_personal());
grant select, insert, update, delete on public.agentes to authenticated;

-- Agente 0 «NINGUNO»: se usa cuando no hay agente comercial. Es fijo: no se puede modificar ni eliminar.
create or replace function public.agentes_fijo()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.codigo = '0' then
    raise exception 'agente_fijo: el agente 0 (NINGUNO) es del sistema y no se puede modificar ni eliminar';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'agentes_fijo' and tgrelid = 'public.agentes'::regclass) then
    create trigger agentes_fijo before update or delete on public.agentes
      for each row execute function public.agentes_fijo();
  end if;
end $$;
insert into public.agentes (codigo, nombre, fecha_inicio, comision, estado)
select '0', 'NINGUNO', current_date, 0, 'activo'
where not exists (select 1 from public.agentes where codigo = '0');

-- Agentes que se grabaron antes con códigos escritos a mano (p. ej. «AGE-001»): reciben el siguiente número,
-- en el orden en que se ingresaron. Solo hace algo la primera vez.
do $$
declare
  r record;
  n int;
begin
  if exists (select 1 from public.agentes where codigo !~ '^\d+$') then
    alter table public.agentes disable trigger agentes_auditoria;   -- este trigger impide cambiar códigos
    select coalesce(max(codigo::int), 0) into n from public.agentes where codigo ~ '^\d+$';
    for r in select id from public.agentes where codigo !~ '^\d+$' order by creado, id loop
      n := n + 1;
      update public.agentes set codigo = n::text where id = r.id;
    end loop;
    alter table public.agentes enable trigger agentes_auditoria;
  end if;
end $$;

-- Agente comercial de cada paciente. Si no se elige (o se elimina el agente), queda el 0 «NINGUNO».
alter table public.pacientes add column if not exists agente_id bigint references public.agentes (id) on delete set null;
create index if not exists pacientes_agente on public.pacientes (agente_id);

create or replace function public.paciente_agente_defecto()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.agente_id is null then
    new.agente_id := (select id from public.agentes where codigo = '0');
  end if;
  return new;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'pacientes_agente_defecto' and tgrelid = 'public.pacientes'::regclass) then
    create trigger pacientes_agente_defecto before insert or update of agente_id on public.pacientes
      for each row execute function public.paciente_agente_defecto();
  end if;
end $$;

-- Pacientes que ya existían: quedan con el agente 0 (sin tocar su fecha ni usuario de última modificación)
do $$ begin
  if exists (select 1 from public.pacientes where agente_id is null) then
    alter table public.pacientes disable trigger pacientes_actualizado;
    alter table public.pacientes disable trigger pacientes_firma;
    update public.pacientes set agente_id = (select id from public.agentes where codigo = '0') where agente_id is null;
    alter table public.pacientes enable trigger pacientes_actualizado;
    alter table public.pacientes enable trigger pacientes_firma;
  end if;
end $$;

-- ===== Precios por procedimiento =====
-- Cada procedimiento del catálogo de tratamientos puede tener un precio por tipo:
-- Cliente directo, Institucional, VIP, Paquete y Especial; con su % de descuento máximo y su estado.
-- Quién lo registró y quién lo modificó por última vez los pone el sistema. Solo para el personal.

create table if not exists public.precios (
  id              bigint generated always as identity primary key,
  tratamiento_id  bigint not null references public.tratamientos (id) on delete cascade,
  tipo            text not null default 'especial' check (tipo in ('directo', 'institucional', 'vip', 'referido', 'paquete', 'especial')),
  valor           numeric(10,2) not null check (valor >= 0),
  descuento_max   numeric(5,2) not null default 0 check (descuento_max between 0 and 100),
  estado          text not null default 'activo' check (estado in ('activo', 'suspendido', 'baja')),
  registrado_por  text,
  creado          timestamptz not null default now(),
  actualizado_por text,
  actualizado     timestamptz not null default now()
);
create unique index if not exists precios_tratamiento_tipo on public.precios (tratamiento_id, tipo);
-- Estado por defecto: Activo. Valor en dólares (opcional). Fecha del precio: por defecto la de hoy al ingresarlo o actualizarlo.
alter table public.precios alter column estado set default 'activo';
alter table public.precios add column if not exists valor_usd numeric(10,2) check (valor_usd >= 0);
alter table public.precios add column if not exists fecha date not null default current_date;
-- Tipo de precio «Referido» (también en tablas ya creadas)
alter table public.precios drop constraint if exists precios_tipo_check;
alter table public.precios add constraint precios_tipo_check check (tipo in ('directo', 'institucional', 'vip', 'referido', 'paquete', 'especial'));

create or replace function public.precios_auditoria()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_usuario text := (select usuario from public.perfiles where id = auth.uid());
begin
  if tg_op = 'INSERT' then
    new.registrado_por := coalesce(v_usuario, 'sistema');
    new.creado := now();
  else
    new.registrado_por := old.registrado_por;
    new.creado := old.creado;
    new.tratamiento_id := old.tratamiento_id;   -- un precio no se mueve a otro procedimiento
  end if;
  new.fecha := coalesce(new.fecha, current_date);
  new.actualizado_por := coalesce(v_usuario, 'sistema');
  new.actualizado := now();
  return new;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'precios_auditoria' and tgrelid = 'public.precios'::regclass) then
    create trigger precios_auditoria before insert or update on public.precios
      for each row execute function public.precios_auditoria();
  end if;
end $$;

-- El personal ve los precios; solo el Super Administrador los crea, modifica o elimina
alter table public.precios enable row level security;
drop policy if exists "personal administra precios" on public.precios;
drop policy if exists "personal ve precios" on public.precios;
create policy "personal ve precios" on public.precios for select using (public.es_personal());
drop policy if exists "super administrador crea precios" on public.precios;
create policy "super administrador crea precios" on public.precios for insert with check (public.es_super_administrador());
drop policy if exists "super administrador modifica precios" on public.precios;
create policy "super administrador modifica precios" on public.precios for update
  using (public.es_super_administrador()) with check (public.es_super_administrador());
drop policy if exists "super administrador elimina precios" on public.precios;
create policy "super administrador elimina precios" on public.precios for delete using (public.es_super_administrador());
grant select, insert, update, delete on public.precios to authenticated;

-- ===== Paquetes =====
-- Un paquete agrupa procedimientos del catálogo (con cantidad) a un precio especial (en Q y, opcional, en US$),
-- con vigencia, % de descuento máximo, estado (por defecto Activo) y fecha (por defecto la de hoy al ingresarlo o
-- actualizarlo). El código (PAQ-1, PAQ-2…) lo asigna el sistema. El personal los ve; solo el Super Administrador
-- los crea, modifica o elimina. Los activos y vigentes se muestran en la página pública (paquetes_publicos).

create table if not exists public.paquetes (
  id              bigint generated always as identity primary key,
  codigo          text,
  nombre          text not null check (char_length(nombre) between 1 and 120),
  descripcion     text check (char_length(descripcion) <= 500),
  precio          numeric(10,2) not null check (precio >= 0),
  descuento_max   numeric(5,2) not null default 0 check (descuento_max between 0 and 100),
  vigente_desde   date not null default current_date,
  vigente_hasta   date,
  estado          text not null default 'activo' check (estado in ('activo', 'suspendido', 'baja')),
  registrado_por  text,
  creado          timestamptz not null default now(),
  actualizado_por text,
  actualizado     timestamptz not null default now(),
  constraint paquetes_vigencia check (vigente_hasta is null or vigente_hasta >= vigente_desde)
);
create unique index if not exists paquetes_codigo_unico on public.paquetes (codigo);
alter table public.paquetes alter column estado set default 'activo';
alter table public.paquetes add column if not exists precio_usd numeric(10,2) check (precio_usd >= 0);
alter table public.paquetes add column if not exists fecha date not null default current_date;

create table if not exists public.paquete_items (
  id             bigint generated always as identity primary key,
  paquete_id     bigint not null references public.paquetes (id) on delete cascade,
  tratamiento_id bigint not null references public.tratamientos (id) on delete cascade,
  cantidad       int not null default 1 check (cantidad between 1 and 99)
);
create unique index if not exists paquete_items_unico on public.paquete_items (paquete_id, tratamiento_id);

create or replace function public.paquetes_auditoria()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_usuario text := (select usuario from public.perfiles where id = auth.uid());
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('paquetes_codigo'));
    new.codigo := 'PAQ-' || (select coalesce(max(substring(codigo from 5)::int), 0) + 1 from public.paquetes where codigo ~ '^PAQ-\d+$');
    new.registrado_por := coalesce(v_usuario, 'sistema');
    new.creado := now();
  else
    new.codigo := old.codigo;
    new.registrado_por := old.registrado_por;
    new.creado := old.creado;
  end if;
  new.nombre := trim(new.nombre);
  new.fecha := coalesce(new.fecha, current_date);
  new.actualizado_por := coalesce(v_usuario, 'sistema');
  new.actualizado := now();
  return new;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'paquetes_auditoria' and tgrelid = 'public.paquetes'::regclass) then
    create trigger paquetes_auditoria before insert or update on public.paquetes
      for each row execute function public.paquetes_auditoria();
  end if;
end $$;

-- El personal ve los paquetes; solo el Super Administrador los crea, modifica o elimina
alter table public.paquetes enable row level security;
alter table public.paquete_items enable row level security;
drop policy if exists "personal administra paquetes" on public.paquetes;
drop policy if exists "personal ve paquetes" on public.paquetes;
create policy "personal ve paquetes" on public.paquetes for select using (public.es_personal());
drop policy if exists "super administrador cambia paquetes" on public.paquetes;
create policy "super administrador cambia paquetes" on public.paquetes for all
  using (public.es_super_administrador()) with check (public.es_super_administrador());
drop policy if exists "personal administra paquete_items" on public.paquete_items;
drop policy if exists "personal ve paquete_items" on public.paquete_items;
create policy "personal ve paquete_items" on public.paquete_items for select using (public.es_personal());
drop policy if exists "super administrador cambia paquete_items" on public.paquete_items;
create policy "super administrador cambia paquete_items" on public.paquete_items for all
  using (public.es_super_administrador()) with check (public.es_super_administrador());
grant select, insert, update, delete on public.paquetes, public.paquete_items to authenticated;

-- Graba el paquete y sus procedimientos en un solo paso (si algo falla, no se guarda nada).
-- Cada procedimiento llega como {tratamiento_id, cantidad} o, si es un sugerido de «Tipos de procedimientos»
-- que aún no está en el catálogo, como {nombre, tipo_id, cantidad}: entonces se agrega al catálogo.
drop function if exists public.guardar_paquete(bigint, text, text, numeric, numeric, date, date, text, jsonb);
create or replace function public.guardar_paquete(
  p_id bigint, p_nombre text, p_descripcion text, p_precio numeric, p_descuento numeric,
  p_desde date, p_hasta date, p_estado text, p_items jsonb, p_precio_usd numeric default null, p_fecha date default null)
returns bigint language plpgsql security invoker set search_path = public as $$
declare
  v_id bigint;
  e jsonb;
  v_trat bigint;
begin
  if not public.es_super_administrador() then
    raise exception 'Solo el Super Administrador puede crear o modificar paquetes';
  end if;
  if p_id is null then
    insert into public.paquetes (nombre, descripcion, precio, precio_usd, descuento_max, vigente_desde, vigente_hasta, estado, fecha)
    values (p_nombre, nullif(trim(p_descripcion), ''), p_precio, p_precio_usd, coalesce(p_descuento, 0), coalesce(p_desde, current_date), p_hasta,
            coalesce(p_estado, 'activo'), coalesce(p_fecha, current_date))
    returning id into v_id;
  else
    update public.paquetes set nombre = p_nombre, descripcion = nullif(trim(p_descripcion), ''), precio = p_precio, precio_usd = p_precio_usd,
           descuento_max = coalesce(p_descuento, 0), vigente_desde = coalesce(p_desde, current_date), vigente_hasta = p_hasta,
           estado = coalesce(p_estado, 'activo'), fecha = coalesce(p_fecha, current_date)
     where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'El paquete no existe'; end if;
    delete from public.paquete_items where paquete_id = v_id;
  end if;
  for e in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_trat := nullif(e ->> 'tratamiento_id', '')::bigint;
    if v_trat is null then
      select id into v_trat from public.tratamientos where lower(nombre) = lower(trim(e ->> 'nombre'));
      if v_trat is null then
        insert into public.tratamientos (nombre, precio, tipo_id)
        values (trim(e ->> 'nombre'), 0, nullif(e ->> 'tipo_id', '')::bigint)
        returning id into v_trat;
      end if;
    end if;
    insert into public.paquete_items (paquete_id, tratamiento_id, cantidad)
    values (v_id, v_trat, greatest(1, coalesce((e ->> 'cantidad')::int, 1)))
    on conflict (paquete_id, tratamiento_id) do update set cantidad = excluded.cantidad;
  end loop;
  return v_id;
end;
$$;
revoke execute on function public.guardar_paquete(bigint, text, text, numeric, numeric, date, date, text, jsonb, numeric, date) from public, anon;
grant execute on function public.guardar_paquete(bigint, text, text, numeric, numeric, date, date, text, jsonb, numeric, date) to authenticated;

-- Paquetes para la página pública: solo los activos y vigentes hoy, con sus procedimientos y el precio normal
-- (precio «Cliente directo» activo de cada procedimiento o, si no tiene, el del catálogo).
drop function if exists public.paquetes_publicos();
create or replace function public.paquetes_publicos()
returns table (nombre text, descripcion text, precio numeric, precio_usd numeric, precio_normal numeric, vigente_hasta date, incluye jsonb)
language sql stable security definer set search_path = public as $$
  select p.nombre, p.descripcion, p.precio, p.precio_usd,
         coalesce(sum(i.cantidad * coalesce(pr.valor, t.precio)), 0) as precio_normal,
         p.vigente_hasta,
         coalesce(jsonb_agg(jsonb_build_object('nombre', t.nombre, 'cantidad', i.cantidad) order by t.nombre) filter (where t.id is not null), '[]'::jsonb)
    from public.paquetes p
    left join public.paquete_items i on i.paquete_id = p.id
    left join public.tratamientos t on t.id = i.tratamiento_id
    left join public.precios pr on pr.tratamiento_id = t.id and pr.tipo = 'directo' and pr.estado = 'activo'
   where p.estado = 'activo'
     and p.vigente_desde <= current_date
     and (p.vigente_hasta is null or p.vigente_hasta >= current_date)
   group by p.id
   order by p.precio;
$$;
grant execute on function public.paquetes_publicos() to anon, authenticated;

-- ===== Presupuestos con tipo de precio =====
-- Cada presupuesto usa un tipo de precio (por defecto «Cliente directo»). El descuento del presupuesto no puede
-- pasar del % máximo más bajo de los precios activos de ese tipo para sus tratamientos.
-- Esta versión de guardar_presupuesto reemplaza a la de la sección de presupuestos.

alter table public.presupuestos add column if not exists tipo_precio text not null default 'directo'
  check (tipo_precio in ('directo', 'institucional', 'vip', 'referido', 'paquete', 'especial'));
alter table public.presupuestos drop constraint if exists presupuestos_tipo_precio_check;
alter table public.presupuestos add constraint presupuestos_tipo_precio_check check (tipo_precio in ('directo', 'institucional', 'vip', 'referido', 'paquete', 'especial'));

drop function if exists public.guardar_presupuesto(bigint, numeric, text, jsonb);
create or replace function public.guardar_presupuesto(p_id bigint, p_descuento numeric, p_notas text, p_items jsonb, p_tipo text default 'directo')
returns void language plpgsql security definer set search_path = public as $$
declare
  v_estado public.estado_presupuesto;
  v_tipo text := coalesce(p_tipo, 'directo');
  v_max numeric;
begin
  if not public.es_personal() then
    raise exception 'No tienes permiso para esta acción';
  end if;
  if v_tipo not in ('directo', 'institucional', 'vip', 'referido', 'paquete', 'especial') then
    raise exception 'Tipo de precio no válido';
  end if;
  select estado into v_estado from public.presupuestos where id = p_id;
  if v_estado is null then
    raise exception 'Presupuesto no encontrado';
  end if;
  if v_estado in ('aprobado', 'rechazado') then
    raise exception 'Un presupuesto aprobado o rechazado ya no se puede modificar';
  end if;

  -- Descuento máximo: el más bajo de los precios activos de este tipo para los tratamientos del presupuesto
  select min(pr.descuento_max) into v_max
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e
    join public.tratamientos t on lower(t.nombre) = lower(trim(e ->> 'tratamiento'))
    join public.precios pr on pr.tratamiento_id = t.id and pr.tipo = v_tipo and pr.estado = 'activo';
  if v_max is not null and coalesce(p_descuento, 0) > v_max then
    raise exception 'El descuento máximo permitido con este tipo de precio es % %%', trim(trailing '.' from trim(trailing '0' from v_max::text));
  end if;

  update public.presupuestos
     set descuento_pct = coalesce(p_descuento, 0), notas = nullif(trim(p_notas), ''), tipo_precio = v_tipo
   where id = p_id;

  delete from public.presupuesto_items where presupuesto_id = p_id;
  insert into public.presupuesto_items (presupuesto_id, orden, tratamiento, pieza, cantidad, precio)
  select p_id, t.ord, trim(t.i ->> 'tratamiento'), nullif(trim(t.i ->> 'pieza'), ''),
         greatest(coalesce((t.i ->> 'cantidad')::int, 1), 1), greatest(coalesce((t.i ->> 'precio')::numeric, 0), 0)
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as t(i, ord)
  where coalesce(trim(t.i ->> 'tratamiento'), '') <> '';
end;
$$;
revoke execute on function public.guardar_presupuesto(bigint, numeric, text, jsonb, text) from public, anon;
grant execute on function public.guardar_presupuesto(bigint, numeric, text, jsonb, text) to authenticated;

-- ===== Tipos de procedimientos =====
-- Catálogo de los tipos de procedimientos dentales que se ofrecen en Guatemala, cada uno con su descripción y
-- sus procedimientos más comunes (sugeridos). Los tratamientos del catálogo se clasifican en un tipo.
-- El código (TP-01, TP-02…) lo asigna el sistema. Solo para el personal.

create table if not exists public.tipos_procedimiento (
  id              bigint generated always as identity primary key,
  codigo          text,
  nombre          text not null check (char_length(nombre) between 1 and 120),
  descripcion     text check (char_length(descripcion) <= 500),
  sugeridos       text[] not null default '{}',
  estado          text not null default 'activo' check (estado in ('activo', 'inactivo')),
  orden           int not null default 0,
  registrado_por  text,
  creado          timestamptz not null default now(),
  actualizado_por text,
  actualizado     timestamptz not null default now()
);
create unique index if not exists tipos_procedimiento_nombre on public.tipos_procedimiento (lower(nombre));
create unique index if not exists tipos_procedimiento_codigo on public.tipos_procedimiento (codigo);

create or replace function public.tipos_procedimiento_auditoria()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_usuario text := (select usuario from public.perfiles where id = auth.uid());
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('tipos_procedimiento_codigo'));
    new.codigo := 'TP-' || lpad(((select coalesce(max(substring(codigo from 4)::int), 0) from public.tipos_procedimiento where codigo ~ '^TP-\d+$') + 1)::text, 2, '0');
    new.registrado_por := coalesce(v_usuario, 'sistema');
    new.creado := now();
  else
    new.codigo := old.codigo;
    new.registrado_por := old.registrado_por;
    new.creado := old.creado;
  end if;
  new.nombre := trim(new.nombre);
  new.actualizado_por := coalesce(v_usuario, 'sistema');
  new.actualizado := now();
  return new;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'tipos_procedimiento_auditoria' and tgrelid = 'public.tipos_procedimiento'::regclass) then
    create trigger tipos_procedimiento_auditoria before insert or update on public.tipos_procedimiento
      for each row execute function public.tipos_procedimiento_auditoria();
  end if;
end $$;

alter table public.tipos_procedimiento enable row level security;
drop policy if exists "personal administra tipos de procedimiento" on public.tipos_procedimiento;
create policy "personal administra tipos de procedimiento" on public.tipos_procedimiento for all
  using (public.es_personal()) with check (public.es_personal());
grant select, insert, update, delete on public.tipos_procedimiento to authenticated;

-- Cada tratamiento del catálogo puede pertenecer a un tipo
alter table public.tratamientos add column if not exists tipo_id bigint references public.tipos_procedimiento (id) on delete set null;
create index if not exists tratamientos_tipo on public.tratamientos (tipo_id);

-- Tipos de procedimientos que se ofrecen en Guatemala (solo se agregan los que falten)
insert into public.tipos_procedimiento (nombre, descripcion, sugeridos, orden)
select v.nombre, v.descripcion, v.sugeridos, v.orden
  from (values
    (1, 'Odontología general y preventiva', 'Revisión, diagnóstico, limpieza y tratamientos básicos para mantener la boca sana y prevenir problemas.',
     array['Examen y diagnóstico', 'Limpieza dental (profilaxis)', 'Aplicación de flúor', 'Selladores de fosas y fisuras', 'Resina de una superficie', 'Resina de varias superficies', 'Extracción simple']),
    (2, 'Endodoncia', 'Tratamiento del nervio y los conductos del diente para eliminar el dolor o la infección y conservar la pieza.',
     array['Tratamiento de conductos unirradicular', 'Tratamiento de conductos birradicular', 'Tratamiento de conductos multirradicular (molar)', 'Retratamiento de conductos', 'Pulpotomía', 'Apicectomía']),
    (3, 'Periodoncia', 'Prevención y tratamiento de las enfermedades de las encías y del hueso que sostiene los dientes.',
     array['Raspado y alisado radicular (por cuadrante)', 'Curetaje', 'Cirugía periodontal', 'Injerto de encía', 'Alargamiento de corona', 'Mantenimiento periodontal']),
    (4, 'Ortodoncia y ortopedia maxilar', 'Corrección de la posición de los dientes y del crecimiento de los maxilares.',
     array['Estudio de ortodoncia', 'Brackets metálicos', 'Brackets estéticos', 'Alineadores transparentes', 'Control mensual de ortodoncia', 'Retenedor', 'Aparato de ortopedia maxilar']),
    (5, 'Prostodoncia y rehabilitación oral', 'Reposición y restauración de dientes dañados o perdidos con coronas, puentes y prótesis.',
     array['Corona de porcelana', 'Corona de zirconia', 'Puente fijo (por pieza)', 'Prótesis removible parcial', 'Prótesis total (placa completa)', 'Incrustación (inlay/onlay)', 'Perno o poste']),
    (6, 'Implantología', 'Reemplazo de dientes perdidos con implantes de titanio y las coronas o prótesis que van sobre ellos.',
     array['Evaluación con tomografía', 'Implante dental', 'Corona sobre implante', 'Injerto óseo', 'Elevación de seno maxilar', 'Prótesis sobre implantes (All-on-4)']),
    (7, 'Cirugía oral y maxilofacial', 'Procedimientos quirúrgicos de la boca y los maxilares.',
     array['Extracción quirúrgica', 'Extracción de cordal (muela del juicio)', 'Frenectomía', 'Biopsia oral', 'Drenaje de absceso']),
    (8, 'Odontología estética', 'Tratamientos para mejorar el color, la forma y la armonía de la sonrisa.',
     array['Blanqueamiento en consultorio', 'Blanqueamiento en casa (férulas)', 'Carillas de resina', 'Carillas de porcelana', 'Diseño de sonrisa', 'Contorneado de encía']),
    (9, 'Odontopediatría', 'Atención dental de bebés, niños y adolescentes, con enfoque preventivo.',
     array['Primera consulta infantil', 'Limpieza y flúor infantil', 'Selladores infantiles', 'Pulpotomía en diente de leche', 'Corona de acero', 'Mantenedor de espacio']),
    (10, 'Radiología y diagnóstico por imagen', 'Estudios de imagen para diagnosticar y planificar tratamientos con precisión.',
     array['Radiografía periapical', 'Radiografía panorámica', 'Radiografía cefálica lateral', 'Tomografía 3D (CBCT)', 'Fotografías clínicas']),
    (11, 'Trastornos de la ATM y bruxismo', 'Diagnóstico y tratamiento del dolor de mandíbula y del apretamiento o rechinido de dientes.',
     array['Evaluación de ATM', 'Férula de descarga (placa miorrelajante)', 'Ajuste oclusal']),
    (12, 'Urgencias dentales', 'Atención inmediata del dolor, las infecciones y los golpes o fracturas dentales.',
     array['Consulta de urgencia', 'Drenaje y control de infección', 'Recementado de corona', 'Reparación de fractura dental'])
  ) as v(orden, nombre, descripcion, sugeridos)
 where not exists (select 1 from public.tipos_procedimiento t where lower(t.nombre) = lower(v.nombre))
 order by v.orden;

-- ===== NIT del paciente =====
-- Número de identificación tributaria (texto; p. ej. «1234567-8» o «CF» para consumidor final).
alter table public.pacientes add column if not exists nit text check (char_length(nit) <= 20);

-- ===== Cobros con documento (factura o recibo) y detalle =====
-- Cada pago guarda los datos del documento: NIT, tipo (factura o recibo), serie, número de factura, número DTE (FEL),
-- monto en dólares, número de cuota, estado (Emitido, Aplicado, Certificado, Anulado) y observaciones.
-- El detalle tiene líneas numeradas (tipo de procedimiento, clasificación Bien o Servicio, monto Q y US$).
-- El monto del pago (Q y US$) es la suma de su detalle. Se registra todo junto con registrar_pago().

alter table public.pagos add column if not exists nit text check (char_length(nit) <= 20);
alter table public.pagos add column if not exists tipo_documento text not null default 'recibo' check (tipo_documento in ('factura', 'recibo'));
alter table public.pagos add column if not exists serie text check (char_length(serie) <= 20);
alter table public.pagos add column if not exists numero_factura text check (char_length(numero_factura) <= 30);
alter table public.pagos add column if not exists numero_dte text check (char_length(numero_dte) <= 60);
alter table public.pagos add column if not exists monto_usd numeric(10,2) check (monto_usd >= 0);
alter table public.pagos add column if not exists numero_cuota int check (numero_cuota between 1 and 999);
alter table public.pagos add column if not exists estado_doc text not null default 'emitido' check (estado_doc in ('emitido', 'aplicado', 'certificado', 'anulado'));
alter table public.pagos add column if not exists observaciones text check (char_length(observaciones) <= 500);

-- Pagos anulados antes de existir el estado: quedan «Anulado»
update public.pagos set estado_doc = 'anulado' where anulado and estado_doc <> 'anulado';

-- Al anular un pago (función anular_pago), su estado pasa a «Anulado»
create or replace function public.pago_estado_anulado()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.anulado and not old.anulado then
    new.estado_doc := 'anulado';
  end if;
  return new;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'pagos_estado_anulado' and tgrelid = 'public.pagos'::regclass) then
    create trigger pagos_estado_anulado before update on public.pagos
      for each row execute function public.pago_estado_anulado();
  end if;
end $$;

create table if not exists public.pago_detalle (
  id                    bigint generated always as identity primary key,
  pago_id               bigint not null references public.pagos (id) on delete cascade,
  linea                 int not null check (linea >= 1),
  tipo_procedimiento_id bigint references public.tipos_procedimiento (id) on delete set null,
  clasificacion         text not null default 'bien' check (clasificacion in ('bien', 'servicio')),
  monto                 numeric(10,2) not null default 0 check (monto >= 0),
  monto_usd             numeric(10,2) not null default 0 check (monto_usd >= 0)
);
create unique index if not exists pago_detalle_linea on public.pago_detalle (pago_id, linea);
alter table public.pago_detalle enable row level security;
drop policy if exists "personal ve detalle de pagos" on public.pago_detalle;
create policy "personal ve detalle de pagos" on public.pago_detalle for select using (public.es_personal());
grant select on public.pago_detalle to authenticated;

-- Registra el pago y su detalle en un solo paso. Los montos del pago son la suma de las líneas.
create or replace function public.registrar_pago(p_datos jsonb, p_lineas jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
  v_q numeric := 0;
  v_usd numeric := 0;
  v_estado text := coalesce(nullif(p_datos ->> 'estado_doc', ''), 'emitido');
  e jsonb;
  n int := 0;
begin
  if not public.es_personal() then
    raise exception 'No tienes permiso para esta acción';
  end if;
  if jsonb_array_length(coalesce(p_lineas, '[]'::jsonb)) = 0 then
    raise exception 'Agrega al menos una línea al detalle del pago';
  end if;
  if v_estado not in ('emitido', 'aplicado', 'certificado') then
    raise exception 'Un pago nuevo no puede registrarse como anulado';
  end if;
  select coalesce(sum(greatest(coalesce((l ->> 'monto')::numeric, 0), 0)), 0),
         coalesce(sum(greatest(coalesce((l ->> 'monto_usd')::numeric, 0), 0)), 0)
    into v_q, v_usd
    from jsonb_array_elements(p_lineas) l;
  if v_q <= 0 then
    raise exception 'El total en quetzales del detalle debe ser mayor que cero';
  end if;
  insert into public.pagos (paciente_id, presupuesto_id, fecha, monto, monto_usd, metodo, referencia, concepto,
                            nit, tipo_documento, serie, numero_factura, numero_dte, numero_cuota, estado_doc, observaciones)
  values ((p_datos ->> 'paciente_id')::bigint, nullif(p_datos ->> 'presupuesto_id', '')::bigint,
          coalesce(nullif(p_datos ->> 'fecha', '')::date, current_date), round(v_q, 2), round(v_usd, 2),
          (p_datos ->> 'metodo')::public.metodo_pago, nullif(trim(p_datos ->> 'referencia'), ''), nullif(trim(p_datos ->> 'concepto'), ''),
          nullif(trim(p_datos ->> 'nit'), ''), coalesce(nullif(p_datos ->> 'tipo_documento', ''), 'recibo'), nullif(trim(p_datos ->> 'serie'), ''),
          nullif(trim(p_datos ->> 'numero_factura'), ''), nullif(trim(p_datos ->> 'numero_dte'), ''),
          nullif(p_datos ->> 'numero_cuota', '')::int, v_estado, nullif(trim(p_datos ->> 'observaciones'), ''))
  returning id into v_id;
  for e in select * from jsonb_array_elements(p_lineas) loop
    n := n + 1;
    insert into public.pago_detalle (pago_id, linea, tipo_procedimiento_id, clasificacion, monto, monto_usd)
    values (v_id, n, nullif(e ->> 'tipo_procedimiento_id', '')::bigint, coalesce(nullif(e ->> 'clasificacion', ''), 'bien'),
            round(greatest(coalesce((e ->> 'monto')::numeric, 0), 0), 2), round(greatest(coalesce((e ->> 'monto_usd')::numeric, 0), 0), 2));
  end loop;
  return v_id;
end;
$$;
revoke execute on function public.registrar_pago(jsonb, jsonb) from public, anon;
grant execute on function public.registrar_pago(jsonb, jsonb) to authenticated;

-- Cambiar el estado del documento (Emitido, Aplicado, Certificado). «Anulado» solo con anular_pago.
create or replace function public.cambiar_estado_pago(p_id bigint, p_estado text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.es_personal() then
    raise exception 'No tienes permiso para esta acción';
  end if;
  if p_estado not in ('emitido', 'aplicado', 'certificado') then
    raise exception 'Para anular un pago usa el botón Anular';
  end if;
  update public.pagos set estado_doc = p_estado where id = p_id and not anulado;
  if not found then
    raise exception 'El pago no existe o está anulado';
  end if;
end;
$$;
revoke execute on function public.cambiar_estado_pago(bigint, text) from public, anon;
grant execute on function public.cambiar_estado_pago(bigint, text) to authenticated;

-- ===== Correlativo interno de pagos (Año-Mes-Número, ej. 2026-10-0001) =====
-- Se asigna solo al registrar el pago, según el año y mes de registro (hora de Guatemala),
-- reinicia en 0001 cada mes y nadie lo puede modificar.

alter table public.pagos add column if not exists correlativo text;
create unique index if not exists pagos_correlativo on public.pagos (correlativo);

create table if not exists public.pago_correlativos (
  periodo text primary key,
  ultimo  int not null default 0
);
alter table public.pago_correlativos enable row level security;
revoke all on public.pago_correlativos from anon, authenticated;

-- Pagos anteriores: se numeran por su fecha de registro, en orden
do $$
declare r record; v_n int;
begin
  for r in select id, to_char(creado at time zone 'America/Guatemala', 'YYYY-MM') as periodo
             from public.pagos where correlativo is null order by creado, id loop
    insert into public.pago_correlativos as c (periodo, ultimo) values (r.periodo, 1)
      on conflict (periodo) do update set ultimo = c.ultimo + 1
      returning ultimo into v_n;
    update public.pagos set correlativo = r.periodo || '-' || lpad(v_n::text, 4, '0') where id = r.id;
  end loop;
end $$;

create or replace function public.pago_correlativo_asignar()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_periodo text := to_char(now() at time zone 'America/Guatemala', 'YYYY-MM'); v_n int;
begin
  insert into public.pago_correlativos as c (periodo, ultimo) values (v_periodo, 1)
    on conflict (periodo) do update set ultimo = c.ultimo + 1
    returning ultimo into v_n;
  new.correlativo := v_periodo || '-' || lpad(v_n::text, 4, '0');
  return new;
end;
$$;

create or replace function public.pago_correlativo_fijo()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.correlativo is not null and new.correlativo is distinct from old.correlativo then
    raise exception 'El correlativo interno no se puede modificar';
  end if;
  return new;
end;
$$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'pagos_correlativo_asignar' and tgrelid = 'public.pagos'::regclass) then
    create trigger pagos_correlativo_asignar before insert on public.pagos
      for each row execute function public.pago_correlativo_asignar();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'pagos_correlativo_fijo' and tgrelid = 'public.pagos'::regclass) then
    create trigger pagos_correlativo_fijo before update on public.pagos
      for each row execute function public.pago_correlativo_fijo();
  end if;
end $$;

-- Próximo correlativo (solo para mostrarlo en el formulario; el definitivo se asigna al registrar)
create or replace function public.siguiente_correlativo_pago()
returns text language sql stable security definer set search_path = public as $$
  select p || '-' || lpad((coalesce((select ultimo from public.pago_correlativos where periodo = p), 0) + 1)::text, 4, '0')
    from (select to_char(now() at time zone 'America/Guatemala', 'YYYY-MM') as p) x
   where public.es_personal();
$$;
revoke execute on function public.siguiente_correlativo_pago() from public, anon;
grant execute on function public.siguiente_correlativo_pago() to authenticated;

-- ===== Código, forma de pago y citas del presupuesto =====
-- Código: CÓDIGO DEL PACIENTE - AÑO - CORRELATIVO DEL AÑO (por paciente) - VERSIÓN, ej. 0012-2026-003-V01.
-- El correlativo empieza en 001 cada año para cada paciente; la versión empieza en V01 y sube cada vez que
-- se guardan cambios en el presupuesto. Nadie puede cambiar el código a mano.
-- Forma de pago (efectivo por defecto), cuotas con tarjeta (1, 2, 3, 6, 10, 12, 18 o 24) y cantidad de citas.
-- Esta versión de guardar_presupuesto reemplaza a las anteriores.

alter table public.presupuestos add column if not exists anio int;
alter table public.presupuestos add column if not exists correlativo int;
alter table public.presupuestos add column if not exists version int not null default 1;
alter table public.presupuestos add column if not exists codigo text;
alter table public.presupuestos add column if not exists forma_pago text not null default 'efectivo'
  check (forma_pago in ('efectivo', 'transferencia', 'tarjeta', 'otro'));
alter table public.presupuestos add column if not exists cuotas int check (cuotas in (1, 2, 3, 6, 10, 12, 18, 24));
alter table public.presupuestos add column if not exists citas int check (citas between 1 and 99);
create unique index if not exists presupuestos_corr_anual on public.presupuestos (paciente_id, anio, correlativo);

create or replace function public.codigo_presupuesto(p_paciente bigint, p_anio int, p_corr int, p_version int)
returns text language sql immutable as $$
  select lpad(p_paciente::text, greatest(4, length(p_paciente::text)), '0') || '-' || p_anio || '-' ||
         lpad(p_corr::text, greatest(3, length(p_corr::text)), '0') || '-V' || lpad(p_version::text, greatest(2, length(p_version::text)), '0');
$$;

-- Presupuestos anteriores: se numeran por paciente y año, en el orden en que se crearon
do $$
declare r record;
begin
  alter table public.presupuestos disable trigger user;
  for r in select id, paciente_id, extract(year from creado at time zone 'America/Guatemala')::int as a
             from public.presupuestos where correlativo is null order by creado, id loop
    update public.presupuestos
       set anio = r.a,
           correlativo = coalesce((select max(correlativo) from public.presupuestos where paciente_id = r.paciente_id and anio = r.a), 0) + 1
     where id = r.id;
  end loop;
  update public.presupuestos set codigo = public.codigo_presupuesto(paciente_id, anio, correlativo, version)
   where codigo is distinct from public.codigo_presupuesto(paciente_id, anio, correlativo, version);
  alter table public.presupuestos enable trigger user;
end $$;

-- Al crear: año, correlativo del paciente en el año, versión 1 y código
create or replace function public.presupuesto_codigo_nuevo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(918273, new.paciente_id::int);
  new.anio := extract(year from now() at time zone 'America/Guatemala')::int;
  select coalesce(max(correlativo), 0) + 1 into new.correlativo
    from public.presupuestos where paciente_id = new.paciente_id and anio = new.anio;
  new.version := 1;
  new.codigo := public.codigo_presupuesto(new.paciente_id, new.anio, new.correlativo, 1);
  return new;
end;
$$;
-- Al modificar: el año, el correlativo y el código no se cambian a mano; la versión nunca baja
create or replace function public.presupuesto_codigo_fijo()
returns trigger language plpgsql set search_path = public as $$
begin
  new.paciente_id := old.paciente_id;
  new.anio := old.anio;
  new.correlativo := old.correlativo;
  if new.version < old.version then new.version := old.version; end if;
  new.codigo := public.codigo_presupuesto(old.paciente_id, old.anio, old.correlativo, new.version);
  return new;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'presupuestos_codigo_nuevo' and tgrelid = 'public.presupuestos'::regclass) then
    create trigger presupuestos_codigo_nuevo before insert on public.presupuestos
      for each row execute function public.presupuesto_codigo_nuevo();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'presupuestos_codigo_fijo' and tgrelid = 'public.presupuestos'::regclass) then
    create trigger presupuestos_codigo_fijo before update on public.presupuestos
      for each row execute function public.presupuesto_codigo_fijo();
  end if;
end $$;

-- Guardar: tratamientos, descuento, notas, tipo de precio, forma de pago, cuotas y citas.
-- Si el presupuesto ya tenía tratamientos y algo cambió, la versión sube (V01 → V02…).
drop function if exists public.guardar_presupuesto(bigint, numeric, text, jsonb, text);
create or replace function public.guardar_presupuesto(p_id bigint, p_descuento numeric, p_notas text, p_items jsonb,
  p_tipo text default 'directo', p_forma_pago text default null, p_cuotas int default null, p_citas int default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_p public.presupuestos;
  v_tipo text := coalesce(p_tipo, 'directo');
  v_forma text;
  v_cuotas int;
  v_citas int;
  v_max numeric;
  v_antes text;
  v_despues text;
  v_tenia boolean;
begin
  if not public.es_personal() then
    raise exception 'No tienes permiso para esta acción';
  end if;
  if v_tipo not in ('directo', 'institucional', 'vip', 'referido', 'paquete', 'especial') then
    raise exception 'Tipo de precio no válido';
  end if;
  select * into v_p from public.presupuestos where id = p_id for update;
  if v_p.id is null then
    raise exception 'Presupuesto no encontrado';
  end if;
  if v_p.estado in ('aprobado', 'rechazado') then
    raise exception 'Un presupuesto aprobado o no aprobado ya no se puede modificar';
  end if;
  -- forma de pago: si no se envía, se conserva la actual
  v_forma := coalesce(nullif(p_forma_pago, ''), v_p.forma_pago);
  if v_forma not in ('efectivo', 'transferencia', 'tarjeta', 'otro') then
    raise exception 'Forma de pago no válida';
  end if;
  v_cuotas := case when p_forma_pago is null then v_p.cuotas when v_forma = 'tarjeta' then coalesce(p_cuotas, 1) else null end;
  if v_cuotas is not null and v_cuotas not in (1, 2, 3, 6, 10, 12, 18, 24) then
    raise exception 'El plan de pago debe ser de 1, 2, 3, 6, 10, 12, 18 o 24 cuotas';
  end if;
  v_citas := case when p_forma_pago is null then v_p.citas else p_citas end;
  if v_citas is not null and (v_citas < 1 or v_citas > 99) then
    raise exception 'La cantidad de citas debe estar entre 1 y 99';
  end if;

  select min(pr.descuento_max) into v_max
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e
    join public.tratamientos t on lower(t.nombre) = lower(trim(e ->> 'tratamiento'))
    join public.precios pr on pr.tratamiento_id = t.id and pr.tipo = v_tipo and pr.estado = 'activo';
  if v_max is not null and coalesce(p_descuento, 0) > v_max then
    raise exception 'El descuento máximo permitido con este tipo de precio es % %%', trim(trailing '.' from trim(trailing '0' from v_max::text));
  end if;

  -- Huella de lo guardado antes, para saber si hubo cambios
  select exists (select 1 from public.presupuesto_items where presupuesto_id = p_id) into v_tenia;
  select coalesce(string_agg(tratamiento || '|' || coalesce(pieza, '') || '|' || cantidad || '|' || precio::numeric(10,2), ';' order by orden, id), '')
    into v_antes from public.presupuesto_items where presupuesto_id = p_id;
  v_antes := v_antes || '#' || v_p.descuento_pct::numeric(5,2) || '#' || coalesce(v_p.notas, '') || '#' || v_p.tipo_precio || '#' ||
             v_p.forma_pago || '#' || coalesce(v_p.cuotas::text, '') || '#' || coalesce(v_p.citas::text, '');

  delete from public.presupuesto_items where presupuesto_id = p_id;
  insert into public.presupuesto_items (presupuesto_id, orden, tratamiento, pieza, cantidad, precio)
  select p_id, t.ord, trim(t.i ->> 'tratamiento'), nullif(trim(t.i ->> 'pieza'), ''),
         greatest(coalesce((t.i ->> 'cantidad')::int, 1), 1), greatest(coalesce((t.i ->> 'precio')::numeric, 0), 0)
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as t(i, ord)
  where coalesce(trim(t.i ->> 'tratamiento'), '') <> '';

  select coalesce(string_agg(tratamiento || '|' || coalesce(pieza, '') || '|' || cantidad || '|' || precio::numeric(10,2), ';' order by orden, id), '')
    into v_despues from public.presupuesto_items where presupuesto_id = p_id;
  v_despues := v_despues || '#' || coalesce(p_descuento, 0)::numeric(5,2) || '#' || coalesce(nullif(trim(p_notas), ''), '') || '#' || v_tipo || '#' ||
               v_forma || '#' || coalesce(v_cuotas::text, '') || '#' || coalesce(v_citas::text, '');

  update public.presupuestos
     set descuento_pct = coalesce(p_descuento, 0), notas = nullif(trim(p_notas), ''), tipo_precio = v_tipo,
         forma_pago = v_forma, cuotas = v_cuotas, citas = v_citas,
         version = case when v_tenia and v_antes <> v_despues then version + 1 else version end
   where id = p_id;
end;
$$;
revoke execute on function public.guardar_presupuesto(bigint, numeric, text, jsonb, text, text, int, int) from public, anon;
grant execute on function public.guardar_presupuesto(bigint, numeric, text, jsonb, text, text, int, int) to authenticated;

-- ===== Recargos por pago en cuotas con tarjeta de crédito =====
-- Porcentaje de recargo por cada plan de cuotas (1, 2, 3, 6, 10, 12, 18 y 24). Lo cambia solo el Super Administrador,
-- según el contrato de la clínica con su banco o VisaNet. Valores iniciales de referencia (3 y 24 cuotas, estimados).
-- El presupuesto guarda el porcentaje vigente al guardarlo (recargo_pct) para que el total a pagar no cambie después.

create table if not exists public.recargos_cuotas (
  cuotas          int primary key check (cuotas in (1, 2, 3, 6, 10, 12, 18, 24)),
  porcentaje      numeric(5,2) not null default 0 check (porcentaje between 0 and 100),
  actualizado     timestamptz not null default now(),
  actualizado_por text
);
insert into public.recargos_cuotas (cuotas, porcentaje) values
  (1, 0), (2, 5.25), (3, 6), (6, 7), (10, 7.25), (12, 8), (18, 12), (24, 15)
on conflict (cuotas) do nothing;
alter table public.recargos_cuotas enable row level security;
drop policy if exists "personal ve recargos" on public.recargos_cuotas;
create policy "personal ve recargos" on public.recargos_cuotas for select using (public.es_personal());
drop policy if exists "super cambia recargos" on public.recargos_cuotas;
create policy "super cambia recargos" on public.recargos_cuotas for update using (public.es_super_administrador()) with check (public.es_super_administrador());
grant select, update on public.recargos_cuotas to authenticated;

create or replace function public.recargos_firmar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.actualizado := now();
  new.actualizado_por := (select usuario from public.perfiles where id = auth.uid());
  return new;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'recargos_cuotas_firmar' and tgrelid = 'public.recargos_cuotas'::regclass) then
    create trigger recargos_cuotas_firmar before update on public.recargos_cuotas
      for each row execute function public.recargos_firmar();
  end if;
end $$;

alter table public.presupuestos add column if not exists recargo_pct numeric(5,2) not null default 0 check (recargo_pct between 0 and 100);

-- guardar_presupuesto: además guarda el % de recargo del plan de cuotas (si se paga con tarjeta)
create or replace function public.guardar_presupuesto(p_id bigint, p_descuento numeric, p_notas text, p_items jsonb,
  p_tipo text default 'directo', p_forma_pago text default null, p_cuotas int default null, p_citas int default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_p public.presupuestos;
  v_tipo text := coalesce(p_tipo, 'directo');
  v_forma text;
  v_cuotas int;
  v_citas int;
  v_recargo numeric := 0;
  v_max numeric;
  v_antes text;
  v_despues text;
  v_tenia boolean;
begin
  if not public.es_personal() then
    raise exception 'No tienes permiso para esta acción';
  end if;
  if v_tipo not in ('directo', 'institucional', 'vip', 'referido', 'paquete', 'especial') then
    raise exception 'Tipo de precio no válido';
  end if;
  select * into v_p from public.presupuestos where id = p_id for update;
  if v_p.id is null then
    raise exception 'Presupuesto no encontrado';
  end if;
  if v_p.estado in ('aprobado', 'rechazado') then
    raise exception 'Un presupuesto aprobado o no aprobado ya no se puede modificar';
  end if;
  v_forma := coalesce(nullif(p_forma_pago, ''), v_p.forma_pago);
  if v_forma not in ('efectivo', 'transferencia', 'tarjeta', 'otro') then
    raise exception 'Forma de pago no válida';
  end if;
  v_cuotas := case when p_forma_pago is null then v_p.cuotas when v_forma = 'tarjeta' then coalesce(p_cuotas, 1) else null end;
  if v_cuotas is not null and v_cuotas not in (1, 2, 3, 6, 10, 12, 18, 24) then
    raise exception 'El plan de pago debe ser de 1, 2, 3, 6, 10, 12, 18 o 24 cuotas';
  end if;
  v_citas := case when p_forma_pago is null then v_p.citas else p_citas end;
  if v_citas is not null and (v_citas < 1 or v_citas > 99) then
    raise exception 'La cantidad de citas debe estar entre 1 y 99';
  end if;
  if v_forma = 'tarjeta' and v_cuotas is not null then
    v_recargo := case when p_forma_pago is null then v_p.recargo_pct
                      else coalesce((select porcentaje from public.recargos_cuotas where cuotas = v_cuotas), 0) end;
  end if;

  select min(pr.descuento_max) into v_max
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e
    join public.tratamientos t on lower(t.nombre) = lower(trim(e ->> 'tratamiento'))
    join public.precios pr on pr.tratamiento_id = t.id and pr.tipo = v_tipo and pr.estado = 'activo';
  if v_max is not null and coalesce(p_descuento, 0) > v_max then
    raise exception 'El descuento máximo permitido con este tipo de precio es % %%', trim(trailing '.' from trim(trailing '0' from v_max::text));
  end if;

  select exists (select 1 from public.presupuesto_items where presupuesto_id = p_id) into v_tenia;
  select coalesce(string_agg(tratamiento || '|' || coalesce(pieza, '') || '|' || cantidad || '|' || precio::numeric(10,2), ';' order by orden, id), '')
    into v_antes from public.presupuesto_items where presupuesto_id = p_id;
  v_antes := v_antes || '#' || v_p.descuento_pct::numeric(5,2) || '#' || coalesce(v_p.notas, '') || '#' || v_p.tipo_precio || '#' ||
             v_p.forma_pago || '#' || coalesce(v_p.cuotas::text, '') || '#' || coalesce(v_p.citas::text, '') || '#' || v_p.recargo_pct::numeric(5,2);

  delete from public.presupuesto_items where presupuesto_id = p_id;
  insert into public.presupuesto_items (presupuesto_id, orden, tratamiento, pieza, cantidad, precio)
  select p_id, t.ord, trim(t.i ->> 'tratamiento'), nullif(trim(t.i ->> 'pieza'), ''),
         greatest(coalesce((t.i ->> 'cantidad')::int, 1), 1), greatest(coalesce((t.i ->> 'precio')::numeric, 0), 0)
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as t(i, ord)
  where coalesce(trim(t.i ->> 'tratamiento'), '') <> '';

  select coalesce(string_agg(tratamiento || '|' || coalesce(pieza, '') || '|' || cantidad || '|' || precio::numeric(10,2), ';' order by orden, id), '')
    into v_despues from public.presupuesto_items where presupuesto_id = p_id;
  v_despues := v_despues || '#' || coalesce(p_descuento, 0)::numeric(5,2) || '#' || coalesce(nullif(trim(p_notas), ''), '') || '#' || v_tipo || '#' ||
               v_forma || '#' || coalesce(v_cuotas::text, '') || '#' || coalesce(v_citas::text, '') || '#' || v_recargo::numeric(5,2);

  update public.presupuestos
     set descuento_pct = coalesce(p_descuento, 0), notas = nullif(trim(p_notas), ''), tipo_precio = v_tipo,
         forma_pago = v_forma, cuotas = v_cuotas, citas = v_citas, recargo_pct = v_recargo,
         version = case when v_tenia and v_antes <> v_despues then version + 1 else version end
   where id = p_id;
end;
$$;
revoke execute on function public.guardar_presupuesto(bigint, numeric, text, jsonb, text, text, int, int) from public, anon;
grant execute on function public.guardar_presupuesto(bigint, numeric, text, jsonb, text, text, int, int) to authenticated;

-- ===== Plan de cuotas sin recargo =====
-- Con tarjeta se puede elegir el plan de cuotas con recargo (según «Recargos de tarjeta») o sin recargo (tasa cero).
-- Esta versión de guardar_presupuesto reemplaza a las anteriores.
alter table public.presupuestos add column if not exists sin_recargo boolean not null default false;
drop function if exists public.guardar_presupuesto(bigint, numeric, text, jsonb, text, text, int, int);
create or replace function public.guardar_presupuesto(p_id bigint, p_descuento numeric, p_notas text, p_items jsonb,
  p_tipo text default 'directo', p_forma_pago text default null, p_cuotas int default null, p_citas int default null,
  p_sin_recargo boolean default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_p public.presupuestos;
  v_tipo text := coalesce(p_tipo, 'directo');
  v_forma text;
  v_cuotas int;
  v_citas int;
  v_recargo numeric := 0;
  v_sin boolean;
  v_max numeric;
  v_antes text;
  v_despues text;
  v_tenia boolean;
begin
  if not public.es_personal() then
    raise exception 'No tienes permiso para esta acción';
  end if;
  if v_tipo not in ('directo', 'institucional', 'vip', 'referido', 'paquete', 'especial') then
    raise exception 'Tipo de precio no válido';
  end if;
  select * into v_p from public.presupuestos where id = p_id for update;
  if v_p.id is null then
    raise exception 'Presupuesto no encontrado';
  end if;
  if v_p.estado in ('aprobado', 'rechazado') then
    raise exception 'Un presupuesto aprobado o no aprobado ya no se puede modificar';
  end if;
  v_forma := coalesce(nullif(p_forma_pago, ''), v_p.forma_pago);
  if v_forma not in ('efectivo', 'transferencia', 'tarjeta', 'otro') then
    raise exception 'Forma de pago no válida';
  end if;
  v_cuotas := case when p_forma_pago is null then v_p.cuotas when v_forma = 'tarjeta' then coalesce(p_cuotas, 1) else null end;
  if v_cuotas is not null and v_cuotas not in (1, 2, 3, 6, 10, 12, 18, 24) then
    raise exception 'El plan de pago debe ser de 1, 2, 3, 6, 10, 12, 18 o 24 cuotas';
  end if;
  v_citas := case when p_forma_pago is null then v_p.citas else p_citas end;
  if v_citas is not null and (v_citas < 1 or v_citas > 99) then
    raise exception 'La cantidad de citas debe estar entre 1 y 99';
  end if;
  v_sin := v_forma = 'tarjeta' and (case when p_forma_pago is null then v_p.sin_recargo else coalesce(p_sin_recargo, false) end);
  if v_forma = 'tarjeta' and v_cuotas is not null and not v_sin then
    v_recargo := case when p_forma_pago is null then v_p.recargo_pct
                      else coalesce((select porcentaje from public.recargos_cuotas where cuotas = v_cuotas), 0) end;
  end if;

  select min(pr.descuento_max) into v_max
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e
    join public.tratamientos t on lower(t.nombre) = lower(trim(e ->> 'tratamiento'))
    join public.precios pr on pr.tratamiento_id = t.id and pr.tipo = v_tipo and pr.estado = 'activo';
  if v_max is not null and coalesce(p_descuento, 0) > v_max then
    raise exception 'El descuento máximo permitido con este tipo de precio es % %%', trim(trailing '.' from trim(trailing '0' from v_max::text));
  end if;

  select exists (select 1 from public.presupuesto_items where presupuesto_id = p_id) into v_tenia;
  select coalesce(string_agg(tratamiento || '|' || coalesce(pieza, '') || '|' || cantidad || '|' || precio::numeric(10,2), ';' order by orden, id), '')
    into v_antes from public.presupuesto_items where presupuesto_id = p_id;
  v_antes := v_antes || '#' || v_p.descuento_pct::numeric(5,2) || '#' || coalesce(v_p.notas, '') || '#' || v_p.tipo_precio || '#' ||
             v_p.forma_pago || '#' || coalesce(v_p.cuotas::text, '') || '#' || coalesce(v_p.citas::text, '') || '#' || v_p.recargo_pct::numeric(5,2) || '#' || v_p.sin_recargo;

  delete from public.presupuesto_items where presupuesto_id = p_id;
  insert into public.presupuesto_items (presupuesto_id, orden, tratamiento, pieza, cantidad, precio)
  select p_id, t.ord, trim(t.i ->> 'tratamiento'), nullif(trim(t.i ->> 'pieza'), ''),
         greatest(coalesce((t.i ->> 'cantidad')::int, 1), 1), greatest(coalesce((t.i ->> 'precio')::numeric, 0), 0)
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as t(i, ord)
  where coalesce(trim(t.i ->> 'tratamiento'), '') <> '';

  select coalesce(string_agg(tratamiento || '|' || coalesce(pieza, '') || '|' || cantidad || '|' || precio::numeric(10,2), ';' order by orden, id), '')
    into v_despues from public.presupuesto_items where presupuesto_id = p_id;
  v_despues := v_despues || '#' || coalesce(p_descuento, 0)::numeric(5,2) || '#' || coalesce(nullif(trim(p_notas), ''), '') || '#' || v_tipo || '#' ||
               v_forma || '#' || coalesce(v_cuotas::text, '') || '#' || coalesce(v_citas::text, '') || '#' || v_recargo::numeric(5,2) || '#' || v_sin;

  update public.presupuestos
     set descuento_pct = coalesce(p_descuento, 0), notas = nullif(trim(p_notas), ''), tipo_precio = v_tipo,
         forma_pago = v_forma, cuotas = v_cuotas, citas = v_citas, recargo_pct = v_recargo, sin_recargo = v_sin,
         version = case when v_tenia and v_antes <> v_despues then version + 1 else version end
   where id = p_id;
end;
$$;
revoke execute on function public.guardar_presupuesto(bigint, numeric, text, jsonb, text, text, int, int, boolean) from public, anon;
grant execute on function public.guardar_presupuesto(bigint, numeric, text, jsonb, text, text, int, int, boolean) to authenticated;

-- ===== Fechas de estado del presupuesto e historial =====
-- Cada cambio de estado registra solo la fecha y el usuario (estado_cambiado / estado_cambiado_por).
-- Al pasar a «Aprobado» se registra la fecha de aprobación (aprobado_en); si deja de estar aprobado se borra.
-- Nadie puede escribir estas fechas a mano. El historial guarda todos los cambios de estado.
-- origen: 'odontograma' para los presupuestos creados desde el odontograma del paciente.

alter table public.presupuestos add column if not exists origen text not null default 'manual' check (origen in ('manual', 'odontograma'));
alter table public.presupuestos add column if not exists estado_cambiado timestamptz;
alter table public.presupuestos add column if not exists estado_cambiado_por text;
alter table public.presupuestos add column if not exists aprobado_en timestamptz;

create table if not exists public.presupuesto_estados (
  id             bigint generated always as identity primary key,
  presupuesto_id bigint not null references public.presupuestos (id) on delete cascade,
  de             text,
  a              text not null,
  fecha          timestamptz not null default now(),
  usuario        text
);
create index if not exists presupuesto_estados_pre on public.presupuesto_estados (presupuesto_id);
alter table public.presupuesto_estados enable row level security;
drop policy if exists "personal ve estados de presupuestos" on public.presupuesto_estados;
create policy "personal ve estados de presupuestos" on public.presupuesto_estados for select using (public.es_personal());
grant select on public.presupuesto_estados to authenticated;

-- Presupuestos anteriores: la última modificación como fecha de estado (y de aprobación si están aprobados)
do $$ begin
  alter table public.presupuestos disable trigger user;
  update public.presupuestos set estado_cambiado = coalesce(actualizado, creado), estado_cambiado_por = creado_por where estado_cambiado is null;
  update public.presupuestos set aprobado_en = coalesce(actualizado, creado) where estado = 'aprobado' and aprobado_en is null;
  alter table public.presupuestos enable trigger user;
end $$;

create or replace function public.presupuesto_estado_fechas()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_usuario text := (select usuario from public.perfiles where id = auth.uid());
begin
  if tg_op = 'INSERT' then
    new.estado_cambiado := now();
    new.estado_cambiado_por := v_usuario;
    new.aprobado_en := case when new.estado = 'aprobado' then now() end;
    return new;
  end if;
  if new.estado is distinct from old.estado then
    new.estado_cambiado := now();
    new.estado_cambiado_por := v_usuario;
    new.aprobado_en := case when new.estado = 'aprobado' then now() end;
  else
    new.estado_cambiado := old.estado_cambiado;
    new.estado_cambiado_por := old.estado_cambiado_por;
    new.aprobado_en := old.aprobado_en;
  end if;
  new.origen := old.origen;
  return new;
end;
$$;
create or replace function public.presupuesto_estado_historial()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.estado is distinct from old.estado then
    insert into public.presupuesto_estados (presupuesto_id, de, a, fecha, usuario)
    values (new.id, case when tg_op = 'UPDATE' then old.estado::text end, new.estado::text, new.estado_cambiado, new.estado_cambiado_por);
  end if;
  return null;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'presupuestos_estado_fechas' and tgrelid = 'public.presupuestos'::regclass) then
    create trigger presupuestos_estado_fechas before insert or update on public.presupuestos
      for each row execute function public.presupuesto_estado_fechas();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'presupuestos_estado_historial' and tgrelid = 'public.presupuestos'::regclass) then
    create trigger presupuestos_estado_historial after insert or update on public.presupuestos
      for each row execute function public.presupuesto_estado_historial();
  end if;
end $$;

-- ===== Estado de cada procedimiento del presupuesto =====
-- Pendiente (por defecto), Proceso, Finalizado y Eliminado, con fecha y usuario del cambio.
-- Solo en presupuestos aprobados. Finalizado = realizado (se carga al estado de cuenta).
-- Avanzar (Pendiente → Proceso → Finalizado) lo hace todo el personal; volver atrás o Eliminar, solo el Super Administrador.
-- Eliminado no suma al total ni al estado de cuenta, pero queda en el historial.

alter table public.presupuesto_items add column if not exists estado text not null default 'pendiente'
  check (estado in ('pendiente', 'proceso', 'finalizado', 'eliminado'));
alter table public.presupuesto_items add column if not exists estado_fecha timestamptz;
alter table public.presupuesto_items add column if not exists estado_por text;
update public.presupuesto_items set estado = 'finalizado', estado_fecha = coalesce(estado_fecha, realizado_en::timestamptz)
 where realizado and estado <> 'finalizado';

create table if not exists public.presupuesto_item_estados (
  id       bigint generated always as identity primary key,
  item_id  bigint not null references public.presupuesto_items (id) on delete cascade,
  de       text,
  a        text not null,
  fecha    timestamptz not null default now(),
  usuario  text
);
create index if not exists presupuesto_item_estados_item on public.presupuesto_item_estados (item_id);
alter table public.presupuesto_item_estados enable row level security;
drop policy if exists "personal ve estados de procedimientos" on public.presupuesto_item_estados;
create policy "personal ve estados de procedimientos" on public.presupuesto_item_estados for select using (public.es_personal());
grant select on public.presupuesto_item_estados to authenticated;

create or replace function public.cambiar_estado_item(p_item bigint, p_estado text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_actual text;
  v_orden constant text[] := array['pendiente', 'proceso', 'finalizado'];
  v_usuario text := (select usuario from public.perfiles where id = auth.uid());
begin
  if not public.es_personal() then
    raise exception 'No tienes permiso para esta acción';
  end if;
  if p_estado not in ('pendiente', 'proceso', 'finalizado', 'eliminado') then
    raise exception 'Estado no válido';
  end if;
  select i.estado into v_actual from public.presupuesto_items i
    join public.presupuestos p on p.id = i.presupuesto_id
   where i.id = p_item and p.estado = 'aprobado';
  if v_actual is null then
    raise exception 'El estado de un procedimiento solo se cambia cuando el presupuesto está aprobado';
  end if;
  if v_actual = p_estado then return; end if;
  -- Retroceder, eliminar o recuperar un eliminado: solo el Super Administrador
  if (p_estado = 'eliminado' or v_actual = 'eliminado' or array_position(v_orden, p_estado) < array_position(v_orden, v_actual))
     and not public.es_super_administrador() then
    raise exception 'Solo el Super Administrador puede regresar o eliminar un procedimiento';
  end if;
  update public.presupuesto_items
     set estado = p_estado, estado_fecha = now(), estado_por = v_usuario,
         realizado = (p_estado = 'finalizado'),
         realizado_en = case when p_estado = 'finalizado' then current_date end
   where id = p_item;
  insert into public.presupuesto_item_estados (item_id, de, a, usuario) values (p_item, v_actual, p_estado, v_usuario);
end;
$$;
revoke execute on function public.cambiar_estado_item(bigint, text) from public, anon;
grant execute on function public.cambiar_estado_item(bigint, text) to authenticated;

-- La casilla «Realizado» de Presupuesto usa el mismo estado (Finalizado / Pendiente)
create or replace function public.marcar_realizado(p_item bigint, p_realizado boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_actual text;
begin
  select estado into v_actual from public.presupuesto_items where id = p_item;
  if not p_realizado and v_actual = 'finalizado' and not public.es_super_administrador() then
    raise exception 'Solo el Super Administrador puede regresar o eliminar un procedimiento';
  end if;
  perform public.cambiar_estado_item(p_item, case when p_realizado then 'finalizado' else 'pendiente' end);
end;
$$;

-- Un presupuesto aprobado con procedimientos en proceso o finalizados no cambia de estado ni de descuento
create or replace function public.antes_de_cambiar_presupuesto()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.estado = 'aprobado' and exists (
       select 1 from public.presupuesto_items where presupuesto_id = old.id and (realizado or estado in ('proceso', 'finalizado'))) then
    if new.estado <> 'aprobado' then
      raise exception 'Este presupuesto ya tiene tratamientos en proceso o realizados; no puede dejar de estar aprobado';
    end if;
    if new.descuento_pct <> old.descuento_pct then
      raise exception 'Este presupuesto ya tiene tratamientos en proceso o realizados; el descuento no se puede cambiar';
    end if;
  end if;
  new.actualizado := now();
  return new;
end;
$$;

-- ===== Posiciones: código automático, estado, responsable y quién la registró =====
-- ID de clínica automático (1, 2, 3…) que no se puede cambiar. Estado administrativo Activo / Inactivo / Baja
-- (Activo por defecto; «activa» queda sincronizada para la agenda). Odontólogo responsable de la lista de dentistas.
-- Usuario y fecha de registro automáticos. Solo el Super Administrador modifica los datos (el estado operativo
-- Libre/Ocupado/Limpieza/Mantenimiento lo sigue cambiando el personal).

alter table public.posiciones add column if not exists estado_registro text not null default 'activo'
  check (estado_registro in ('activo', 'inactivo', 'baja'));
alter table public.posiciones add column if not exists registrado_por text;
alter table public.posiciones add column if not exists dentista_id bigint references public.dentistas (id) on delete set null;
update public.posiciones set estado_registro = 'inactivo' where not activa and estado_registro = 'activo';

create or replace function public.posicion_datos_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(918274);
    new.codigo := (select coalesce(max(codigo::int), 0) + 1 from public.posiciones where codigo ~ '^[0-9]{1,9}$')::text;
    new.registrado_por := (select usuario from public.perfiles where id = auth.uid());
    new.creado := now();
  else
    new.codigo := old.codigo;
    new.registrado_por := old.registrado_por;
    new.creado := old.creado;
    if not public.es_super_administrador() and (
         new.nombre is distinct from old.nombre or new.ubicacion is distinct from old.ubicacion or
         new.tipo_sillon is distinct from old.tipo_sillon or new.equipamiento is distinct from old.equipamiento or
         new.especialidad is distinct from old.especialidad or new.responsables is distinct from old.responsables or
         new.soporte is distinct from old.soporte or new.horario is distinct from old.horario or
         new.notas is distinct from old.notas or new.estado_registro is distinct from old.estado_registro or
         new.dentista_id is distinct from old.dentista_id or new.activa is distinct from old.activa) then
      raise exception 'Solo el Super Administrador puede modificar los datos de la posición';
    end if;
  end if;
  new.activa := new.estado_registro = 'activo';
  return new;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'posiciones_datos_admin' and tgrelid = 'public.posiciones'::regclass) then
    create trigger posiciones_datos_admin before insert or update on public.posiciones
      for each row execute function public.posicion_datos_admin();
  end if;
end $$;

-- ===== Estados de la cita: Programado, Confirmado, Reprogramado, Atendido y Cancelado =====
-- Se conservan los valores guardados (pendiente = Programado, confirmada = Confirmado, cancelada = Cancelado)
-- y se agregan reprogramada y atendida. Al reprogramar se guarda la fecha y hora anterior.
-- La fecha y hora de grabación (creada) y el usuario que graba (creada_por; «Sin usuario» si se pidió desde la página
-- sin conectarse) se registran solos. Cada cambio de estado anota cuándo y quién.

alter type public.estado_cita add value if not exists 'reprogramada';
alter type public.estado_cita add value if not exists 'atendida';

alter table public.citas add column if not exists reprogramada_de text;
alter table public.citas add column if not exists reprogramada_en timestamptz;
alter table public.citas add column if not exists reprogramada_por text;
alter table public.citas add column if not exists estado_cambiado timestamptz;
alter table public.citas add column if not exists estado_cambiado_por text;

create or replace function public.cita_registro()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_usuario text := (select usuario from public.perfiles where id = auth.uid());
begin
  if tg_op = 'INSERT' then
    new.creada := now();
    new.creada_por := coalesce(nullif(new.creada_por, ''), v_usuario, 'Sin usuario');
    new.estado_cambiado := now();
    new.estado_cambiado_por := coalesce(v_usuario, 'Sin usuario');
  else
    new.creada := old.creada;
    new.creada_por := old.creada_por;
    if new.estado is distinct from old.estado then
      new.estado_cambiado := now();
      new.estado_cambiado_por := coalesce(v_usuario, 'Sin usuario');
    end if;
  end if;
  return new;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'citas_registro' and tgrelid = 'public.citas'::regclass) then
    create trigger citas_registro before insert or update on public.citas
      for each row execute function public.cita_registro();
  end if;
end $$;

-- Citas anteriores sin usuario
do $$ begin
  alter table public.citas disable trigger citas_registro;
  update public.citas set creada_por = 'Sin usuario' where creada_por is null or creada_por = '';
  update public.citas set estado_cambiado = creada where estado_cambiado is null;
  alter table public.citas enable trigger citas_registro;
end $$;

-- Reprogramar: nueva fecha y hora (respeta los cupos por dentista y sala, y los bloqueos)
create or replace function public.reprogramar_cita(p_id bigint, p_fecha date, p_hora text)
returns void language plpgsql security definer set search_path = public as $$
declare v_usuario text := (select usuario from public.perfiles where id = auth.uid());
begin
  if not public.es_personal() then
    raise exception 'No tienes permiso para esta acción';
  end if;
  if p_fecha is null or p_hora is null or p_hora = '' then
    raise exception 'Indica la nueva fecha y hora';
  end if;
  if p_fecha < current_date then
    raise exception 'La nueva fecha no puede ser anterior a hoy';
  end if;
  if exists (select 1 from public.bloqueos b where b.fecha = p_fecha and (b.hora is null or b.hora = p_hora::time)) then
    raise exception 'Ese horario está bloqueado';
  end if;
  update public.citas
     set reprogramada_de = to_char(fecha, 'YYYY-MM-DD') || ' ' || to_char(hora, 'HH24:MI'),
         fecha = p_fecha, hora = p_hora::time,
         estado = 'reprogramada'::public.estado_cita,
         reprogramada_en = now(), reprogramada_por = coalesce(v_usuario, 'Sin usuario')
   where id = p_id and estado <> 'cancelada'::public.estado_cita;
  if not found then
    raise exception 'La cita no existe o está cancelada';
  end if;
exception
  when unique_violation then
    raise exception 'Ese horario ya está ocupado para ese dentista o esa sala';
end;
$$;
revoke execute on function public.reprogramar_cita(bigint, date, text) from public, anon;
grant execute on function public.reprogramar_cita(bigint, date, text) to authenticated;

-- Agendar desde el panel: estado inicial Programado (pendiente), Confirmado o Atendido
create or replace function public.agendar_cita(
  p_fecha date, p_hora text, p_paciente_id bigint, p_nombre text, p_telefono text, p_servicio text,
  p_dentista_id bigint, p_posicion_id bigint, p_prioridad text, p_notas text, p_estado text)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_id bigint;
  v_nombre text := trim(coalesce(p_nombre, ''));
  v_tel text := trim(coalesce(p_telefono, ''));
begin
  if not public.es_personal() then
    raise exception 'No tienes permiso para esta acción';
  end if;
  if p_paciente_id is not null then
    select coalesce(nullif(v_nombre, ''), nombre), coalesce(nullif(v_tel, ''), telefono, '')
      into v_nombre, v_tel
      from public.pacientes where id = p_paciente_id;
  end if;
  if coalesce(v_nombre, '') = '' then
    raise exception 'Indica el paciente';
  end if;
  if exists (select 1 from public.bloqueos b where b.fecha = p_fecha and (b.hora is null or b.hora = p_hora::time)) then
    raise exception 'Ese horario está bloqueado';
  end if;

  insert into public.citas (fecha, hora, servicio, nombre, telefono, paciente_id, dentista_id, posicion_id,
                            prioridad, notas, estado, creada_por)
  values (p_fecha, p_hora::time, coalesce(nullif(trim(p_servicio), ''), 'Evaluación general'), v_nombre, v_tel,
          p_paciente_id, p_dentista_id, p_posicion_id,
          case when p_prioridad = 'urgente' then 'urgente' else 'normal' end,
          nullif(trim(p_notas), ''),
          (case when p_estado in ('confirmada', 'atendida') then p_estado else 'pendiente' end)::public.estado_cita,
          (select usuario from public.perfiles where id = auth.uid()))
  returning id into v_id;
  return v_id;
exception
  when unique_violation then
    raise exception 'Ese horario ya está ocupado para ese dentista o esa sala';
end;
$$;
revoke execute on function public.agendar_cita(date, text, bigint, text, text, text, bigint, bigint, text, text, text) from public, anon;
grant execute on function public.agendar_cita(date, text, bigint, text, text, text, bigint, bigint, text, text, text) to authenticated;

-- ===== Preguntas frecuentes con IA =====
-- Registro de las preguntas que la página envió a la IA (función faq-ia). Sirve para reutilizar respuestas,
-- limitar el uso por visitante y por día, y que el personal vea qué dudas no estaban en la página.
-- Solo la función (con la clave de servicio) escribe aquí; el personal puede leer.
create table if not exists public.faq_ia_consultas (
  id bigint generated always as identity primary key,
  creada timestamptz not null default now(),
  visitante text not null,
  pregunta text not null,
  pregunta_norm text not null,
  idioma text not null default 'es',
  respuesta text
);
create index if not exists faq_ia_consultas_norm on public.faq_ia_consultas (pregunta_norm, idioma, creada desc);
create index if not exists faq_ia_consultas_visitante on public.faq_ia_consultas (visitante, creada desc);
create index if not exists faq_ia_consultas_creada on public.faq_ia_consultas (creada desc);
alter table public.faq_ia_consultas enable row level security;
revoke all on public.faq_ia_consultas from anon;
drop policy if exists faq_ia_personal_lee on public.faq_ia_consultas;
create policy faq_ia_personal_lee on public.faq_ia_consultas for select to authenticated using (public.es_personal());

-- ===== Recetas médicas del expediente =====
-- Cada receta pertenece a un paciente y a una fecha de atención / número de visita (con su cita, si la hay).
-- Número automático REC-AÑO-correlativo que no se puede cambiar. Medicamentos con dosis, frecuencia y duración.
-- Todo el personal puede crear y modificar; queda registrado quién la grabó y quién la modificó por última vez.
create table if not exists public.recetas (
  id              bigint generated always as identity primary key,
  paciente_id     bigint not null references public.pacientes (id) on delete cascade,
  numero          text unique,
  fecha           date not null default current_date,
  visita_numero   int,
  cita_id         bigint references public.citas (id) on delete set null,
  dentista_id     bigint references public.dentistas (id) on delete set null,
  indicaciones    text,
  creada          timestamptz not null default now(),
  creada_por      text,
  modificada      timestamptz,
  modificada_por  text
);
alter table public.recetas add column if not exists proxima_cita date;
alter table public.recetas add column if not exists proxima_hora text;
create index if not exists recetas_paciente on public.recetas (paciente_id, fecha desc);

create table if not exists public.receta_items (
  id          bigint generated always as identity primary key,
  receta_id   bigint not null references public.recetas (id) on delete cascade,
  orden       int not null default 1,
  medicamento text not null,
  dosis       text,
  frecuencia  text,
  duracion    text
);
create index if not exists receta_items_receta on public.receta_items (receta_id, orden);

create or replace function public.receta_registro()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_usuario text := coalesce((select usuario from public.perfiles where id = auth.uid()), 'Sin usuario');
        v_anio text;
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(735102);
    v_anio := to_char(coalesce(new.fecha, current_date), 'YYYY');
    new.numero := 'REC-' || v_anio || '-' || lpad((select coalesce(max(substring(numero from 10)::int), 0) + 1
                    from public.recetas where numero ~ ('^REC-' || v_anio || '-[0-9]+$'))::text, 4, '0');
    new.creada := now();
    new.creada_por := v_usuario;
    new.modificada := null; new.modificada_por := null;
  else
    new.numero := old.numero; new.creada := old.creada; new.creada_por := old.creada_por;
    new.paciente_id := old.paciente_id;
    new.modificada := now(); new.modificada_por := v_usuario;
  end if;
  return new;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'recetas_registro' and tgrelid = 'public.recetas'::regclass) then
    create trigger recetas_registro before insert or update on public.recetas
      for each row execute function public.receta_registro();
  end if;
end $$;

alter table public.recetas enable row level security;
alter table public.receta_items enable row level security;
drop policy if exists recetas_personal_lee on public.recetas;
create policy recetas_personal_lee on public.recetas for select to authenticated using (public.es_personal());
drop policy if exists recetas_super_borra on public.recetas;
create policy recetas_super_borra on public.recetas for delete to authenticated using (public.es_super_administrador());
drop policy if exists receta_items_personal_lee on public.receta_items;
create policy receta_items_personal_lee on public.receta_items for select to authenticated using (public.es_personal());
revoke insert, update, delete on public.recetas, public.receta_items from anon, authenticated;
grant select on public.recetas, public.receta_items to authenticated;
grant delete on public.recetas to authenticated;

-- Número de visita sugerido: días distintos con cita atendida/confirmada o nota de visita hasta esa fecha
create or replace function public.visita_sugerida(p_paciente bigint, p_fecha date)
returns int language sql stable security definer set search_path = public as $$
  select case when public.es_personal() then (
    select count(*)::int from (
      select fecha from public.citas where paciente_id = p_paciente and fecha <= p_fecha
        and estado in ('atendida'::public.estado_cita, 'confirmada'::public.estado_cita)
      union
      select fecha from public.notas_visita where paciente_id = p_paciente and fecha <= p_fecha
      union
      select p_fecha
    ) d) end;
$$;
revoke execute on function public.visita_sugerida(bigint, date) from public, anon;
grant execute on function public.visita_sugerida(bigint, date) to authenticated;

-- Grabar o modificar una receta con sus medicamentos (todo junto)
-- p_items: [{ "medicamento": "...", "dosis": "...", "frecuencia": "...", "duracion": "..." }, ...]
drop function if exists public.guardar_receta(bigint, bigint, date, int, bigint, bigint, text, jsonb);
create or replace function public.guardar_receta(
  p_id bigint, p_paciente bigint, p_fecha date, p_visita int, p_cita bigint, p_dentista bigint,
  p_indicaciones text, p_items jsonb, p_proxima date default null, p_proxima_hora text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_n int := 0; e jsonb;
begin
  if not public.es_personal() then raise exception 'No tienes permiso para esta acción'; end if;
  if p_fecha is null then raise exception 'Indica la fecha de atención'; end if;
  if jsonb_typeof(p_items) <> 'array' or not exists (
       select 1 from jsonb_array_elements(p_items) x where trim(coalesce(x->>'medicamento', '')) <> '') then
    raise exception 'Agrega al menos un medicamento';
  end if;
  if p_id is null then
    insert into public.recetas (paciente_id, fecha, visita_numero, cita_id, dentista_id, indicaciones, proxima_cita, proxima_hora)
    values (p_paciente, p_fecha, p_visita, p_cita, p_dentista, nullif(trim(p_indicaciones), ''), p_proxima, nullif(trim(p_proxima_hora), ''))
    returning id into v_id;
  else
    update public.recetas set fecha = p_fecha, visita_numero = p_visita, cita_id = p_cita, dentista_id = p_dentista,
           indicaciones = nullif(trim(p_indicaciones), ''), proxima_cita = p_proxima, proxima_hora = nullif(trim(p_proxima_hora), '')
     where id = p_id returning id into v_id;
    if v_id is null then raise exception 'La receta no existe'; end if;
    delete from public.receta_items where receta_id = v_id;
  end if;
  for e in select * from jsonb_array_elements(p_items) loop
    if trim(coalesce(e->>'medicamento', '')) <> '' then
      v_n := v_n + 1;
      insert into public.receta_items (receta_id, orden, medicamento, dosis, frecuencia, duracion)
      values (v_id, v_n, trim(e->>'medicamento'), nullif(trim(e->>'dosis'), ''), nullif(trim(e->>'frecuencia'), ''), nullif(trim(e->>'duracion'), ''));
    end if;
  end loop;
  return v_id;
end;
$$;
revoke execute on function public.guardar_receta(bigint, bigint, date, int, bigint, bigint, text, jsonb, date, text) from public, anon;
grant execute on function public.guardar_receta(bigint, bigint, date, int, bigint, bigint, text, jsonb, date, text) to authenticated;

-- ===== Historia médica por fecha =====
-- Cada paciente puede tener varios registros de historia médica, uno por fecha, ligados a una cita de la agenda
-- (número de cita = orden de la cita entre las del paciente). Los datos del registro más reciente se copian solos
-- a la ficha del paciente (alergias, enfermedades, medicamentos) para las recetas y avisos de alergia.
-- Todo el personal crea y modifica; solo el Super Administrador elimina.
create table if not exists public.historias_medicas (
  id              bigint generated always as identity primary key,
  paciente_id     bigint not null references public.pacientes (id) on delete cascade,
  fecha           date not null default current_date,
  cita_id         bigint references public.citas (id) on delete set null,
  cita_numero     int,
  alergias        text,
  enfermedades    text,
  medicamentos    text,
  creada          timestamptz not null default now(),
  creada_por      text,
  modificada      timestamptz,
  modificada_por  text
);
create unique index if not exists historias_medicas_fecha on public.historias_medicas (paciente_id, fecha);

create or replace function public.historia_registro()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_usuario text := coalesce((select usuario from public.perfiles where id = auth.uid()), 'Sin usuario');
begin
  if tg_op = 'INSERT' then
    new.creada := now();
    new.creada_por := coalesce(nullif(new.creada_por, ''), v_usuario);
    new.modificada := null; new.modificada_por := null;
  else
    new.creada := old.creada; new.creada_por := old.creada_por; new.paciente_id := old.paciente_id;
    new.modificada := now(); new.modificada_por := v_usuario;
  end if;
  return new;
end;
$$;
-- La ficha del paciente refleja siempre el registro más reciente
create or replace function public.historia_a_paciente()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_pac bigint := coalesce(new.paciente_id, old.paciente_id); h record;
begin
  select alergias, enfermedades, medicamentos into h from public.historias_medicas
   where paciente_id = v_pac order by fecha desc, id desc limit 1;
  update public.pacientes set alergias = h.alergias, enfermedades = h.enfermedades, medicamentos = h.medicamentos
   where id = v_pac and (alergias is distinct from h.alergias or enfermedades is distinct from h.enfermedades or medicamentos is distinct from h.medicamentos);
  return null;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'historias_registro' and tgrelid = 'public.historias_medicas'::regclass) then
    create trigger historias_registro before insert or update on public.historias_medicas
      for each row execute function public.historia_registro();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'historias_a_paciente' and tgrelid = 'public.historias_medicas'::regclass) then
    create trigger historias_a_paciente after insert or update or delete on public.historias_medicas
      for each row execute function public.historia_a_paciente();
  end if;
end $$;

-- Lo que ya estaba en la ficha del paciente pasa a ser su primer registro
insert into public.historias_medicas (paciente_id, fecha, alergias, enfermedades, medicamentos, creada_por)
select p.id, coalesce(p.actualizado::date, p.creado::date, current_date), p.alergias, p.enfermedades, p.medicamentos, 'Registro anterior'
  from public.pacientes p
 where (coalesce(p.alergias, '') <> '' or coalesce(p.enfermedades, '') <> '' or coalesce(p.medicamentos, '') <> '')
   and not exists (select 1 from public.historias_medicas h where h.paciente_id = p.id);

alter table public.historias_medicas enable row level security;
drop policy if exists historias_personal_lee on public.historias_medicas;
create policy historias_personal_lee on public.historias_medicas for select to authenticated using (public.es_personal());
revoke insert, update, delete on public.historias_medicas from anon, authenticated;
grant select on public.historias_medicas to authenticated;

-- Grabar (p_id nulo) o modificar un registro
create or replace function public.guardar_historia(
  p_id bigint, p_paciente bigint, p_fecha date, p_cita bigint, p_cita_numero int,
  p_alergias text, p_enfermedades text, p_medicamentos text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if not public.es_personal() then raise exception 'No tienes permiso para esta acción'; end if;
  if p_fecha is null then raise exception 'Indica la fecha del registro'; end if;
  if p_id is null then
    insert into public.historias_medicas (paciente_id, fecha, cita_id, cita_numero, alergias, enfermedades, medicamentos)
    values (p_paciente, p_fecha, p_cita, p_cita_numero, nullif(trim(p_alergias), ''), nullif(trim(p_enfermedades), ''), nullif(trim(p_medicamentos), ''))
    returning id into v_id;
  else
    update public.historias_medicas set fecha = p_fecha, cita_id = p_cita, cita_numero = p_cita_numero,
           alergias = nullif(trim(p_alergias), ''), enfermedades = nullif(trim(p_enfermedades), ''), medicamentos = nullif(trim(p_medicamentos), '')
     where id = p_id returning id into v_id;
    if v_id is null then raise exception 'El registro no existe'; end if;
  end if;
  return v_id;
exception
  when unique_violation then raise exception 'Ya existe un registro de historia médica con esa fecha para este paciente';
end;
$$;
revoke execute on function public.guardar_historia(bigint, bigint, date, bigint, int, text, text, text) from public, anon;
grant execute on function public.guardar_historia(bigint, bigint, date, bigint, int, text, text, text) to authenticated;

create or replace function public.eliminar_historia(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.es_super_administrador() then raise exception 'Solo el Super Administrador puede eliminar registros de historia médica'; end if;
  delete from public.historias_medicas where id = p_id;
end;
$$;
revoke execute on function public.eliminar_historia(bigint) from public, anon;
grant execute on function public.eliminar_historia(bigint) to authenticated;

-- ===== Firma electrónica y sello del médico =====
-- Imágenes PNG guardadas en el almacenamiento privado «expedientes» (carpeta fotos/). Se imprimen en recetas,
-- presupuestos, tratamientos y estados de cuenta donde aparece el médico.
alter table public.dentistas add column if not exists firma text;
alter table public.dentistas add column if not exists sello text;

-- ===== Tipos de dentistas =====
-- Catálogo de los tipos de odontólogos que ejercen en Guatemala (general y especialistas), con su área de
-- especialidad, la formación habitual y los casos que atienden. El área se usa en la ficha de cada dentista
-- (Especialidades) y en el asistente de la agenda. Código automático TD-01, TD-02…
create table if not exists public.tipos_dentista (
  id              bigint generated always as identity primary key,
  codigo          text,
  nombre          text not null check (char_length(nombre) between 1 and 120),
  especialidad    text not null check (char_length(especialidad) between 1 and 120),
  descripcion     text check (char_length(descripcion) <= 600),
  formacion       text check (char_length(formacion) <= 400),
  atiende         text[] not null default '{}',
  estado          text not null default 'activo' check (estado in ('activo', 'inactivo')),
  orden           int not null default 0,
  registrado_por  text,
  creado          timestamptz not null default now(),
  actualizado_por text,
  actualizado     timestamptz not null default now()
);
create unique index if not exists tipos_dentista_nombre on public.tipos_dentista (lower(nombre));
create unique index if not exists tipos_dentista_codigo on public.tipos_dentista (codigo);

create or replace function public.tipos_dentista_auditoria()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_usuario text := (select usuario from public.perfiles where id = auth.uid());
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('tipos_dentista_codigo'));
    new.codigo := 'TD-' || lpad(((select coalesce(max(substring(codigo from 4)::int), 0) from public.tipos_dentista where codigo ~ '^TD-\d+$') + 1)::text, 2, '0');
    new.registrado_por := coalesce(v_usuario, 'sistema');
    new.creado := now();
  else
    new.codigo := old.codigo; new.registrado_por := old.registrado_por; new.creado := old.creado;
  end if;
  new.nombre := trim(new.nombre); new.especialidad := trim(new.especialidad);
  new.actualizado_por := coalesce(v_usuario, 'sistema');
  new.actualizado := now();
  return new;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'tipos_dentista_auditoria' and tgrelid = 'public.tipos_dentista'::regclass) then
    create trigger tipos_dentista_auditoria before insert or update on public.tipos_dentista
      for each row execute function public.tipos_dentista_auditoria();
  end if;
end $$;

alter table public.tipos_dentista enable row level security;
drop policy if exists "personal administra tipos de dentista" on public.tipos_dentista;
create policy "personal administra tipos de dentista" on public.tipos_dentista for all
  using (public.es_personal()) with check (public.es_personal());
grant select, insert, update, delete on public.tipos_dentista to authenticated;

-- Tipos de dentistas en Guatemala (solo se agregan los que falten)
insert into public.tipos_dentista (nombre, especialidad, descripcion, formacion, atiende, orden)
select v.nombre, v.especialidad, v.descripcion, v.formacion, v.atiende, v.orden
  from (values
    (1, 'Odontólogo general (Cirujano dentista)', 'Odontología general',
     'Primer contacto del paciente: diagnostica, previene y resuelve los tratamientos más comunes, y refiere al especialista cuando hace falta.',
     'Licenciatura en Cirugía Dental (5 a 6 años) y colegiado activo en el Colegio Estomatológico de Guatemala.',
     array['Examen y diagnóstico', 'Limpiezas y prevención', 'Resinas y restauraciones', 'Extracciones simples', 'Urgencias dentales', 'Referencia a especialistas']),
    (2, 'Ortodoncista', 'Ortodoncia y ortopedia maxilar',
     'Corrige la posición de los dientes y la mordida, y guía el crecimiento de los maxilares en niños y adolescentes.',
     'Cirujano dentista con maestría o especialidad en Ortodoncia y Ortopedia Dentomaxilar (2 a 3 años).',
     array['Brackets metálicos y estéticos', 'Alineadores transparentes', 'Ortopedia maxilar en niños', 'Retenedores', 'Mordida cruzada o abierta']),
    (3, 'Endodoncista', 'Endodoncia',
     'Trata el nervio y los conductos del diente para eliminar el dolor y la infección y conservar la pieza.',
     'Cirujano dentista con especialidad o maestría en Endodoncia (2 años).',
     array['Tratamiento de conductos', 'Retratamientos', 'Pulpotomías y pulpectomías', 'Cirugía apical', 'Dolor dental intenso']),
    (4, 'Periodoncista', 'Periodoncia',
     'Previene y trata las enfermedades de las encías y del hueso que sostiene los dientes.',
     'Cirujano dentista con especialidad o maestría en Periodoncia (2 a 3 años).',
     array['Gingivitis y periodontitis', 'Raspado y alisado radicular', 'Cirugía periodontal', 'Injertos de encía', 'Mantenimiento periodontal']),
    (5, 'Prostodoncista (Rehabilitador oral)', 'Rehabilitación oral',
     'Devuelve función y estética reponiendo dientes perdidos o muy dañados con coronas, puentes y prótesis.',
     'Cirujano dentista con especialidad en Prostodoncia o Rehabilitación Oral (2 a 3 años).',
     array['Coronas y puentes', 'Prótesis removibles y totales', 'Prótesis sobre implantes', 'Rehabilitación de toda la boca', 'Incrustaciones']),
    (6, 'Odontopediatra', 'Odontopediatría',
     'Atiende a bebés, niños y adolescentes, con manejo de conducta y prevención desde temprana edad.',
     'Cirujano dentista con especialidad en Odontopediatría (2 años).',
     array['Primera visita y prevención infantil', 'Selladores y flúor', 'Pulpotomías en dientes de leche', 'Coronas de acero', 'Mantenedores de espacio']),
    (7, 'Cirujano oral y maxilofacial', 'Cirugía oral y maxilofacial',
     'Realiza cirugías de la boca, los maxilares y la cara, desde cordales complicadas hasta corrección de deformidades.',
     'Cirujano dentista con residencia hospitalaria en Cirugía Oral y Maxilofacial (3 a 4 años).',
     array['Extracción de cordales', 'Dientes retenidos', 'Quistes y tumores de los maxilares', 'Fracturas faciales', 'Cirugía ortognática']),
    (8, 'Implantólogo oral', 'Implantología oral',
     'Coloca implantes dentales para reponer dientes perdidos y prepara el hueso cuando hace falta.',
     'Cirujano dentista con diplomado, especialidad o maestría en Implantología Oral.',
     array['Implantes unitarios', 'Implantes para puentes y prótesis', 'Injertos de hueso', 'Elevación de seno maxilar', 'Carga inmediata']),
    (9, 'Odontólogo estético', 'Odontología estética',
     'Mejora la apariencia de la sonrisa con tratamientos conservadores y estéticos.',
     'Cirujano dentista con diplomado o maestría en Odontología Estética o Restauradora.',
     array['Diseño de sonrisa', 'Carillas de porcelana o resina', 'Blanqueamiento dental', 'Resinas estéticas', 'Contorneado de encías']),
    (10, 'Patólogo bucal (Medicina oral)', 'Patología y medicina bucal',
     'Diagnostica y trata lesiones y enfermedades de la boca, incluida la detección temprana del cáncer oral.',
     'Cirujano dentista con especialidad en Patología o Medicina Bucal.',
     array['Lesiones y llagas que no sanan', 'Biopsias', 'Enfermedades de la mucosa', 'Detección de cáncer oral', 'Manifestaciones orales de enfermedades']),
    (11, 'Radiólogo oral y maxilofacial', 'Radiología oral y maxilofacial',
     'Toma e interpreta radiografías y tomografías de los dientes y la cara para el diagnóstico.',
     'Cirujano dentista con especialidad en Radiología Oral y Maxilofacial.',
     array['Radiografía panorámica', 'Tomografía (CBCT)', 'Cefalometría para ortodoncia', 'Informes radiológicos', 'Planificación de implantes']),
    (12, 'Especialista en ATM y dolor orofacial', 'Trastornos temporomandibulares y dolor orofacial',
     'Trata los problemas de la articulación de la mandíbula, el bruxismo y el dolor de cara y cabeza de origen dental.',
     'Cirujano dentista con formación de posgrado en Oclusión, ATM y Dolor Orofacial.',
     array['Bruxismo', 'Dolor o chasquido de la mandíbula', 'Placas de relajación', 'Limitación al abrir la boca', 'Dolor orofacial crónico']),
    (13, 'Odontogeriatra', 'Odontogeriatría',
     'Atiende a adultos mayores considerando sus enfermedades, medicamentos y necesidades de prótesis.',
     'Cirujano dentista con formación de posgrado en Odontogeriatría.',
     array['Prótesis en adultos mayores', 'Boca seca', 'Pacientes con varias enfermedades', 'Atención domiciliaria', 'Prevención en la tercera edad']),
    (14, 'Odontólogo de pacientes con necesidades especiales', 'Odontología para pacientes con necesidades especiales',
     'Atiende a personas con discapacidad física o intelectual, o con condiciones médicas complejas.',
     'Cirujano dentista con formación de posgrado en atención de pacientes especiales.',
     array['Pacientes con discapacidad', 'Atención con sedación', 'Pacientes con enfermedades sistémicas', 'Manejo de conducta', 'Prevención adaptada']),
    (15, 'Odontólogo forense', 'Odontología forense',
     'Aplica la odontología a casos legales: identificación de personas, estimación de edad y peritajes.',
     'Cirujano dentista con formación en Odontología Forense o Legal.',
     array['Identificación por registros dentales', 'Estimación de edad', 'Peritajes', 'Análisis de mordeduras']),
    (16, 'Odontólogo en salud pública', 'Salud pública bucal',
     'Diseña y ejecuta programas de prevención y educación en salud bucal para comunidades y escuelas.',
     'Cirujano dentista con maestría en Salud Pública.',
     array['Programas escolares de prevención', 'Jornadas comunitarias', 'Educación en salud bucal', 'Fluorización'])
  ) as v(orden, nombre, especialidad, descripcion, formacion, atiende)
 where not exists (select 1 from public.tipos_dentista t where lower(t.nombre) = lower(v.nombre));

-- Tipo de médico (catálogo «Tipos de dentistas»)
alter table public.dentistas add column if not exists tipo_id bigint references public.tipos_dentista (id) on delete set null;

-- ===== Asistentes dentales =====
-- Usa la tabla «personal» (roles auxiliar e higienista, los que se asignan a cada dentista) con sus datos completos:
-- código automático AS-001, DPI, dirección, fecha de inicio, fotografía y funciones. Queda registrado quién graba y modifica.
alter table public.personal add column if not exists codigo text;
alter table public.personal add column if not exists dpi text;
alter table public.personal add column if not exists direccion text;
alter table public.personal add column if not exists fecha_inicio date;
alter table public.personal add column if not exists foto text;
alter table public.personal add column if not exists funciones text[] not null default '{}';
alter table public.personal add column if not exists registrado_por text;
alter table public.personal add column if not exists actualizado timestamptz;
alter table public.personal add column if not exists actualizado_por text;
create unique index if not exists personal_codigo on public.personal (codigo) where codigo is not null;

create or replace function public.personal_registro()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_usuario text := coalesce((select usuario from public.perfiles where id = auth.uid()), 'sistema');
begin
  if tg_op = 'INSERT' then
    new.registrado_por := v_usuario;
    new.creado := now();
  else
    new.registrado_por := old.registrado_por; new.creado := old.creado;
    if old.codigo is not null then new.codigo := old.codigo; end if;
    new.actualizado := now(); new.actualizado_por := v_usuario;
  end if;
  -- Código automático para asistentes e higienistas
  if new.codigo is null and new.rol in ('auxiliar', 'higienista') then
    perform pg_advisory_xact_lock(hashtext('personal_codigo_asistente'));
    new.codigo := 'AS-' || lpad(((select coalesce(max(substring(codigo from 4)::int), 0) from public.personal where codigo ~ '^AS-\d+$') + 1)::text, 3, '0');
  end if;
  return new;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'personal_registro' and tgrelid = 'public.personal'::regclass) then
    create trigger personal_registro before insert or update on public.personal
      for each row execute function public.personal_registro();
  end if;
end $$;

-- Asistentes que ya existían reciben su código
do $$ declare r record; begin
  for r in select id from public.personal where codigo is null and rol in ('auxiliar', 'higienista') order by id loop
    update public.personal set codigo = null where id = r.id;
  end loop;
end $$;

-- ===== Asistente virtual de la página (chat 24/7) =====
-- El paciente se identifica con su teléfono y los 4 últimos dígitos de su DPI para ver, confirmar o reprogramar
-- sus citas. Máximo 5 intentos fallidos por teléfono cada hora. Agendar usa disponibilidad() y solicitar_cita().
create table if not exists public.bot_intentos (
  id       bigint generated always as identity primary key,
  telefono text not null,
  creado   timestamptz not null default now()
);
create index if not exists bot_intentos_tel on public.bot_intentos (telefono, creado desc);
alter table public.bot_intentos enable row level security;
revoke all on public.bot_intentos from anon, authenticated;

create or replace function public.bot_digitos(t text) returns text language sql immutable as $$
  select right(regexp_replace(coalesce(t, ''), '\D', '', 'g'), 8);
$$;

-- Pacientes que coinciden con teléfono + 4 últimos del DPI (vacío si no coinciden o hay demasiados intentos)
create or replace function public.bot_verificar(p_tel text, p_dpi4 text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_tel text := public.bot_digitos(p_tel); v_ids bigint[];
begin
  if length(v_tel) < 8 or coalesce(p_dpi4, '') !~ '^\d{4}$' then
    return jsonb_build_object('ok', false, 'motivo', 'datos');
  end if;
  if (select count(*) from public.bot_intentos where telefono = v_tel and creado > now() - interval '1 hour') >= 5 then
    return jsonb_build_object('ok', false, 'motivo', 'bloqueado');
  end if;
  select array_agg(id) into v_ids from public.pacientes
   where public.bot_digitos(telefono) = v_tel and right(regexp_replace(coalesce(dpi, ''), '\D', '', 'g'), 4) = p_dpi4;
  if v_ids is null then
    insert into public.bot_intentos (telefono) values (v_tel);
    return jsonb_build_object('ok', false, 'motivo', 'no_coincide');
  end if;
  return jsonb_build_object('ok', true, 'ids', to_jsonb(v_ids), 'tel', v_tel);
end;
$$;
revoke execute on function public.bot_verificar(text, text) from public, anon, authenticated;

-- Próximas citas del paciente verificado
create or replace function public.bot_mis_citas(p_tel text, p_dpi4 text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb := public.bot_verificar(p_tel, p_dpi4);
begin
  if not (v->>'ok')::boolean then return v; end if;
  return jsonb_build_object('ok', true,
    'nombre', (select split_part(nombre, ' ', 1) from public.pacientes where id = (v->'ids'->>0)::bigint),
    'citas', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'fecha', c.fecha, 'hora', to_char(c.hora, 'HH24:MI'), 'servicio', c.servicio,
        'estado', c.estado, 'dentista', d.nombre) order by c.fecha, c.hora)
      from public.citas c left join public.dentistas d on d.id = c.dentista_id
     where c.fecha >= (now() at time zone 'America/Guatemala')::date
       and c.estado in ('pendiente', 'confirmada', 'reprogramada')
       and (c.paciente_id in (select jsonb_array_elements_text(v->'ids')::bigint)
            or (c.paciente_id is null and public.bot_digitos(c.telefono) = v->>'tel'))), '[]'::jsonb));
end;
$$;

-- La cita pertenece al paciente verificado
create or replace function public.bot_cita_del_paciente(v jsonb, p_cita bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.citas c where c.id = p_cita
    and c.fecha >= (now() at time zone 'America/Guatemala')::date
    and c.estado in ('pendiente', 'confirmada', 'reprogramada')
    and (c.paciente_id in (select jsonb_array_elements_text(v->'ids')::bigint)
         or (c.paciente_id is null and public.bot_digitos(c.telefono) = v->>'tel')));
$$;
revoke execute on function public.bot_cita_del_paciente(jsonb, bigint) from public, anon, authenticated;

create or replace function public.bot_confirmar(p_tel text, p_dpi4 text, p_cita bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb := public.bot_verificar(p_tel, p_dpi4);
begin
  if not (v->>'ok')::boolean then return v; end if;
  if not public.bot_cita_del_paciente(v, p_cita) then return jsonb_build_object('ok', false, 'motivo', 'cita'); end if;
  update public.citas set estado = 'confirmada' where id = p_cita and estado in ('pendiente', 'reprogramada');
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.bot_reprogramar(p_tel text, p_dpi4 text, p_cita bigint, p_fecha date, p_hora text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb := public.bot_verificar(p_tel, p_dpi4); c record; v_den bigint; v_pos bigint;
begin
  if not (v->>'ok')::boolean then return v; end if;
  if not public.bot_cita_del_paciente(v, p_cita) then return jsonb_build_object('ok', false, 'motivo', 'cita'); end if;
  if not exists (select 1 from public.disponibilidad(p_fecha, p_fecha) d where d.hora = p_hora and d.libre) then
    return jsonb_build_object('ok', false, 'motivo', 'ocupado');
  end if;
  select * into c from public.citas where id = p_cita;
  -- El mismo dentista si está libre; si no, otro dentista libre a esa hora
  select d.id, d.posicion_id into v_den, v_pos from public.dentistas d
   where public.dentista_libre(d, p_fecha, p_hora::time)
   order by (d.id is distinct from c.dentista_id), (d.rol_sala = 'alterno'), d.nombre limit 1;
  update public.citas
     set reprogramada_de = to_char(fecha, 'YYYY-MM-DD') || ' ' || to_char(hora, 'HH24:MI'),
         fecha = p_fecha, hora = p_hora::time, estado = 'reprogramada',
         dentista_id = coalesce(v_den, dentista_id), posicion_id = coalesce(v_pos, posicion_id),
         reprogramada_en = now(), reprogramada_por = 'Asistente virtual'
   where id = p_cita;
  return jsonb_build_object('ok', true);
exception
  when unique_violation then return jsonb_build_object('ok', false, 'motivo', 'ocupado');
end;
$$;
revoke execute on function public.bot_mis_citas(text, text) from public;
revoke execute on function public.bot_confirmar(text, text, bigint) from public;
revoke execute on function public.bot_reprogramar(text, text, bigint, date, text) from public;
grant execute on function public.bot_mis_citas(text, text) to anon, authenticated;
grant execute on function public.bot_confirmar(text, text, bigint) to anon, authenticated;
grant execute on function public.bot_reprogramar(text, text, bigint, date, text) to anon, authenticated;

-- Agendar desde el asistente: el paciente confirmó en el chat, así que la cita queda Confirmada (no Programada)
create or replace function public.bot_agendar(p_fecha date, p_hora text, p_servicio text, p_nombre text, p_telefono text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  v_id := public.solicitar_cita(p_fecha, p_hora, p_servicio, p_nombre, p_telefono);
  update public.citas
     set estado = 'confirmada',
         notas = trim(coalesce(notas || ' ', '') || 'Agendada y confirmada por el paciente en el asistente virtual.')
   where id = v_id;
  return v_id;
end;
$$;
revoke execute on function public.bot_agendar(date, text, text, text, text) from public;
grant execute on function public.bot_agendar(date, text, text, text, text) to anon, authenticated;

-- ===== Órdenes de laboratorio dental =====
-- Solicitudes de trabajos a laboratorios (coronas, puentes, prótesis, férulas…) con su seguimiento por etapas.
-- Número automático LAB-AÑO-correlativo. Cada cambio de estado queda en el historial con fecha y usuario.
create table if not exists public.laboratorios (
  id         bigint generated always as identity primary key,
  nombre     text not null check (char_length(nombre) between 1 and 120),
  contacto   text,
  telefono   text,
  correo     text,
  direccion  text,
  activo     boolean not null default true,
  creado     timestamptz not null default now()
);
create unique index if not exists laboratorios_nombre on public.laboratorios (lower(nombre));

create table if not exists public.ordenes_lab (
  id              bigint generated always as identity primary key,
  numero          text unique,
  paciente_id     bigint not null references public.pacientes (id) on delete cascade,
  dentista_id     bigint references public.dentistas (id) on delete set null,
  laboratorio_id  bigint references public.laboratorios (id) on delete set null,
  cita_id         bigint references public.citas (id) on delete set null,
  trabajo         text not null,
  piezas          text,
  material        text,
  color           text,
  impresion       text,
  envia           text[] not null default '{}',
  indicaciones    text,
  fecha_envio     date,
  fecha_entrega   date,
  fecha_recibida  date,
  costo           numeric(12,2),
  estado          text not null default 'borrador'
                  check (estado in ('borrador', 'enviada', 'proceso', 'prueba', 'recibida', 'colocada', 'devuelta', 'cancelada')),
  estado_fecha    timestamptz,
  estado_por      text,
  creada          timestamptz not null default now(),
  creada_por      text,
  modificada      timestamptz,
  modificada_por  text
);
create index if not exists ordenes_lab_paciente on public.ordenes_lab (paciente_id, creada desc);

create table if not exists public.ordenes_lab_estados (
  id        bigint generated always as identity primary key,
  orden_id  bigint not null references public.ordenes_lab (id) on delete cascade,
  estado    text not null,
  fecha     timestamptz not null default now(),
  usuario   text,
  nota      text
);
create index if not exists ordenes_lab_estados_orden on public.ordenes_lab_estados (orden_id, fecha);

create or replace function public.orden_lab_registro()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_usuario text := coalesce((select usuario from public.perfiles where id = auth.uid()), 'Sin usuario'); v_anio text;
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('ordenes_lab_numero'));
    v_anio := to_char(current_date, 'YYYY');
    new.numero := 'LAB-' || v_anio || '-' || lpad((select coalesce(max(substring(numero from 10)::int), 0) + 1
                    from public.ordenes_lab where numero ~ ('^LAB-' || v_anio || '-[0-9]+$'))::text, 4, '0');
    new.creada := now(); new.creada_por := v_usuario;
    new.modificada := null; new.modificada_por := null;
    new.estado_fecha := now(); new.estado_por := v_usuario;
  else
    new.numero := old.numero; new.creada := old.creada; new.creada_por := old.creada_por; new.paciente_id := old.paciente_id;
    new.modificada := now(); new.modificada_por := v_usuario;
    if new.estado is distinct from old.estado then new.estado_fecha := now(); new.estado_por := v_usuario; end if;
  end if;
  if new.estado = 'enviada' and new.fecha_envio is null then new.fecha_envio := current_date; end if;
  if new.estado in ('recibida', 'colocada') and new.fecha_recibida is null then new.fecha_recibida := current_date; end if;
  return new;
end;
$$;
create or replace function public.orden_lab_historial()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.estado is distinct from old.estado then
    insert into public.ordenes_lab_estados (orden_id, estado, usuario) values (new.id, new.estado, new.estado_por);
  end if;
  return null;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'ordenes_lab_registro' and tgrelid = 'public.ordenes_lab'::regclass) then
    create trigger ordenes_lab_registro before insert or update on public.ordenes_lab for each row execute function public.orden_lab_registro();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'ordenes_lab_historial' and tgrelid = 'public.ordenes_lab'::regclass) then
    create trigger ordenes_lab_historial after insert or update on public.ordenes_lab for each row execute function public.orden_lab_historial();
  end if;
end $$;

alter table public.laboratorios enable row level security;
alter table public.ordenes_lab enable row level security;
alter table public.ordenes_lab_estados enable row level security;
drop policy if exists laboratorios_personal on public.laboratorios;
create policy laboratorios_personal on public.laboratorios for all to authenticated using (public.es_personal()) with check (public.es_personal());
drop policy if exists ordenes_lab_lee on public.ordenes_lab;
create policy ordenes_lab_lee on public.ordenes_lab for select to authenticated using (public.es_personal());
drop policy if exists ordenes_lab_crea on public.ordenes_lab;
create policy ordenes_lab_crea on public.ordenes_lab for insert to authenticated with check (public.es_personal());
drop policy if exists ordenes_lab_edita on public.ordenes_lab;
create policy ordenes_lab_edita on public.ordenes_lab for update to authenticated using (public.es_personal()) with check (public.es_personal());
drop policy if exists ordenes_lab_borra on public.ordenes_lab;
create policy ordenes_lab_borra on public.ordenes_lab for delete to authenticated using (public.es_super_administrador());
drop policy if exists ordenes_lab_estados_lee on public.ordenes_lab_estados;
create policy ordenes_lab_estados_lee on public.ordenes_lab_estados for select to authenticated using (public.es_personal());
drop policy if exists ordenes_lab_estados_nota on public.ordenes_lab_estados;
create policy ordenes_lab_estados_nota on public.ordenes_lab_estados for update to authenticated using (public.es_personal()) with check (public.es_personal());
grant select, insert, update, delete on public.laboratorios to authenticated;
grant select, insert, update, delete on public.ordenes_lab to authenticated;
grant select, update on public.ordenes_lab_estados to authenticated;

-- ===== Constancias médicas =====
-- Cada constancia emitida queda registrada con número CM-AÑO-correlativo, el texto impreso, quién la emitió y cuándo.
create table if not exists public.constancias (
  id            bigint generated always as identity primary key,
  numero        text unique,
  paciente_id   bigint not null references public.pacientes (id) on delete cascade,
  dentista_id   bigint references public.dentistas (id) on delete set null,
  fecha         date not null,
  hora_entrada  text,
  hora_salida   text,
  diagnostico   text,
  tratamiento   text,
  reposo_dias   int not null default 0 check (reposo_dias between 0 and 60),
  reposo_desde  date,
  reposo_hasta  date,
  dirigida      text,
  texto         text not null,
  creada        timestamptz not null default now(),
  creada_por    text
);
create index if not exists constancias_paciente on public.constancias (paciente_id, creada desc);

create or replace function public.constancia_registro()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_anio text := to_char(current_date, 'YYYY');
begin
  perform pg_advisory_xact_lock(hashtext('constancias_numero'));
  new.numero := 'CM-' || v_anio || '-' || lpad((select coalesce(max(substring(numero from 9)::int), 0) + 1
                  from public.constancias where numero ~ ('^CM-' || v_anio || '-[0-9]+$'))::text, 4, '0');
  new.creada := now();
  new.creada_por := coalesce((select usuario from public.perfiles where id = auth.uid()), 'Sin usuario');
  return new;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'constancias_registro' and tgrelid = 'public.constancias'::regclass) then
    create trigger constancias_registro before insert on public.constancias for each row execute function public.constancia_registro();
  end if;
end $$;

alter table public.constancias enable row level security;
drop policy if exists constancias_lee on public.constancias;
create policy constancias_lee on public.constancias for select to authenticated using (public.es_personal());
drop policy if exists constancias_crea on public.constancias;
create policy constancias_crea on public.constancias for insert to authenticated with check (public.es_personal());
drop policy if exists constancias_borra on public.constancias;
create policy constancias_borra on public.constancias for delete to authenticated using (public.es_super_administrador());
grant select, insert, delete on public.constancias to authenticated;

-- ===== Portal del paciente («Mi expediente») =====
-- Cada paciente puede tener un usuario de tipo Cliente. Al conectarse, ese usuario ve solo su propia información
-- (datos, próximas citas, recetas, tratamientos, estado de cuenta y constancias), sin poder modificarla.
alter table public.pacientes add column if not exists usuario text;
create unique index if not exists pacientes_usuario_unico on public.pacientes (usuario) where usuario is not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pacientes_usuario_fk') then
    alter table public.pacientes add constraint pacientes_usuario_fk foreign key (usuario)
      references public.perfiles (usuario) on update cascade on delete set null;
  end if;
end $$;

create or replace function public.mi_portal()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_usuario text := (select usuario from public.perfiles where id = auth.uid()); p record;
begin
  if v_usuario is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  select pa.*, d.nombre as medico into p from public.pacientes pa left join public.dentistas d on d.id = pa.dentista_id
   where pa.usuario = v_usuario limit 1;
  if p.id is null then return jsonb_build_object('ok', false, 'motivo', 'sin_paciente', 'usuario', v_usuario); end if;
  return jsonb_build_object('ok', true,
    'paciente', jsonb_build_object('id', p.id, 'nombre', p.nombre, 'dpi', p.dpi, 'nit', p.nit, 'fecha_nacimiento', p.fecha_nacimiento,
      'telefono', p.telefono, 'correo', p.correo, 'direccion', p.direccion, 'medico', p.medico, 'alergias', p.alergias),
    'citas', coalesce((select jsonb_agg(jsonb_build_object('fecha', c.fecha, 'hora', to_char(c.hora, 'HH24:MI'), 'servicio', c.servicio, 'estado', c.estado, 'dentista', d.nombre) order by c.fecha, c.hora)
      from public.citas c left join public.dentistas d on d.id = c.dentista_id
     where c.paciente_id = p.id and c.fecha >= (now() at time zone 'America/Guatemala')::date and c.estado in ('pendiente', 'confirmada', 'reprogramada')), '[]'::jsonb),
    'recetas', coalesce((select jsonb_agg(jsonb_build_object('numero', r.numero, 'fecha', r.fecha, 'indicaciones', r.indicaciones, 'proxima_cita', r.proxima_cita, 'proxima_hora', r.proxima_hora,
        'dentista', d.nombre, 'colegiado', d.colegiado, 'dentista_id', r.dentista_id,
        'items', coalesce((select jsonb_agg(jsonb_build_object('medicamento', i.medicamento, 'dosis', i.dosis, 'frecuencia', i.frecuencia, 'duracion', i.duracion) order by i.orden) from public.receta_items i where i.receta_id = r.id), '[]'::jsonb))
        order by r.fecha desc, r.id desc)
      from public.recetas r left join public.dentistas d on d.id = r.dentista_id where r.paciente_id = p.id), '[]'::jsonb),
    'tratamientos', coalesce((select jsonb_agg(jsonb_build_object('tratamiento', i.tratamiento, 'pieza', i.pieza, 'estado', coalesce(i.estado, case when i.realizado then 'finalizado' else 'pendiente' end),
        'fecha', coalesce(i.estado_fecha::date, i.realizado_en), 'total', round(i.cantidad * i.precio * (1 - coalesce(pr.descuento_pct, 0) / 100), 2)) order by coalesce(i.estado_fecha::date, i.realizado_en) desc nulls last)
      from public.presupuesto_items i join public.presupuestos pr on pr.id = i.presupuesto_id
     where pr.paciente_id = p.id and pr.estado = 'aprobado' and coalesce(i.estado, case when i.realizado then 'finalizado' else 'pendiente' end) in ('proceso', 'finalizado')), '[]'::jsonb),
    'saldo', (select jsonb_build_object('cargos', s.cargos, 'abonos', s.abonos, 'saldo', s.saldo) from public.saldos_pacientes s where s.paciente_id = p.id),
    'pagos', coalesce((select jsonb_agg(jsonb_build_object('fecha', g.fecha, 'monto', g.monto, 'metodo', g.metodo, 'concepto', g.concepto) order by g.fecha desc, g.id desc)
      from public.pagos g where g.paciente_id = p.id and not g.anulado), '[]'::jsonb),
    'constancias', coalesce((select jsonb_agg(jsonb_build_object('numero', c.numero, 'fecha', c.fecha, 'dirigida', c.dirigida, 'texto', c.texto, 'creada', c.creada, 'dentista', d.nombre, 'colegiado', d.colegiado, 'dentista_id', c.dentista_id) order by c.creada desc)
      from public.constancias c left join public.dentistas d on d.id = c.dentista_id where c.paciente_id = p.id), '[]'::jsonb));
end;
$$;
revoke execute on function public.mi_portal() from public, anon;
grant execute on function public.mi_portal() to authenticated;

-- Portal del paciente: resto del expediente (historia médica, odontograma, notas de visita, radiografías,
-- órdenes de laboratorio, presupuestos y comprobantes), siempre de solo lectura y solo del paciente del usuario conectado.
create or replace function public.mi_paciente_id()
returns bigint language sql stable security definer set search_path = public as $$
  select pa.id from public.pacientes pa join public.perfiles pf on pf.usuario = pa.usuario where pf.id = auth.uid() limit 1;
$$;
revoke execute on function public.mi_paciente_id() from public, anon;
grant execute on function public.mi_paciente_id() to authenticated;

create or replace function public.mi_portal_detalle()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_id bigint := public.mi_paciente_id(); p record;
begin
  if v_id is null then return jsonb_build_object('ok', false); end if;
  select * into p from public.pacientes where id = v_id;
  return jsonb_build_object('ok', true,
    'foto', p.foto, 'odontograma', p.odontograma, 'fecha_nacimiento', p.fecha_nacimiento,
    'historias', coalesce((select jsonb_agg(jsonb_build_object('fecha', h.fecha, 'cita_numero', h.cita_numero, 'alergias', h.alergias, 'enfermedades', h.enfermedades,
        'medicamentos', h.medicamentos) order by h.fecha desc) from public.historias_medicas h where h.paciente_id = v_id), '[]'::jsonb),
    'odontograma_cambios', coalesce((select jsonb_agg(jsonb_build_object('pieza', c.pieza, 'descripcion', c.descripcion, 'fecha', c.fecha_cambio,
        'observaciones', c.observaciones) order by c.fecha_cambio desc) from public.odontograma_cambios c where c.paciente_id = v_id), '[]'::jsonb),
    'notas', coalesce((select jsonb_agg(jsonb_build_object('fecha', n.fecha, 'texto', n.texto, 'autor', n.autor_usuario) order by n.fecha desc, n.id desc)
      from public.notas_visita n where n.paciente_id = v_id), '[]'::jsonb),
    'ordenes_lab', coalesce((select jsonb_agg(jsonb_build_object('numero', o.numero, 'trabajo', o.trabajo, 'piezas', o.piezas, 'material', o.material, 'color', o.color,
        'estado', o.estado, 'fecha_envio', o.fecha_envio, 'fecha_entrega', o.fecha_entrega, 'fecha_recibida', o.fecha_recibida, 'laboratorio', l.nombre, 'dentista', d.nombre,
        'creada', o.creada) order by o.creada desc)
      from public.ordenes_lab o left join public.laboratorios l on l.id = o.laboratorio_id left join public.dentistas d on d.id = o.dentista_id
     where o.paciente_id = v_id and o.estado <> 'borrador'), '[]'::jsonb),
    'presupuestos', coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'codigo', pr.codigo, 'fecha', pr.fecha, 'estado', pr.estado, 'descuento_pct', pr.descuento_pct,
        'forma_pago', pr.forma_pago, 'cuotas', pr.cuotas, 'recargo_pct', pr.recargo_pct, 'sin_recargo', pr.sin_recargo, 'notas', pr.notas, 'aprobado_en', pr.aprobado_en,
        'items', coalesce((select jsonb_agg(jsonb_build_object('tratamiento', i.tratamiento, 'pieza', i.pieza, 'cantidad', i.cantidad, 'precio', i.precio, 'estado', i.estado) order by i.orden, i.id)
          from public.presupuesto_items i where i.presupuesto_id = pr.id and i.estado <> 'eliminado'), '[]'::jsonb)) order by pr.fecha desc, pr.id desc)
      from public.presupuestos pr where pr.paciente_id = v_id and pr.estado <> 'borrador'), '[]'::jsonb),
    'comprobantes', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'correlativo', g.correlativo, 'tipo_documento', g.tipo_documento, 'serie', g.serie,
        'numero_factura', g.numero_factura, 'fecha', g.fecha, 'monto', g.monto, 'metodo', g.metodo, 'referencia', g.referencia, 'concepto', g.concepto,
        'nit', g.nit, 'numero_cuota', g.numero_cuota) order by g.fecha desc, g.id desc)
      from public.pagos g where g.paciente_id = v_id and not g.anulado), '[]'::jsonb));
end;
$$;
revoke execute on function public.mi_portal_detalle() from public, anon;
grant execute on function public.mi_portal_detalle() to authenticated;

-- Archivos: el paciente ve sus radiografías (carpeta con su número), su foto y las firmas y sellos de los médicos
do $$ begin
  drop policy if exists "paciente ve sus archivos" on storage.objects;
  create policy "paciente ve sus archivos" on storage.objects for select to authenticated
    using (bucket_id = 'expedientes' and public.mi_paciente_id() is not null and (
      split_part(name, '/', 1) = public.mi_paciente_id()::text
      or name = 'fotos/' || public.mi_paciente_id()::text || '.jpg'
      or name like 'fotos/firma-dentista-%' or name like 'fotos/sello-dentista-%'));
end $$;

-- ===== Portal del dentista («Mis pacientes») =====
-- Cada dentista puede tener un usuario (de los usuarios tipo Cliente, para que no vea el panel de la clínica).
-- Al conectarse ve solo sus pacientes (médico asignado o con alguna cita no cancelada con él) con todo su expediente,
-- de solo lectura. El paciente y el dentista reutilizan las mismas consultas (portal_datos y portal_detalle).
alter table public.dentistas add column if not exists usuario text;
create unique index if not exists dentistas_usuario_unico on public.dentistas (usuario) where usuario is not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'dentistas_usuario_fk') then
    alter table public.dentistas add constraint dentistas_usuario_fk foreign key (usuario)
      references public.perfiles (usuario) on update cascade on delete set null;
  end if;
end $$;

-- Datos generales del expediente de un paciente (uso interno)
create or replace function public.portal_datos(v_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p record;
begin
  select pa.*, d.nombre as medico into p from public.pacientes pa left join public.dentistas d on d.id = pa.dentista_id where pa.id = v_id;
  if p.id is null then return jsonb_build_object('ok', false, 'motivo', 'sin_paciente'); end if;
  return jsonb_build_object('ok', true,
    'paciente', jsonb_build_object('id', p.id, 'nombre', p.nombre, 'dpi', p.dpi, 'nit', p.nit, 'fecha_nacimiento', p.fecha_nacimiento,
      'telefono', p.telefono, 'correo', p.correo, 'direccion', p.direccion, 'medico', p.medico, 'alergias', p.alergias),
    'citas', coalesce((select jsonb_agg(jsonb_build_object('fecha', c.fecha, 'hora', to_char(c.hora, 'HH24:MI'), 'servicio', c.servicio, 'estado', c.estado, 'dentista', d.nombre) order by c.fecha, c.hora)
      from public.citas c left join public.dentistas d on d.id = c.dentista_id
     where c.paciente_id = p.id and c.fecha >= (now() at time zone 'America/Guatemala')::date and c.estado in ('pendiente', 'confirmada', 'reprogramada')), '[]'::jsonb),
    'historial_citas', coalesce((select jsonb_agg(jsonb_build_object('fecha', c.fecha, 'hora', to_char(c.hora, 'HH24:MI'), 'servicio', c.servicio, 'estado', c.estado, 'dentista', d.nombre,
        'reprogramada_de', c.reprogramada_de) order by c.fecha desc, c.hora desc)
      from public.citas c left join public.dentistas d on d.id = c.dentista_id
     where c.paciente_id = p.id and c.estado in ('pendiente', 'confirmada', 'reprogramada', 'atendida')), '[]'::jsonb),
    'recetas', coalesce((select jsonb_agg(jsonb_build_object('numero', r.numero, 'fecha', r.fecha, 'indicaciones', r.indicaciones, 'proxima_cita', r.proxima_cita, 'proxima_hora', r.proxima_hora,
        'dentista', d.nombre, 'colegiado', d.colegiado, 'dentista_id', r.dentista_id,
        'items', coalesce((select jsonb_agg(jsonb_build_object('medicamento', i.medicamento, 'dosis', i.dosis, 'frecuencia', i.frecuencia, 'duracion', i.duracion) order by i.orden) from public.receta_items i where i.receta_id = r.id), '[]'::jsonb))
        order by r.fecha desc, r.id desc)
      from public.recetas r left join public.dentistas d on d.id = r.dentista_id where r.paciente_id = p.id), '[]'::jsonb),
    'tratamientos', coalesce((select jsonb_agg(jsonb_build_object('tratamiento', i.tratamiento, 'pieza', i.pieza, 'estado', coalesce(i.estado, case when i.realizado then 'finalizado' else 'pendiente' end),
        'fecha', coalesce(i.estado_fecha::date, i.realizado_en), 'total', round(i.cantidad * i.precio * (1 - coalesce(pr.descuento_pct, 0) / 100), 2)) order by coalesce(i.estado_fecha::date, i.realizado_en) desc nulls last)
      from public.presupuesto_items i join public.presupuestos pr on pr.id = i.presupuesto_id
     where pr.paciente_id = p.id and pr.estado = 'aprobado' and coalesce(i.estado, case when i.realizado then 'finalizado' else 'pendiente' end) in ('proceso', 'finalizado')), '[]'::jsonb),
    'saldo', (select jsonb_build_object('cargos', s.cargos, 'abonos', s.abonos, 'saldo', s.saldo) from public.saldos_pacientes s where s.paciente_id = p.id),
    'pagos', coalesce((select jsonb_agg(jsonb_build_object('fecha', g.fecha, 'monto', g.monto, 'metodo', g.metodo, 'concepto', g.concepto) order by g.fecha desc, g.id desc)
      from public.pagos g where g.paciente_id = p.id and not g.anulado), '[]'::jsonb),
    'constancias', coalesce((select jsonb_agg(jsonb_build_object('numero', c.numero, 'fecha', c.fecha, 'dirigida', c.dirigida, 'texto', c.texto, 'creada', c.creada, 'dentista', d.nombre, 'colegiado', d.colegiado, 'dentista_id', c.dentista_id) order by c.creada desc)
      from public.constancias c left join public.dentistas d on d.id = c.dentista_id where c.paciente_id = p.id), '[]'::jsonb));
end;
$$;

-- Resto del expediente de un paciente (uso interno)
create or replace function public.portal_detalle(v_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p record;
begin
  select * into p from public.pacientes where id = v_id;
  if p.id is null then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true,
    'foto', p.foto, 'odontograma', p.odontograma, 'fecha_nacimiento', p.fecha_nacimiento,
    'historias', coalesce((select jsonb_agg(jsonb_build_object('fecha', h.fecha, 'cita_numero', h.cita_numero, 'alergias', h.alergias, 'enfermedades', h.enfermedades,
        'medicamentos', h.medicamentos) order by h.fecha desc) from public.historias_medicas h where h.paciente_id = v_id), '[]'::jsonb),
    'odontograma_cambios', coalesce((select jsonb_agg(jsonb_build_object('pieza', c.pieza, 'descripcion', c.descripcion, 'fecha', c.fecha_cambio,
        'observaciones', c.observaciones) order by c.fecha_cambio desc) from public.odontograma_cambios c where c.paciente_id = v_id), '[]'::jsonb),
    'notas', coalesce((select jsonb_agg(jsonb_build_object('fecha', n.fecha, 'texto', n.texto, 'autor', n.autor_usuario) order by n.fecha desc, n.id desc)
      from public.notas_visita n where n.paciente_id = v_id), '[]'::jsonb),
    'ordenes_lab', coalesce((select jsonb_agg(jsonb_build_object('numero', o.numero, 'trabajo', o.trabajo, 'piezas', o.piezas, 'material', o.material, 'color', o.color,
        'estado', o.estado, 'fecha_envio', o.fecha_envio, 'fecha_entrega', o.fecha_entrega, 'fecha_recibida', o.fecha_recibida, 'laboratorio', l.nombre, 'dentista', d.nombre,
        'creada', o.creada) order by o.creada desc)
      from public.ordenes_lab o left join public.laboratorios l on l.id = o.laboratorio_id left join public.dentistas d on d.id = o.dentista_id
     where o.paciente_id = v_id and o.estado <> 'borrador'), '[]'::jsonb),
    'presupuestos', coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'codigo', pr.codigo, 'fecha', pr.fecha, 'estado', pr.estado, 'descuento_pct', pr.descuento_pct,
        'forma_pago', pr.forma_pago, 'cuotas', pr.cuotas, 'recargo_pct', pr.recargo_pct, 'sin_recargo', pr.sin_recargo, 'notas', pr.notas, 'aprobado_en', pr.aprobado_en,
        'items', coalesce((select jsonb_agg(jsonb_build_object('tratamiento', i.tratamiento, 'pieza', i.pieza, 'cantidad', i.cantidad, 'precio', i.precio, 'estado', i.estado) order by i.orden, i.id)
          from public.presupuesto_items i where i.presupuesto_id = pr.id and i.estado <> 'eliminado'), '[]'::jsonb)) order by pr.fecha desc, pr.id desc)
      from public.presupuestos pr where pr.paciente_id = v_id and pr.estado <> 'borrador'), '[]'::jsonb),
    'comprobantes', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'correlativo', g.correlativo, 'tipo_documento', g.tipo_documento, 'serie', g.serie,
        'numero_factura', g.numero_factura, 'fecha', g.fecha, 'monto', g.monto, 'metodo', g.metodo, 'referencia', g.referencia, 'concepto', g.concepto,
        'nit', g.nit, 'numero_cuota', g.numero_cuota) order by g.fecha desc, g.id desc)
      from public.pagos g where g.paciente_id = v_id and not g.anulado), '[]'::jsonb));
end;
$$;
revoke execute on function public.portal_datos(bigint) from public, anon, authenticated;
revoke execute on function public.portal_detalle(bigint) from public, anon, authenticated;

-- Paciente conectado: su propio expediente
create or replace function public.mi_portal()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_usuario text := (select usuario from public.perfiles where id = auth.uid()); v_id bigint := public.mi_paciente_id();
begin
  if v_usuario is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;
  if v_id is null then return jsonb_build_object('ok', false, 'motivo', 'sin_paciente', 'usuario', v_usuario); end if;
  return public.portal_datos(v_id);
end;
$$;
create or replace function public.mi_portal_detalle()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_id bigint := public.mi_paciente_id();
begin
  if v_id is null then return jsonb_build_object('ok', false); end if;
  return public.portal_detalle(v_id);
end;
$$;

-- Dentista conectado
create or replace function public.mi_dentista_id()
returns bigint language sql stable security definer set search_path = public as $$
  select d.id from public.dentistas d join public.perfiles pf on pf.usuario = d.usuario where pf.id = auth.uid() limit 1;
$$;
create or replace function public.es_paciente_de_dentista(p_paciente bigint, p_dentista bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select p_dentista is not null and (
    exists (select 1 from public.pacientes where id = p_paciente and dentista_id = p_dentista)
    or exists (select 1 from public.citas where paciente_id = p_paciente and dentista_id = p_dentista and estado <> 'cancelada'));
$$;
revoke execute on function public.mi_dentista_id() from public, anon;
revoke execute on function public.es_paciente_de_dentista(bigint, bigint) from public, anon;
grant execute on function public.mi_dentista_id() to authenticated;
grant execute on function public.es_paciente_de_dentista(bigint, bigint) to authenticated;

create or replace function public.dentista_pacientes()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_den bigint := public.mi_dentista_id(); v_hoy date := (now() at time zone 'America/Guatemala')::date;
begin
  if v_den is null then return jsonb_build_object('ok', false, 'motivo', 'no_dentista'); end if;
  return jsonb_build_object('ok', true,
    'dentista', (select jsonb_build_object('id', d.id, 'nombre', d.nombre, 'colegiado', d.colegiado) from public.dentistas d where d.id = v_den),
    'pacientes', coalesce((select jsonb_agg(x order by x->>'nombre') from (
      select jsonb_build_object('id', pa.id, 'nombre', pa.nombre, 'dpi', pa.dpi, 'telefono', pa.telefono, 'asignado', pa.dentista_id = v_den,
        'ultima', (select max(c.fecha) from public.citas c where c.paciente_id = pa.id and c.dentista_id = v_den and c.fecha < v_hoy and c.estado <> 'cancelada'),
        'proxima', (select min(c.fecha) from public.citas c where c.paciente_id = pa.id and c.dentista_id = v_den and c.fecha >= v_hoy and c.estado in ('pendiente', 'confirmada', 'reprogramada'))) x
        from public.pacientes pa where public.es_paciente_de_dentista(pa.id, v_den)) t), '[]'::jsonb));
end;
$$;
create or replace function public.dentista_expediente(p_paciente bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.es_paciente_de_dentista(p_paciente, public.mi_dentista_id()) then return jsonb_build_object('ok', false, 'motivo', 'permiso'); end if;
  return jsonb_build_object('ok', true, 'datos', public.portal_datos(p_paciente), 'detalle', public.portal_detalle(p_paciente));
end;
$$;
revoke execute on function public.dentista_pacientes() from public, anon;
revoke execute on function public.dentista_expediente(bigint) from public, anon;
grant execute on function public.dentista_pacientes() to authenticated;
grant execute on function public.dentista_expediente(bigint) to authenticated;

-- Archivos: el dentista ve las radiografías y fotos de sus pacientes, y las firmas y sellos
drop policy if exists "dentista ve archivos de sus pacientes" on storage.objects;
create policy "dentista ve archivos de sus pacientes" on storage.objects for select to authenticated
  using (bucket_id = 'expedientes' and public.mi_dentista_id() is not null and (
    (split_part(name, '/', 1) ~ '^[0-9]+$' and public.es_paciente_de_dentista(split_part(name, '/', 1)::bigint, public.mi_dentista_id()))
    or (name ~ '^fotos/[0-9]+\.jpg$' and public.es_paciente_de_dentista(substring(name from '^fotos/([0-9]+)\.jpg$')::bigint, public.mi_dentista_id()))
    or name like 'fotos/firma-dentista-%' or name like 'fotos/sello-dentista-%'));

-- ===== Geografía y Organizaciones (grupo «Catálogos iniciales») =====
-- Geografía: Países → Estados / Departamentos (con su región) → Ciudades / Municipios. Cada país tiene su catálogo de regiones.
-- Organizaciones: la organización (grupo corporativo) y sus localidades (empresas / sedes) con razón social, NIT, patrono y logo.
-- Datos iniciales: Guatemala (8 regiones, 22 departamentos y 340 municipios) y países de la región.
create table if not exists public.geo_paises (
  id           bigint generated always as identity primary key,
  codigo       text not null unique check (char_length(codigo) between 1 and 10),
  nombre       text not null check (char_length(nombre) between 1 and 80),
  prefijo      text check (char_length(prefijo) <= 10),
  bandera      text check (char_length(bandera) <= 300),
  idioma       text check (char_length(idioma) <= 60),
  moneda       text check (char_length(moneda) <= 30),
  codigo_tel   text check (char_length(codigo_tel) <= 10),
  activo       boolean not null default true,
  creado       timestamptz not null default now()
);
create table if not exists public.geo_regiones (
  id       bigint generated always as identity primary key,
  pais_id  bigint not null references public.geo_paises (id) on delete cascade,
  codigo   text not null check (char_length(codigo) between 1 and 10),
  nombre   text not null check (char_length(nombre) between 1 and 80),
  unique (pais_id, codigo)
);
create table if not exists public.geo_estados (
  id             bigint generated always as identity primary key,
  pais_id        bigint not null references public.geo_paises (id) on delete cascade,
  codigo         text not null check (char_length(codigo) between 1 and 10),
  nombre         text not null check (char_length(nombre) between 1 and 80),
  region_id      bigint references public.geo_regiones (id) on delete set null,
  codigo_tel     text check (char_length(codigo_tel) <= 10),
  codigo_postal  text check (char_length(codigo_postal) <= 15),
  unique (pais_id, codigo)
);
create table if not exists public.geo_municipios (
  id              bigint generated always as identity primary key,
  pais_id         bigint not null references public.geo_paises (id) on delete cascade,
  estado_id       bigint not null references public.geo_estados (id) on delete cascade,
  codigo          text not null check (char_length(codigo) between 1 and 10),
  nombre          text not null check (char_length(nombre) between 1 and 80),
  prefijo         text check (char_length(prefijo) <= 10),
  codigo_tel      text check (char_length(codigo_tel) <= 10),
  prefijo_ciudad  text check (char_length(prefijo_ciudad) <= 10),
  codigo_postal   text check (char_length(codigo_postal) <= 15),
  unique (estado_id, codigo)
);
create index if not exists geo_municipios_estado on public.geo_municipios (estado_id, codigo);

create table if not exists public.organizaciones (
  id             bigint generated always as identity primary key,
  codigo         text not null unique check (char_length(codigo) between 1 and 10),
  nombre         text not null check (char_length(nombre) between 1 and 150),
  representante  text check (char_length(representante) <= 150),
  telefonos      text check (char_length(telefonos) <= 120),
  correos        text check (char_length(correos) <= 200),
  direccion      text check (char_length(direccion) <= 300),
  pais_id        bigint references public.geo_paises (id) on delete set null,
  estado_id      bigint references public.geo_estados (id) on delete set null,
  municipio_id   bigint references public.geo_municipios (id) on delete set null,
  creado         timestamptz not null default now()
);
create table if not exists public.org_localidades (
  id                bigint generated always as identity primary key,
  organizacion_id   bigint not null references public.organizaciones (id) on delete cascade,
  codigo            text not null check (char_length(codigo) between 1 and 10),
  razon_social      text not null check (char_length(razon_social) between 1 and 200),
  nombre_comercial  text check (char_length(nombre_comercial) <= 150),
  representante     text check (char_length(representante) <= 150),
  nit               text check (char_length(nit) <= 20),
  codigo_patrono    text check (char_length(codigo_patrono) <= 30),
  telefonos         text check (char_length(telefonos) <= 120),
  correos           text check (char_length(correos) <= 200),
  pais_id           bigint references public.geo_paises (id) on delete set null,
  estado_id         bigint references public.geo_estados (id) on delete set null,
  municipio_id      bigint references public.geo_municipios (id) on delete set null,
  direccion         text check (char_length(direccion) <= 300),
  logo              text,
  creado            timestamptz not null default now(),
  unique (organizacion_id, codigo)
);

-- Lectura y edición: personal de la clínica; borrar: Super Administrador
do $$ declare t text; begin
  foreach t in array array['geo_paises', 'geo_regiones', 'geo_estados', 'geo_municipios', 'organizaciones', 'org_localidades'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_lee', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.es_personal())', t || '_lee', t);
    execute format('drop policy if exists %I on public.%I', t || '_crea', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.es_personal())', t || '_crea', t);
    execute format('drop policy if exists %I on public.%I', t || '_edita', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.es_personal()) with check (public.es_personal())', t || '_edita', t);
    execute format('drop policy if exists %I on public.%I', t || '_borra', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.es_super_administrador())', t || '_borra', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Datos iniciales (solo se agregan los que no existan)
insert into public.geo_paises (codigo, nombre, prefijo, bandera, idioma, moneda, codigo_tel) values
  ('1', 'Guatemala', 'GT', '🇬🇹', 'Español', 'GTQ', '502'),
  ('2', 'El Salvador', 'SV', '🇸🇻', 'Español', 'USD', '503'),
  ('3', 'Honduras', 'HN', '🇭🇳', 'Español', 'HNL', '504'),
  ('4', 'Nicaragua', 'NI', '🇳🇮', 'Español', 'NIO', '505'),
  ('5', 'Costa Rica', 'CR', '🇨🇷', 'Español', 'CRC', '506'),
  ('6', 'Panamá', 'PA', '🇵🇦', 'Español', 'PAB / USD', '507'),
  ('7', 'Belice', 'BZ', '🇧🇿', 'Inglés', 'BZD', '501'),
  ('8', 'México', 'MX', '🇲🇽', 'Español', 'MXN', '52'),
  ('9', 'Estados Unidos', 'US', '🇺🇸', 'Inglés', 'USD', '1')
on conflict (codigo) do nothing;
insert into public.geo_regiones (pais_id, codigo, nombre)
select p.id, r.codigo, r.nombre from public.geo_paises p, (values
  ('I', 'Región I · Metropolitana'),
  ('II', 'Región II · Norte'),
  ('III', 'Región III · Nororiental'),
  ('IV', 'Región IV · Suroriental'),
  ('V', 'Región V · Central'),
  ('VI', 'Región VI · Suroccidental'),
  ('VII', 'Región VII · Noroccidental'),
  ('VIII', 'Región VIII · Petén')
) r (codigo, nombre) where p.codigo = '1'
on conflict (pais_id, codigo) do nothing;
insert into public.geo_estados (pais_id, codigo, nombre, region_id, codigo_tel, codigo_postal)
select p.id, d.codigo, d.nombre, (select id from public.geo_regiones where pais_id = p.id and codigo = d.region), '502', d.codigo || '001'
  from public.geo_paises p, (values
  ('01', 'Guatemala', 'I'),
  ('02', 'El Progreso', 'III'),
  ('03', 'Sacatepéquez', 'V'),
  ('04', 'Chimaltenango', 'V'),
  ('05', 'Escuintla', 'V'),
  ('06', 'Santa Rosa', 'IV'),
  ('07', 'Sololá', 'VI'),
  ('08', 'Totonicapán', 'VI'),
  ('09', 'Quetzaltenango', 'VI'),
  ('10', 'Suchitepéquez', 'VI'),
  ('11', 'Retalhuleu', 'VI'),
  ('12', 'San Marcos', 'VI'),
  ('13', 'Huehuetenango', 'VII'),
  ('14', 'Quiché', 'VII'),
  ('15', 'Baja Verapaz', 'II'),
  ('16', 'Alta Verapaz', 'II'),
  ('17', 'Petén', 'VIII'),
  ('18', 'Izabal', 'III'),
  ('19', 'Zacapa', 'III'),
  ('20', 'Chiquimula', 'III'),
  ('21', 'Jalapa', 'IV'),
  ('22', 'Jutiapa', 'IV')
) d (codigo, nombre, region) where p.codigo = '1'
on conflict (pais_id, codigo) do nothing;
insert into public.geo_municipios (pais_id, estado_id, codigo, nombre, codigo_tel)
select p.id, e.id, m.codigo, m.nombre, '502'
  from public.geo_paises p join public.geo_estados e on e.pais_id = p.id, (values
  ('01', '0101', 'Guatemala'),
  ('01', '0102', 'Santa Catarina Pinula'),
  ('01', '0103', 'San José Pinula'),
  ('01', '0104', 'San José del Golfo'),
  ('01', '0105', 'Palencia'),
  ('01', '0106', 'Chinautla'),
  ('01', '0107', 'San Pedro Ayampuc'),
  ('01', '0108', 'Mixco'),
  ('01', '0109', 'San Pedro Sacatepéquez'),
  ('01', '0110', 'San Juan Sacatepéquez'),
  ('01', '0111', 'San Raymundo'),
  ('01', '0112', 'Chuarrancho'),
  ('01', '0113', 'Fraijanes'),
  ('01', '0114', 'Amatitlán'),
  ('01', '0115', 'Villa Nueva'),
  ('01', '0116', 'Villa Canales'),
  ('01', '0117', 'San Miguel Petapa'),
  ('02', '0201', 'Guastatoya'),
  ('02', '0202', 'Morazán'),
  ('02', '0203', 'San Agustín Acasaguastlán'),
  ('02', '0204', 'San Cristóbal Acasaguastlán'),
  ('02', '0205', 'El Jícaro'),
  ('02', '0206', 'Sansare'),
  ('02', '0207', 'Sanarate'),
  ('02', '0208', 'San Antonio La Paz'),
  ('03', '0301', 'Antigua Guatemala'),
  ('03', '0302', 'Jocotenango'),
  ('03', '0303', 'Pastores'),
  ('03', '0304', 'Sumpango'),
  ('03', '0305', 'Santo Domingo Xenacoj'),
  ('03', '0306', 'Santiago Sacatepéquez'),
  ('03', '0307', 'San Bartolomé Milpas Altas'),
  ('03', '0308', 'San Lucas Sacatepéquez'),
  ('03', '0309', 'Santa Lucía Milpas Altas'),
  ('03', '0310', 'Magdalena Milpas Altas'),
  ('03', '0311', 'Santa María de Jesús'),
  ('03', '0312', 'Ciudad Vieja'),
  ('03', '0313', 'San Miguel Dueñas'),
  ('03', '0314', 'Alotenango'),
  ('03', '0315', 'San Antonio Aguas Calientes'),
  ('03', '0316', 'Santa Catarina Barahona'),
  ('04', '0401', 'Chimaltenango'),
  ('04', '0402', 'San José Poaquil'),
  ('04', '0403', 'San Martín Jilotepeque'),
  ('04', '0404', 'San Juan Comalapa'),
  ('04', '0405', 'Santa Apolonia'),
  ('04', '0406', 'Tecpán Guatemala'),
  ('04', '0407', 'Patzún'),
  ('04', '0408', 'San Miguel Pochuta'),
  ('04', '0409', 'Patzicía'),
  ('04', '0410', 'Santa Cruz Balanyá'),
  ('04', '0411', 'Acatenango'),
  ('04', '0412', 'San Pedro Yepocapa'),
  ('04', '0413', 'San Andrés Itzapa'),
  ('04', '0414', 'Parramos'),
  ('04', '0415', 'Zaragoza'),
  ('04', '0416', 'El Tejar'),
  ('05', '0501', 'Escuintla'),
  ('05', '0502', 'Santa Lucía Cotzumalguapa'),
  ('05', '0503', 'La Democracia'),
  ('05', '0504', 'Siquinalá'),
  ('05', '0505', 'Masagua'),
  ('05', '0506', 'Tiquisate'),
  ('05', '0507', 'La Gomera'),
  ('05', '0508', 'Guanagazapa'),
  ('05', '0509', 'San José'),
  ('05', '0510', 'Iztapa'),
  ('05', '0511', 'Palín'),
  ('05', '0512', 'San Vicente Pacaya'),
  ('05', '0513', 'Nueva Concepción'),
  ('05', '0514', 'Sipacate'),
  ('06', '0601', 'Cuilapa'),
  ('06', '0602', 'Barberena'),
  ('06', '0603', 'Santa Rosa de Lima'),
  ('06', '0604', 'Casillas'),
  ('06', '0605', 'San Rafael Las Flores'),
  ('06', '0606', 'Oratorio'),
  ('06', '0607', 'San Juan Tecuaco'),
  ('06', '0608', 'Chiquimulilla'),
  ('06', '0609', 'Taxisco'),
  ('06', '0610', 'Santa María Ixhuatán'),
  ('06', '0611', 'Guazacapán'),
  ('06', '0612', 'Santa Cruz Naranjo'),
  ('06', '0613', 'Pueblo Nuevo Viñas'),
  ('06', '0614', 'Nueva Santa Rosa'),
  ('07', '0701', 'Sololá'),
  ('07', '0702', 'San José Chacayá'),
  ('07', '0703', 'Santa María Visitación'),
  ('07', '0704', 'Santa Lucía Utatlán'),
  ('07', '0705', 'Nahualá'),
  ('07', '0706', 'Santa Catarina Ixtahuacán'),
  ('07', '0707', 'Santa Clara La Laguna'),
  ('07', '0708', 'Concepción'),
  ('07', '0709', 'San Andrés Semetabaj'),
  ('07', '0710', 'Panajachel'),
  ('07', '0711', 'Santa Catarina Palopó'),
  ('07', '0712', 'San Antonio Palopó'),
  ('07', '0713', 'San Lucas Tolimán'),
  ('07', '0714', 'Santa Cruz La Laguna'),
  ('07', '0715', 'San Pablo La Laguna'),
  ('07', '0716', 'San Marcos La Laguna'),
  ('07', '0717', 'San Juan La Laguna'),
  ('07', '0718', 'San Pedro La Laguna'),
  ('07', '0719', 'Santiago Atitlán'),
  ('08', '0801', 'Totonicapán'),
  ('08', '0802', 'San Cristóbal Totonicapán'),
  ('08', '0803', 'San Francisco El Alto'),
  ('08', '0804', 'San Andrés Xecul'),
  ('08', '0805', 'Momostenango'),
  ('08', '0806', 'Santa María Chiquimula'),
  ('08', '0807', 'Santa Lucía La Reforma'),
  ('08', '0808', 'San Bartolo'),
  ('09', '0901', 'Quetzaltenango'),
  ('09', '0902', 'Salcajá'),
  ('09', '0903', 'Olintepeque'),
  ('09', '0904', 'San Carlos Sija'),
  ('09', '0905', 'Sibilia'),
  ('09', '0906', 'Cabricán'),
  ('09', '0907', 'Cajolá'),
  ('09', '0908', 'San Miguel Sigüilá'),
  ('09', '0909', 'San Juan Ostuncalco'),
  ('09', '0910', 'San Mateo'),
  ('09', '0911', 'Concepción Chiquirichapa'),
  ('09', '0912', 'San Martín Sacatepéquez'),
  ('09', '0913', 'Almolonga'),
  ('09', '0914', 'Cantel'),
  ('09', '0915', 'Huitán'),
  ('09', '0916', 'Zunil'),
  ('09', '0917', 'Colomba Costa Cuca'),
  ('09', '0918', 'San Francisco La Unión'),
  ('09', '0919', 'El Palmar'),
  ('09', '0920', 'Coatepeque'),
  ('09', '0921', 'Génova'),
  ('09', '0922', 'Flores Costa Cuca'),
  ('09', '0923', 'La Esperanza'),
  ('09', '0924', 'Palestina de Los Altos'),
  ('10', '1001', 'Mazatenango'),
  ('10', '1002', 'Cuyotenango'),
  ('10', '1003', 'San Francisco Zapotitlán'),
  ('10', '1004', 'San Bernardino'),
  ('10', '1005', 'San José El Ídolo'),
  ('10', '1006', 'Santo Domingo Suchitepéquez'),
  ('10', '1007', 'San Lorenzo'),
  ('10', '1008', 'Samayac'),
  ('10', '1009', 'San Pablo Jocopilas'),
  ('10', '1010', 'San Antonio Suchitepéquez'),
  ('10', '1011', 'San Miguel Panán'),
  ('10', '1012', 'San Gabriel'),
  ('10', '1013', 'Chicacao'),
  ('10', '1014', 'Patulul'),
  ('10', '1015', 'Santa Bárbara'),
  ('10', '1016', 'San Juan Bautista'),
  ('10', '1017', 'Santo Tomás La Unión'),
  ('10', '1018', 'Zunilito'),
  ('10', '1019', 'Pueblo Nuevo'),
  ('10', '1020', 'Río Bravo'),
  ('10', '1021', 'San José La Máquina'),
  ('11', '1101', 'Retalhuleu'),
  ('11', '1102', 'San Sebastián'),
  ('11', '1103', 'Santa Cruz Muluá'),
  ('11', '1104', 'San Martín Zapotitlán'),
  ('11', '1105', 'San Felipe'),
  ('11', '1106', 'San Andrés Villa Seca'),
  ('11', '1107', 'Champerico'),
  ('11', '1108', 'Nuevo San Carlos'),
  ('11', '1109', 'El Asintal'),
  ('12', '1201', 'San Marcos'),
  ('12', '1202', 'San Pedro Sacatepéquez'),
  ('12', '1203', 'San Antonio Sacatepéquez'),
  ('12', '1204', 'Comitancillo'),
  ('12', '1205', 'San Miguel Ixtahuacán'),
  ('12', '1206', 'Concepción Tutuapa'),
  ('12', '1207', 'Tacaná'),
  ('12', '1208', 'Sibinal'),
  ('12', '1209', 'Tajumulco'),
  ('12', '1210', 'Tejutla'),
  ('12', '1211', 'San Rafael Pie de la Cuesta'),
  ('12', '1212', 'Nuevo Progreso'),
  ('12', '1213', 'El Tumbador'),
  ('12', '1214', 'San José El Rodeo'),
  ('12', '1215', 'Malacatán'),
  ('12', '1216', 'Catarina'),
  ('12', '1217', 'Ayutla'),
  ('12', '1218', 'Ocós'),
  ('12', '1219', 'San Pablo'),
  ('12', '1220', 'El Quetzal'),
  ('12', '1221', 'La Reforma'),
  ('12', '1222', 'Pajapita'),
  ('12', '1223', 'Ixchiguán'),
  ('12', '1224', 'San José Ojetenam'),
  ('12', '1225', 'San Cristóbal Cucho'),
  ('12', '1226', 'Sipacapa'),
  ('12', '1227', 'Esquipulas Palo Gordo'),
  ('12', '1228', 'Río Blanco'),
  ('12', '1229', 'San Lorenzo'),
  ('12', '1230', 'La Blanca'),
  ('13', '1301', 'Huehuetenango'),
  ('13', '1302', 'Chiantla'),
  ('13', '1303', 'Malacatancito'),
  ('13', '1304', 'Cuilco'),
  ('13', '1305', 'Nentón'),
  ('13', '1306', 'San Pedro Necta'),
  ('13', '1307', 'Jacaltenango'),
  ('13', '1308', 'San Pedro Soloma'),
  ('13', '1309', 'San Ildefonso Ixtahuacán'),
  ('13', '1310', 'Santa Bárbara'),
  ('13', '1311', 'La Libertad'),
  ('13', '1312', 'La Democracia'),
  ('13', '1313', 'San Miguel Acatán'),
  ('13', '1314', 'San Rafael La Independencia'),
  ('13', '1315', 'Todos Santos Cuchumatán'),
  ('13', '1316', 'San Juan Atitán'),
  ('13', '1317', 'Santa Eulalia'),
  ('13', '1318', 'San Mateo Ixtatán'),
  ('13', '1319', 'Colotenango'),
  ('13', '1320', 'San Sebastián Huehuetenango'),
  ('13', '1321', 'Tectitán'),
  ('13', '1322', 'Concepción Huista'),
  ('13', '1323', 'San Juan Ixcoy'),
  ('13', '1324', 'San Antonio Huista'),
  ('13', '1325', 'San Sebastián Coatán'),
  ('13', '1326', 'Santa Cruz Barillas'),
  ('13', '1327', 'Aguacatán'),
  ('13', '1328', 'San Rafael Petzal'),
  ('13', '1329', 'San Gaspar Ixchil'),
  ('13', '1330', 'Santiago Chimaltenango'),
  ('13', '1331', 'Santa Ana Huista'),
  ('13', '1332', 'Unión Cantinil'),
  ('13', '1333', 'Petatán'),
  ('14', '1401', 'Santa Cruz del Quiché'),
  ('14', '1402', 'Chiché'),
  ('14', '1403', 'Chinique'),
  ('14', '1404', 'Zacualpa'),
  ('14', '1405', 'Chajul'),
  ('14', '1406', 'Chichicastenango'),
  ('14', '1407', 'Patzité'),
  ('14', '1408', 'San Antonio Ilotenango'),
  ('14', '1409', 'San Pedro Jocopilas'),
  ('14', '1410', 'Cunén'),
  ('14', '1411', 'San Juan Cotzal'),
  ('14', '1412', 'Joyabaj'),
  ('14', '1413', 'Nebaj'),
  ('14', '1414', 'San Andrés Sajcabajá'),
  ('14', '1415', 'Uspantán'),
  ('14', '1416', 'Sacapulas'),
  ('14', '1417', 'San Bartolomé Jocotenango'),
  ('14', '1418', 'Canillá'),
  ('14', '1419', 'Chicamán'),
  ('14', '1420', 'Ixcán'),
  ('14', '1421', 'Pachalum'),
  ('15', '1501', 'Salamá'),
  ('15', '1502', 'San Miguel Chicaj'),
  ('15', '1503', 'Rabinal'),
  ('15', '1504', 'Cubulco'),
  ('15', '1505', 'Granados'),
  ('15', '1506', 'Santa Cruz El Chol'),
  ('15', '1507', 'San Jerónimo'),
  ('15', '1508', 'Purulhá'),
  ('16', '1601', 'Cobán'),
  ('16', '1602', 'Santa Cruz Verapaz'),
  ('16', '1603', 'San Cristóbal Verapaz'),
  ('16', '1604', 'Tactic'),
  ('16', '1605', 'Tamahú'),
  ('16', '1606', 'San Miguel Tucurú'),
  ('16', '1607', 'Panzós'),
  ('16', '1608', 'Senahú'),
  ('16', '1609', 'San Pedro Carchá'),
  ('16', '1610', 'San Juan Chamelco'),
  ('16', '1611', 'San Agustín Lanquín'),
  ('16', '1612', 'Santa María Cahabón'),
  ('16', '1613', 'Chisec'),
  ('16', '1614', 'Chahal'),
  ('16', '1615', 'Fray Bartolomé de las Casas'),
  ('16', '1616', 'Santa Catalina La Tinta'),
  ('16', '1617', 'Raxruhá'),
  ('17', '1701', 'Flores'),
  ('17', '1702', 'San José'),
  ('17', '1703', 'San Benito'),
  ('17', '1704', 'San Andrés'),
  ('17', '1705', 'La Libertad'),
  ('17', '1706', 'San Francisco'),
  ('17', '1707', 'Santa Ana'),
  ('17', '1708', 'Dolores'),
  ('17', '1709', 'San Luis'),
  ('17', '1710', 'Sayaxché'),
  ('17', '1711', 'Melchor de Mencos'),
  ('17', '1712', 'Poptún'),
  ('17', '1713', 'Las Cruces'),
  ('17', '1714', 'El Chal'),
  ('18', '1801', 'Puerto Barrios'),
  ('18', '1802', 'Livingston'),
  ('18', '1803', 'El Estor'),
  ('18', '1804', 'Morales'),
  ('18', '1805', 'Los Amates'),
  ('19', '1901', 'Zacapa'),
  ('19', '1902', 'Estanzuela'),
  ('19', '1903', 'Río Hondo'),
  ('19', '1904', 'Gualán'),
  ('19', '1905', 'Teculután'),
  ('19', '1906', 'Usumatlán'),
  ('19', '1907', 'Cabañas'),
  ('19', '1908', 'San Diego'),
  ('19', '1909', 'La Unión'),
  ('19', '1910', 'Huité'),
  ('19', '1911', 'San Jorge'),
  ('20', '2001', 'Chiquimula'),
  ('20', '2002', 'San José La Arada'),
  ('20', '2003', 'San Juan Ermita'),
  ('20', '2004', 'Jocotán'),
  ('20', '2005', 'Camotán'),
  ('20', '2006', 'Olopa'),
  ('20', '2007', 'Esquipulas'),
  ('20', '2008', 'Concepción Las Minas'),
  ('20', '2009', 'Quezaltepeque'),
  ('20', '2010', 'San Jacinto'),
  ('20', '2011', 'Ipala'),
  ('21', '2101', 'Jalapa'),
  ('21', '2102', 'San Pedro Pinula'),
  ('21', '2103', 'San Luis Jilotepeque'),
  ('21', '2104', 'San Manuel Chaparrón'),
  ('21', '2105', 'San Carlos Alzatate'),
  ('21', '2106', 'Monjas'),
  ('21', '2107', 'Mataquescuintla'),
  ('22', '2201', 'Jutiapa'),
  ('22', '2202', 'El Progreso'),
  ('22', '2203', 'Santa Catarina Mita'),
  ('22', '2204', 'Agua Blanca'),
  ('22', '2205', 'Asunción Mita'),
  ('22', '2206', 'Yupiltepeque'),
  ('22', '2207', 'Atescatempa'),
  ('22', '2208', 'Jerez'),
  ('22', '2209', 'El Adelanto'),
  ('22', '2210', 'Zapotitlán'),
  ('22', '2211', 'Comapa'),
  ('22', '2212', 'Jalpatagua'),
  ('22', '2213', 'Conguaco'),
  ('22', '2214', 'Moyuta'),
  ('22', '2215', 'Pasaco'),
  ('22', '2216', 'San José Acatempa'),
  ('22', '2217', 'Quesada')
) m (depto, codigo, nombre) where p.codigo = '1' and e.codigo = m.depto
on conflict (estado_id, codigo) do nothing;

-- Organizaciones y localidades: código automático, estado (activo / inactivo / baja) y registro de quién graba y modifica
do $$ declare t text; begin
  foreach t in array array['organizaciones', 'org_localidades'] loop
    execute format('alter table public.%I add column if not exists estado text not null default ''activo''', t);
    execute format('alter table public.%I add column if not exists creado_por text', t);
    execute format('alter table public.%I add column if not exists modificado timestamptz', t);
    execute format('alter table public.%I add column if not exists modificado_por text', t);
    if not exists (select 1 from pg_constraint where conname = t || '_estado_valido') then
      execute format('alter table public.%I add constraint %I check (estado in (''activo'', ''inactivo'', ''baja''))', t, t || '_estado_valido');
    end if;
  end loop;
end $$;

create or replace function public.org_registro()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_usuario text := coalesce((select usuario from public.perfiles where id = auth.uid()), 'Sin usuario');
begin
  if tg_op = 'INSERT' then
    if tg_table_name = 'organizaciones' then
      perform pg_advisory_xact_lock(hashtext('organizaciones_codigo'));
      new.codigo := (select coalesce(max(codigo::int), 0) + 1 from public.organizaciones where codigo ~ '^[0-9]+$')::text;
    else
      perform pg_advisory_xact_lock(hashtext('org_localidades_codigo_' || new.organizacion_id));
      new.codigo := (select coalesce(max(codigo::int), 0) + 1 from public.org_localidades where organizacion_id = new.organizacion_id and codigo ~ '^[0-9]+$')::text;
    end if;
    new.creado := now(); new.creado_por := v_usuario; new.modificado := null; new.modificado_por := null;
  else
    new.codigo := old.codigo; new.creado := old.creado; new.creado_por := old.creado_por;
    new.modificado := now(); new.modificado_por := v_usuario;
  end if;
  return new;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'organizaciones_registro' and tgrelid = 'public.organizaciones'::regclass) then
    create trigger organizaciones_registro before insert or update on public.organizaciones for each row execute function public.org_registro();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'org_localidades_registro' and tgrelid = 'public.org_localidades'::regclass) then
    create trigger org_localidades_registro before insert or update on public.org_localidades for each row execute function public.org_registro();
  end if;
end $$;

-- ===== Sedes: Organización y Localidad / Empresa (separación por sede) =====
-- Pacientes, odontólogos, tipos de odontólogos y usuarios tienen organización y localidad. Cada usuario del personal ve solo
-- los registros de su localidad; el Super Administrador y los usuarios sin localidad asignada ven todas las sedes.
-- Los registros nuevos toman la sede del usuario que los graba. La localidad siempre corresponde a su organización.
do $$ declare t text; begin
  foreach t in array array['pacientes', 'dentistas', 'tipos_dentista', 'perfiles'] loop
    execute format('alter table public.%I add column if not exists organizacion_id bigint references public.organizaciones (id) on delete set null', t);
    execute format('alter table public.%I add column if not exists localidad_id bigint references public.org_localidades (id) on delete set null', t);
    execute format('create index if not exists %I on public.%I (localidad_id)', t || '_localidad', t);
  end loop;
end $$;

-- Localidad del usuario conectado (null = todas las sedes)
create or replace function public.mi_localidad()
returns bigint language sql stable security definer set search_path = public as $$
  select localidad_id from public.perfiles where id = auth.uid();
$$;
-- ¿El usuario conectado puede ver un registro de esta localidad?
create or replace function public.ve_sede(p_localidad bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select public.es_super_administrador() or p_localidad is null or public.mi_localidad() is null or p_localidad = public.mi_localidad();
$$;
revoke execute on function public.mi_localidad() from public, anon;
revoke execute on function public.ve_sede(bigint) from public, anon;
grant execute on function public.mi_localidad() to authenticated;
grant execute on function public.ve_sede(bigint) to authenticated;

-- Sede coherente: la organización sale de la localidad; en registros nuevos sin sede, la del usuario que graba
create or replace function public.sede_registro()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.localidad_id is null and new.organizacion_id is null and tg_table_name <> 'perfiles' then
    new.localidad_id := public.mi_localidad();
  end if;
  if new.localidad_id is not null then
    new.organizacion_id := (select organizacion_id from public.org_localidades where id = new.localidad_id);
  end if;
  return new;
end;
$$;
do $$ declare t text; begin
  foreach t in array array['pacientes', 'dentistas', 'tipos_dentista', 'perfiles'] loop
    if not exists (select 1 from pg_trigger where tgname = t || '_sede' and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger %I before insert or update of organizacion_id, localidad_id on public.%I for each row execute function public.sede_registro()', t || '_sede', t);
    end if;
  end loop;
end $$;

-- Permisos: el personal ve y edita solo su sede
drop policy if exists "personal ve pacientes" on public.pacientes;
create policy "personal ve pacientes" on public.pacientes for select using (public.es_personal() and public.ve_sede(localidad_id));
drop policy if exists "personal edita pacientes" on public.pacientes;
create policy "personal edita pacientes" on public.pacientes for update using (public.es_personal() and public.ve_sede(localidad_id)) with check (public.es_personal() and public.ve_sede(localidad_id));
drop policy if exists "personal crea pacientes" on public.pacientes;
create policy "personal crea pacientes" on public.pacientes for insert with check (public.es_personal() and public.ve_sede(localidad_id));
drop policy if exists "personal ve dentistas" on public.dentistas;
create policy "personal ve dentistas" on public.dentistas for select using (public.es_personal() and public.ve_sede(localidad_id));
drop policy if exists "personal edita dentistas" on public.dentistas;
create policy "personal edita dentistas" on public.dentistas for update using (public.es_personal() and public.ve_sede(localidad_id)) with check (public.es_personal() and public.ve_sede(localidad_id));
drop policy if exists "personal crea dentistas" on public.dentistas;
create policy "personal crea dentistas" on public.dentistas for insert with check (public.es_personal() and public.ve_sede(localidad_id));
drop policy if exists "personal administra tipos de dentista" on public.tipos_dentista;
create policy "personal administra tipos de dentista" on public.tipos_dentista for all using (public.es_personal() and public.ve_sede(localidad_id)) with check (public.es_personal() and public.ve_sede(localidad_id));

-- Datos existentes: todos a 2 · GRUPO PLUS DENTAL / localidad 2-01 (sin alterar «última modificación»)
do $$ declare v_loc bigint; begin
  select l.id into v_loc from public.org_localidades l join public.organizaciones o on o.id = l.organizacion_id where o.codigo = '2' and l.codigo = '1';
  if v_loc is null then return; end if;
  alter table public.pacientes disable trigger pacientes_actualizado;
  alter table public.pacientes disable trigger pacientes_firma;
  alter table public.dentistas disable trigger dentistas_firma;
  alter table public.tipos_dentista disable trigger tipos_dentista_auditoria;
  update public.pacientes set localidad_id = v_loc where localidad_id is null;
  update public.dentistas set localidad_id = v_loc where localidad_id is null;
  update public.tipos_dentista set localidad_id = v_loc where localidad_id is null;
  update public.perfiles set localidad_id = v_loc where localidad_id is null and rol <> 'cliente';
  alter table public.pacientes enable trigger pacientes_actualizado;
  alter table public.pacientes enable trigger pacientes_firma;
  alter table public.dentistas enable trigger dentistas_firma;
  alter table public.tipos_dentista enable trigger tipos_dentista_auditoria;
end $$;

-- ===== Sedes (2): asistentes, posiciones y clínicas, precios, paquetes y citas (agendas) =====
-- Misma regla que pacientes y odontólogos: organización + localidad, separación por sede y datos existentes a 2-01.
-- Las citas sin sede toman la del usuario que agenda, o la del odontólogo / sala (citas pedidas desde la página o el asistente).
-- Precios: un precio por procedimiento, tipo y sede (cada sede puede tener su propia lista de precios).
do $$ declare t text; begin
  foreach t in array array['personal', 'posiciones', 'precios', 'paquetes', 'citas'] loop
    execute format('alter table public.%I add column if not exists organizacion_id bigint references public.organizaciones (id) on delete set null', t);
    execute format('alter table public.%I add column if not exists localidad_id bigint references public.org_localidades (id) on delete set null', t);
    execute format('create index if not exists %I on public.%I (localidad_id)', t || '_localidad', t);
    if not exists (select 1 from pg_trigger where tgname = t || '_sede' and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger %I before insert or update of organizacion_id, localidad_id on public.%I for each row execute function public.sede_registro()', t || '_sede', t);
    end if;
  end loop;
end $$;

-- Citas: si no hay sede del usuario, la del odontólogo o la de la sala
create or replace function public.cita_sede()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.localidad_id is null then
    new.localidad_id := coalesce(public.mi_localidad(),
      (select localidad_id from public.dentistas where id = new.dentista_id),
      (select localidad_id from public.posiciones where id = new.posicion_id));
    if new.localidad_id is not null then
      new.organizacion_id := (select organizacion_id from public.org_localidades where id = new.localidad_id);
    end if;
  end if;
  return new;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'citas_sede_defecto' and tgrelid = 'public.citas'::regclass) then
    create trigger citas_sede_defecto before insert on public.citas for each row execute function public.cita_sede();
  end if;
end $$;

-- Precios: único por procedimiento, tipo y sede
drop index if exists public.precios_tratamiento_tipo;
create unique index if not exists precios_tratamiento_tipo_sede on public.precios (tratamiento_id, tipo, coalesce(localidad_id, 0));

-- Permisos por sede
drop policy if exists "personal ve el personal" on public.personal;
create policy "personal ve el personal" on public.personal for select using (public.es_personal() and public.ve_sede(localidad_id));
drop policy if exists "personal edita personal" on public.personal;
create policy "personal edita personal" on public.personal for update using (public.es_personal() and public.ve_sede(localidad_id)) with check (public.es_personal() and public.ve_sede(localidad_id));
drop policy if exists "personal agrega personal" on public.personal;
create policy "personal agrega personal" on public.personal for insert with check (public.es_personal() and public.ve_sede(localidad_id));
drop policy if exists "personal ve posiciones" on public.posiciones;
create policy "personal ve posiciones" on public.posiciones for select using (public.es_personal() and public.ve_sede(localidad_id));
drop policy if exists "personal edita posiciones" on public.posiciones;
create policy "personal edita posiciones" on public.posiciones for update using (public.es_personal() and public.ve_sede(localidad_id)) with check (public.es_personal() and public.ve_sede(localidad_id));
drop policy if exists "personal crea posiciones" on public.posiciones;
create policy "personal crea posiciones" on public.posiciones for insert with check (public.es_personal() and public.ve_sede(localidad_id));
drop policy if exists "personal ve precios" on public.precios;
create policy "personal ve precios" on public.precios for select using (public.es_personal() and public.ve_sede(localidad_id));
drop policy if exists "personal ve paquetes" on public.paquetes;
create policy "personal ve paquetes" on public.paquetes for select using (public.es_personal() and public.ve_sede(localidad_id));
drop policy if exists "personal ve citas" on public.citas;
create policy "personal ve citas" on public.citas for select using (public.es_personal() and public.ve_sede(localidad_id));
drop policy if exists "personal actualiza citas" on public.citas;
create policy "personal actualiza citas" on public.citas for update using (public.es_personal() and public.ve_sede(localidad_id)) with check (public.es_personal() and public.ve_sede(localidad_id));

-- Datos existentes a 2 · GRUPO PLUS DENTAL / 2-01 (sin alterar su registro de cambios)
do $$ declare v_loc bigint; begin
  select l.id into v_loc from public.org_localidades l join public.organizaciones o on o.id = l.organizacion_id where o.codigo = '2' and l.codigo = '1';
  if v_loc is null then return; end if;
  alter table public.personal disable trigger personal_registro;
  alter table public.posiciones disable trigger posiciones_datos_admin;
  alter table public.posiciones disable trigger posiciones_guardar;
  alter table public.precios disable trigger precios_auditoria;
  alter table public.paquetes disable trigger paquetes_auditoria;
  alter table public.citas disable trigger citas_registro;
  update public.personal set localidad_id = v_loc where localidad_id is null;
  update public.posiciones set localidad_id = v_loc where localidad_id is null;
  update public.precios set localidad_id = v_loc where localidad_id is null;
  update public.paquetes set localidad_id = v_loc where localidad_id is null;
  update public.citas set localidad_id = v_loc where localidad_id is null;
  -- Pacientes, odontólogos y tipos (por si quedó alguno sin sede)
  alter table public.pacientes disable trigger pacientes_actualizado;
  alter table public.pacientes disable trigger pacientes_firma;
  update public.pacientes set localidad_id = v_loc where localidad_id is null;
  alter table public.pacientes enable trigger pacientes_actualizado;
  alter table public.pacientes enable trigger pacientes_firma;
  alter table public.personal enable trigger personal_registro;
  alter table public.posiciones enable trigger posiciones_datos_admin;
  alter table public.posiciones enable trigger posiciones_guardar;
  alter table public.precios enable trigger precios_auditoria;
  alter table public.paquetes enable trigger paquetes_auditoria;
  alter table public.citas enable trigger citas_registro;
end $$;

-- ===== Sedes (3): la sede la decide el sistema; solo el Super Administrador la elige o la cambia =====
-- Un usuario del personal con sede asignada graba siempre en su organización y localidad, y no puede mover registros a
-- otra sede (si lo intenta, se conserva la sede que tenía). El Super Administrador puede elegir o cambiar la sede.
-- Las operaciones sin usuario conectado (página pública, asistente, tareas automáticas) siguen las reglas anteriores.
create or replace function public.sede_registro()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_mi bigint := public.mi_localidad();
  v_restringido boolean := auth.uid() is not null and not public.es_super_administrador();
begin
  if tg_table_name <> 'perfiles' then
    if tg_op = 'INSERT' then
      if v_restringido and v_mi is not null then
        new.localidad_id := v_mi;                       -- siempre su propia sede
      elsif new.localidad_id is null and new.organizacion_id is null then
        new.localidad_id := v_mi;                       -- por defecto, la sede de quien graba
      end if;
    elsif v_restringido and (new.localidad_id is distinct from old.localidad_id or new.organizacion_id is distinct from old.organizacion_id) then
      new.localidad_id := old.localidad_id;             -- solo el Super Administrador cambia la sede
      new.organizacion_id := old.organizacion_id;
      return new;
    end if;
  end if;
  if new.localidad_id is not null then
    new.organizacion_id := (select organizacion_id from public.org_localidades where id = new.localidad_id);
  end if;
  return new;
end;
$$;

-- ===== Color del odontólogo =====
-- Identifica al odontólogo, a sus pacientes y sus citas en la agenda. Formato #RRGGBB.
-- A los odontólogos existentes se les asigna un color distinto de la paleta, en orden.
alter table public.dentistas add column if not exists color text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'dentistas_color_valido') then
    alter table public.dentistas add constraint dentistas_color_valido check (color is null or color ~ '^#[0-9A-Fa-f]{6}$');
  end if;
end $$;
do $$ begin
  alter table public.dentistas disable trigger dentistas_firma;
  update public.dentistas d set color = p.color
    from (select id, (array['#2563EB','#059669','#D97706','#DC2626','#7C3AED','#DB2777','#0891B2','#65A30D','#EA580C','#4F46E5','#0D9488','#A16207'])[((row_number() over (order by id) - 1) % 12) + 1] as color
            from public.dentistas) p
   where p.id = d.id and d.color is null;
  alter table public.dentistas enable trigger dentistas_firma;
end $$;

-- ===== Inventarios (fase 1): proveedores, bodegas, productos y precios por tipo de cliente =====
-- Todo con organización y localidad (la del usuario que graba; solo el Super Administrador la cambia), separación por sede,
-- número correlativo automático y registro de quién graba y modifica (fecha y hora).
create table if not exists public.inv_proveedores (
  id                  bigint generated always as identity primary key,
  numero              int,
  padre_id            bigint references public.inv_proveedores (id) on delete cascade,   -- vacío = empresa principal; con valor = sub-empresa
  nit                 text check (char_length(nit) <= 20),
  nombre_comercial    text not null check (char_length(nombre_comercial) between 1 and 150),
  nombre_fiscal       text check (char_length(nombre_fiscal) <= 200),
  nombre_documentos   text check (char_length(nombre_documentos) <= 200),
  direccion           text check (char_length(direccion) <= 300),
  telefonos           text check (char_length(telefonos) <= 120),
  extension           text check (char_length(extension) <= 20),
  fax                 text check (char_length(fax) <= 40),
  correo              text check (char_length(correo) <= 150),
  contacto            text check (char_length(contacto) <= 120),
  banco               text check (char_length(banco) <= 80),
  cuenta_bancaria     text check (char_length(cuenta_bancaria) <= 40),
  dias_credito        int not null default 0 check (dias_credito between 0 and 365),
  efectuar_retencion  boolean not null default false,
  pendiente_revisar   boolean not null default false,
  estado              text not null default 'activo' check (estado in ('activo', 'inactivo', 'baja')),
  organizacion_id     bigint references public.organizaciones (id) on delete set null,
  localidad_id        bigint references public.org_localidades (id) on delete set null,
  creado              timestamptz not null default now(),
  creado_por          text,
  modificado          timestamptz,
  modificado_por      text
);
create index if not exists inv_proveedores_padre on public.inv_proveedores (padre_id);

create table if not exists public.inv_bodegas (
  id                     bigint generated always as identity primary key,
  numero                 int,
  nombre                 text not null check (char_length(nombre) between 1 and 120),
  tipo                   text not null default 'general' check (tipo in ('general', 'sub')),
  bodega_mayor_id        bigint references public.inv_bodegas (id) on delete set null,
  siglas                 text check (char_length(siglas) <= 10),
  direccion              text check (char_length(direccion) <= 300),
  encargado              text check (char_length(encargado) <= 120),
  permite_carga_directa  boolean not null default true,
  consignacion           boolean not null default false,
  tipo_precio            text not null default 'directo' check (tipo_precio in ('directo', 'institucional', 'vip', 'referido', 'paquete', 'especial')),
  estado                 text not null default 'activo' check (estado in ('activo', 'inactivo', 'baja')),
  organizacion_id        bigint references public.organizaciones (id) on delete set null,
  localidad_id           bigint references public.org_localidades (id) on delete set null,
  creado                 timestamptz not null default now(),
  creado_por             text,
  modificado             timestamptz,
  modificado_por         text
);

create table if not exists public.inv_productos (
  id                bigint generated always as identity primary key,
  numero            int,
  codigo            text check (char_length(codigo) <= 40),
  nombre            text not null check (char_length(nombre) between 1 and 200),
  clasificacion     text check (char_length(clasificacion) <= 80),
  tipo_producto     text check (char_length(tipo_producto) <= 80),
  principio_activo  text check (char_length(principio_activo) <= 150),
  marca             text check (char_length(marca) <= 80),
  codigo_barras     text check (char_length(codigo_barras) <= 60),
  presentacion      text check (char_length(presentacion) <= 80),
  unidad            text check (char_length(unidad) <= 40),
  proveedor_id      bigint references public.inv_proveedores (id) on delete set null,
  bodega_id         bigint references public.inv_bodegas (id) on delete set null,
  generico          boolean not null default false,
  control_minimo    boolean not null default false,
  minimo            numeric(12,2) check (minimo >= 0),
  maximo            numeric(12,2) check (maximo >= 0),
  costo             numeric(12,2) check (costo >= 0),
  estante           text check (char_length(estante) <= 20),
  fila              text check (char_length(fila) <= 20),
  bloque            text check (char_length(bloque) <= 20),
  foto              text,
  estado            text not null default 'activo' check (estado in ('activo', 'inactivo', 'baja')),
  organizacion_id   bigint references public.organizaciones (id) on delete set null,
  localidad_id      bigint references public.org_localidades (id) on delete set null,
  creado            timestamptz not null default now(),
  creado_por        text,
  modificado        timestamptz,
  modificado_por    text
);
create unique index if not exists inv_productos_codigo_sede on public.inv_productos (lower(codigo), coalesce(localidad_id, 0)) where codigo is not null;

-- Otros proveedores del producto
create table if not exists public.inv_producto_proveedores (
  producto_id   bigint not null references public.inv_productos (id) on delete cascade,
  proveedor_id  bigint not null references public.inv_proveedores (id) on delete cascade,
  primary key (producto_id, proveedor_id)
);

-- Precios por tipo de cliente (como los de procedimientos): uno por producto, tipo y sede
create table if not exists public.inv_precios (
  id               bigint generated always as identity primary key,
  producto_id      bigint not null references public.inv_productos (id) on delete cascade,
  tipo             text not null check (tipo in ('directo', 'institucional', 'vip', 'referido', 'paquete', 'especial')),
  fecha            date not null default current_date,
  vigente          boolean not null default true,
  precio           numeric(12,2) not null check (precio >= 0),
  precio_usd       numeric(12,2) check (precio_usd >= 0),
  pct_utilidad     numeric(6,2) check (pct_utilidad between 0 and 1000),
  pct_descuento    numeric(5,2) not null default 0 check (pct_descuento between 0 and 100),
  organizacion_id  bigint references public.organizaciones (id) on delete set null,
  localidad_id     bigint references public.org_localidades (id) on delete set null,
  creado           timestamptz not null default now(),
  creado_por       text,
  modificado       timestamptz,
  modificado_por   text
);
create unique index if not exists inv_precios_producto_tipo_sede on public.inv_precios (producto_id, tipo, coalesce(localidad_id, 0));

-- Registro automático: número correlativo (si la tabla lo tiene), quién graba y quién modifica
create or replace function public.inv_registro()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_usuario text := coalesce((select usuario from public.perfiles where id = auth.uid()), 'Sin usuario');
begin
  if tg_op = 'INSERT' then
    if tg_table_name in ('inv_proveedores', 'inv_bodegas', 'inv_productos') then
      perform pg_advisory_xact_lock(hashtext(tg_table_name || '_numero'));
      execute format('select coalesce(max(numero), 0) + 1 from public.%I', tg_table_name) into new.numero;
    end if;
    new.creado := now(); new.creado_por := v_usuario; new.modificado := null; new.modificado_por := null;
  else
    if tg_table_name in ('inv_proveedores', 'inv_bodegas', 'inv_productos') then new.numero := old.numero; end if;
    new.creado := old.creado; new.creado_por := old.creado_por;
    new.modificado := now(); new.modificado_por := v_usuario;
  end if;
  return new;
end;
$$;

do $$ declare t text; begin
  foreach t in array array['inv_proveedores', 'inv_bodegas', 'inv_productos', 'inv_precios'] loop
    if not exists (select 1 from pg_trigger where tgname = t || '_registro' and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger %I before insert or update on public.%I for each row execute function public.inv_registro()', t || '_registro', t);
    end if;
    if not exists (select 1 from pg_trigger where tgname = t || '_sede' and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger %I before insert or update of organizacion_id, localidad_id on public.%I for each row execute function public.sede_registro()', t || '_sede', t);
    end if;
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_lee', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.es_personal() and public.ve_sede(localidad_id))', t || '_lee', t);
    execute format('drop policy if exists %I on public.%I', t || '_crea', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.es_personal() and public.ve_sede(localidad_id))', t || '_crea', t);
    execute format('drop policy if exists %I on public.%I', t || '_edita', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.es_personal() and public.ve_sede(localidad_id)) with check (public.es_personal() and public.ve_sede(localidad_id))', t || '_edita', t);
    execute format('drop policy if exists %I on public.%I', t || '_borra', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.es_super_administrador())', t || '_borra', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
alter table public.inv_producto_proveedores enable row level security;
drop policy if exists inv_producto_proveedores_personal on public.inv_producto_proveedores;
create policy inv_producto_proveedores_personal on public.inv_producto_proveedores for all to authenticated using (public.es_personal()) with check (public.es_personal());
grant select, insert, update, delete on public.inv_producto_proveedores to authenticated;

-- Bodega general inicial de cada localidad existente
insert into public.inv_bodegas (nombre, tipo, siglas, direccion, encargado, localidad_id, organizacion_id)
select 'Bodega general ' || coalesce(l.nombre_comercial, l.razon_social), 'general', 'GEN', l.direccion, null, l.id, l.organizacion_id
  from public.org_localidades l
 where not exists (select 1 from public.inv_bodegas b where b.localidad_id = l.id);

-- ===== Inventarios: Tipos de producto (medicamentos dentales en Guatemala) =====
-- Catálogo para clasificar los productos (campo «Tipo de producto»). Con número correlativo, sede, estado y registro.
-- Datos iniciales: tipos de medicamentos de uso odontológico disponibles en Guatemala, en la sede 2-01 (Plus Dental).
create table if not exists public.inv_tipos_producto (
  id               bigint generated always as identity primary key,
  numero           int,
  nombre           text not null check (char_length(nombre) between 1 and 100),
  descripcion      text check (char_length(descripcion) <= 400),
  ejemplos         text check (char_length(ejemplos) <= 400),
  requiere_receta  boolean not null default false,
  estado           text not null default 'activo' check (estado in ('activo', 'inactivo', 'baja')),
  organizacion_id  bigint references public.organizaciones (id) on delete set null,
  localidad_id     bigint references public.org_localidades (id) on delete set null,
  creado           timestamptz not null default now(),
  creado_por       text,
  modificado       timestamptz,
  modificado_por   text
);
create unique index if not exists inv_tipos_producto_nombre_sede on public.inv_tipos_producto (lower(nombre), coalesce(localidad_id, 0));

-- El registro automático también numera este catálogo
create or replace function public.inv_registro()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_usuario text := coalesce((select usuario from public.perfiles where id = auth.uid()), 'Sin usuario');
begin
  if tg_op = 'INSERT' then
    if tg_table_name in ('inv_proveedores', 'inv_bodegas', 'inv_productos', 'inv_tipos_producto') then
      perform pg_advisory_xact_lock(hashtext(tg_table_name || '_numero'));
      execute format('select coalesce(max(numero), 0) + 1 from public.%I', tg_table_name) into new.numero;
    end if;
    new.creado := now(); new.creado_por := v_usuario; new.modificado := null; new.modificado_por := null;
  else
    if tg_table_name in ('inv_proveedores', 'inv_bodegas', 'inv_productos', 'inv_tipos_producto') then new.numero := old.numero; end if;
    new.creado := old.creado; new.creado_por := old.creado_por;
    new.modificado := now(); new.modificado_por := v_usuario;
  end if;
  return new;
end;
$$;

do $$ declare t text := 'inv_tipos_producto'; begin
  if not exists (select 1 from pg_trigger where tgname = t || '_registro' and tgrelid = ('public.' || t)::regclass) then
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.inv_registro()', t || '_registro', t);
  end if;
  if not exists (select 1 from pg_trigger where tgname = t || '_sede' and tgrelid = ('public.' || t)::regclass) then
    execute format('create trigger %I before insert or update of organizacion_id, localidad_id on public.%I for each row execute function public.sede_registro()', t || '_sede', t);
  end if;
  execute format('alter table public.%I enable row level security', t);
  execute format('drop policy if exists %I on public.%I', t || '_lee', t);
  execute format('create policy %I on public.%I for select to authenticated using (public.es_personal() and public.ve_sede(localidad_id))', t || '_lee', t);
  execute format('drop policy if exists %I on public.%I', t || '_crea', t);
  execute format('create policy %I on public.%I for insert to authenticated with check (public.es_personal() and public.ve_sede(localidad_id))', t || '_crea', t);
  execute format('drop policy if exists %I on public.%I', t || '_edita', t);
  execute format('create policy %I on public.%I for update to authenticated using (public.es_personal() and public.ve_sede(localidad_id)) with check (public.es_personal() and public.ve_sede(localidad_id))', t || '_edita', t);
  execute format('drop policy if exists %I on public.%I', t || '_borra', t);
  execute format('create policy %I on public.%I for delete to authenticated using (public.es_super_administrador())', t || '_borra', t);
  execute format('grant select, insert, update, delete on public.%I to authenticated', t);
end $$;

-- Datos iniciales (solo los que falten), en la sede 2-01
insert into public.inv_tipos_producto (nombre, descripcion, ejemplos, requiere_receta, localidad_id, organizacion_id)
select x.nombre, x.descripcion, x.ejemplos, x.receta, l.id, l.organizacion_id
  from (values
  ('Anestésicos locales', 'Bloqueo de la sensibilidad para procedimientos dentales (infiltrativa y troncular).', 'Lidocaína 2% con epinefrina, Mepivacaína 3%, Articaína 4% con epinefrina, Prilocaína 3% con felipresina', true),
  ('Anestésicos tópicos', 'Anestesia superficial de mucosa antes de la punción o en procedimientos menores.', 'Benzocaína 20% gel, Lidocaína 10% spray, Lidocaína 2% gel', false),
  ('Antibióticos', 'Tratamiento y profilaxis de infecciones odontogénicas.', 'Amoxicilina, Amoxicilina con ácido clavulánico, Clindamicina, Azitromicina, Metronidazol, Cefalexina', true),
  ('Analgésicos', 'Control del dolor posoperatorio y de origen dental.', 'Acetaminofén (paracetamol), Tramadol, Acetaminofén con codeína', false),
  ('Antiinflamatorios no esteroideos (AINE)', 'Dolor e inflamación posteriores a extracciones, endodoncias y cirugías.', 'Ibuprofeno, Naproxeno, Diclofenaco, Ketorolaco, Nimesulida, Celecoxib', false),
  ('Corticoesteroides', 'Control del edema e inflamación severa posquirúrgica; lesiones de mucosa.', 'Dexametasona, Betametasona, Prednisona, Triamcinolona en orabase', true),
  ('Antisépticos bucales', 'Control de placa bacteriana y desinfección de la cavidad oral.', 'Clorhexidina 0.12%, Cloruro de cetilpiridinio, Peróxido de hidrógeno, Iodopovidona', false),
  ('Antifúngicos', 'Tratamiento de candidiasis oral y estomatitis protésica.', 'Nistatina suspensión, Miconazol gel oral, Fluconazol, Clotrimazol', true),
  ('Antivirales', 'Herpes labial y lesiones herpéticas de la mucosa oral.', 'Aciclovir crema y tabletas, Valaciclovir', true),
  ('Hemostáticos', 'Control del sangrado durante y después de extracciones y cirugías.', 'Esponja de gelatina (Gelfoam), Celulosa oxidada (Surgicel), Ácido tranexámico, Sulfato férrico, Cloruro de aluminio', false),
  ('Fluoruros y remineralizantes', 'Prevención de caries y remineralización del esmalte.', 'Barniz de flúor 5%, Flúor gel 1.23% (APF), Fluoruro de sodio en enjuague, CPP-ACP (MI Paste)', false),
  ('Desensibilizantes', 'Tratamiento de la hipersensibilidad dentinaria.', 'Nitrato de potasio, Barniz desensibilizante, Gluma, Fluoruro de estaño', false),
  ('Medicación intraconducto y endodóntica', 'Irrigación, desinfección y medicación entre citas en endodoncia.', 'Hidróxido de calcio, Hipoclorito de sodio, EDTA 17%, Paramonoclorofenol alcanforado, Formocresol', false),
  ('Ansiolíticos y sedantes', 'Manejo de la ansiedad del paciente antes del procedimiento.', 'Diazepam, Midazolam, Alprazolam', true),
  ('Relajantes musculares', 'Trismus, bruxismo y dolor muscular de la articulación temporomandibular.', 'Ciclobenzaprina, Orfenadrina, Metocarbamol', true),
  ('Antihistamínicos', 'Reacciones alérgicas leves y premedicación.', 'Loratadina, Cetirizina, Difenhidramina, Clorfeniramina', false),
  ('Cicatrizantes y protectores de mucosa', 'Aftas, úlceras traumáticas, alveolitis y heridas de la mucosa.', 'Ácido hialurónico gel, Alvogyl, Bencidamina, Sucralfato en suspensión', false),
  ('Saliva artificial y lubricantes orales', 'Xerostomía (boca seca) por medicamentos o radioterapia.', 'Saliva artificial en spray y gel, Pilocarpina', false),
  ('Vitaminas y suplementos', 'Apoyo a la cicatrización y deficiencias que afectan la salud oral.', 'Complejo B, Vitamina C, Ácido fólico, Zinc', false),
  ('Medicamentos de emergencia', 'Botiquín de emergencias médicas en el consultorio dental.', 'Epinefrina 1:1000, Nitroglicerina sublingual, Salbutamol inhalador, Glucosa oral, Oxígeno', true)
  ) x (nombre, descripcion, ejemplos, receta)
  cross join (select l.id, l.organizacion_id from public.org_localidades l join public.organizaciones o on o.id = l.organizacion_id where o.codigo = '2' and l.codigo = '1') l
 where not exists (select 1 from public.inv_tipos_producto t where lower(t.nombre) = lower(x.nombre) and t.localidad_id = l.id);

-- ===== Inventarios (fase 2): compras, movimiento kardex y despacho por ventas =====
-- Compras: ingresan productos a una bodega (entrada en el kardex) y actualizan el último costo del producto.
-- Ventas: una línea de Cobros y pagos puede ser un procedimiento o un producto; el producto sale de la bodega
-- general de la sede (salida en el kardex). Si falta existencia se avisa en pantalla pero se permite registrar.
-- Al anular una compra o un pago, el kardex registra el movimiento contrario. Todo con sede, número y registro.
create table if not exists public.inv_compras (
  id                bigint generated always as identity primary key,
  numero            int,
  proveedor_id      bigint references public.inv_proveedores (id) on delete set null,
  bodega_id         bigint not null references public.inv_bodegas (id),
  fecha             date not null default current_date,
  tipo_documento    text not null default 'factura' check (tipo_documento in ('factura', 'recibo', 'nota_envio', 'otro')),
  serie             text check (char_length(serie) <= 20),
  numero_documento  text check (char_length(numero_documento) <= 40),
  dias_credito      int not null default 0 check (dias_credito between 0 and 365),
  observaciones     text check (char_length(observaciones) <= 500),
  total             numeric(12,2) not null default 0 check (total >= 0),
  estado            text not null default 'registrada' check (estado in ('registrada', 'anulada')),
  anulado_motivo    text check (char_length(anulado_motivo) <= 300),
  anulado_en        timestamptz,
  anulado_por       text,
  organizacion_id   bigint references public.organizaciones (id) on delete set null,
  localidad_id      bigint references public.org_localidades (id) on delete set null,
  creado            timestamptz not null default now(),
  creado_por        text,
  modificado        timestamptz,
  modificado_por    text
);

create table if not exists public.inv_compra_items (
  id              bigint generated always as identity primary key,
  compra_id       bigint not null references public.inv_compras (id) on delete cascade,
  linea           int not null check (linea >= 1),
  producto_id     bigint not null references public.inv_productos (id),
  cantidad        numeric(12,2) not null check (cantidad > 0),
  costo_unitario  numeric(12,4) not null default 0 check (costo_unitario >= 0),
  subtotal        numeric(12,2) not null default 0 check (subtotal >= 0),
  lote            text check (char_length(lote) <= 40),
  vencimiento     date
);
create unique index if not exists inv_compra_items_linea on public.inv_compra_items (compra_id, linea);

-- Kardex: cada entrada o salida de un producto en una bodega
create table if not exists public.inv_movimientos (
  id               bigint generated always as identity primary key,
  fecha            timestamptz not null default now(),
  producto_id      bigint not null references public.inv_productos (id),
  bodega_id        bigint not null references public.inv_bodegas (id),
  tipo             text not null check (tipo in ('entrada', 'salida')),
  origen           text not null check (origen in ('compra', 'venta', 'ajuste', 'anulacion_compra', 'anulacion_venta')),
  compra_id        bigint references public.inv_compras (id) on delete set null,
  pago_id          bigint references public.pagos (id) on delete set null,
  documento        text check (char_length(documento) <= 120),
  cantidad         numeric(12,2) not null check (cantidad > 0),
  costo_unitario   numeric(12,4) not null default 0 check (costo_unitario >= 0),
  observaciones    text check (char_length(observaciones) <= 300),
  usuario          text,
  organizacion_id  bigint references public.organizaciones (id) on delete set null,
  localidad_id     bigint references public.org_localidades (id) on delete set null
);
create index if not exists inv_movimientos_producto on public.inv_movimientos (producto_id, bodega_id, fecha, id);
create index if not exists inv_movimientos_pago on public.inv_movimientos (pago_id) where pago_id is not null;

-- Línea de cobro con producto: cantidad y bodega de donde sale
alter table public.pago_detalle add column if not exists producto_id bigint references public.inv_productos (id) on delete set null;
alter table public.pago_detalle add column if not exists cantidad numeric(12,2) check (cantidad > 0);
alter table public.pago_detalle add column if not exists bodega_id bigint references public.inv_bodegas (id) on delete set null;

-- El registro automático también numera las compras
create or replace function public.inv_registro()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_usuario text := coalesce((select usuario from public.perfiles where id = auth.uid()), 'Sin usuario');
begin
  if tg_op = 'INSERT' then
    if tg_table_name in ('inv_proveedores', 'inv_bodegas', 'inv_productos', 'inv_tipos_producto', 'inv_compras') then
      perform pg_advisory_xact_lock(hashtext(tg_table_name || '_numero'));
      execute format('select coalesce(max(numero), 0) + 1 from public.%I', tg_table_name) into new.numero;
    end if;
    new.creado := now(); new.creado_por := v_usuario; new.modificado := null; new.modificado_por := null;
  else
    if tg_table_name in ('inv_proveedores', 'inv_bodegas', 'inv_productos', 'inv_tipos_producto', 'inv_compras') then new.numero := old.numero; end if;
    new.creado := old.creado; new.creado_por := old.creado_por;
    new.modificado := now(); new.modificado_por := v_usuario;
  end if;
  return new;
end;
$$;

do $$ declare t text := 'inv_compras'; begin
  if not exists (select 1 from pg_trigger where tgname = t || '_registro' and tgrelid = ('public.' || t)::regclass) then
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.inv_registro()', t || '_registro', t);
  end if;
  if not exists (select 1 from pg_trigger where tgname = t || '_sede' and tgrelid = ('public.' || t)::regclass) then
    execute format('create trigger %I before insert or update of organizacion_id, localidad_id on public.%I for each row execute function public.sede_registro()', t || '_sede', t);
  end if;
end $$;

-- Lectura para el personal de su sede; compras, ventas y ajustes se graban solo con las funciones de abajo
alter table public.inv_compras enable row level security;
drop policy if exists inv_compras_lee on public.inv_compras;
create policy inv_compras_lee on public.inv_compras for select to authenticated using (public.es_personal() and public.ve_sede(localidad_id));
grant select on public.inv_compras to authenticated;
alter table public.inv_compra_items enable row level security;
drop policy if exists inv_compra_items_lee on public.inv_compra_items;
create policy inv_compra_items_lee on public.inv_compra_items for select to authenticated
  using (public.es_personal() and exists (select 1 from public.inv_compras c where c.id = compra_id and public.ve_sede(c.localidad_id)));
grant select on public.inv_compra_items to authenticated;
alter table public.inv_movimientos enable row level security;
drop policy if exists inv_movimientos_lee on public.inv_movimientos;
create policy inv_movimientos_lee on public.inv_movimientos for select to authenticated using (public.es_personal() and public.ve_sede(localidad_id));
grant select on public.inv_movimientos to authenticated;

-- Existencia por producto y bodega
create or replace view public.inv_existencias with (security_invoker = true) as
  select producto_id, bodega_id, localidad_id,
         sum(case when tipo = 'entrada' then cantidad else -cantidad end) as existencia,
         max(fecha) as ultimo_movimiento
    from public.inv_movimientos
   group by producto_id, bodega_id, localidad_id;
grant select on public.inv_existencias to authenticated;

-- Kardex con saldo acumulado por producto y bodega
create or replace view public.inv_kardex with (security_invoker = true) as
  select m.*,
         case when m.tipo = 'entrada' then m.cantidad else 0 end as entrada,
         case when m.tipo = 'salida' then m.cantidad else 0 end as salida,
         sum(case when m.tipo = 'entrada' then m.cantidad else -m.cantidad end)
           over (partition by m.producto_id, m.bodega_id order by m.fecha, m.id) as saldo
    from public.inv_movimientos m;
grant select on public.inv_kardex to authenticated;

-- Bodega general de la sede del usuario (o la primera general visible)
create or replace function public.inv_bodega_general(p_localidad bigint default null)
returns bigint language sql stable security definer set search_path = public as $$
  select id from public.inv_bodegas
   where tipo = 'general' and estado = 'activo' and localidad_id is not distinct from coalesce(p_localidad, public.mi_localidad(), localidad_id)
   order by numero limit 1;
$$;
revoke execute on function public.inv_bodega_general(bigint) from public, anon;
grant execute on function public.inv_bodega_general(bigint) to authenticated;

-- Registrar una compra con sus productos: crea la entrada al kardex y actualiza el último costo
create or replace function public.registrar_compra(p_datos jsonb, p_items jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
  v_bodega public.inv_bodegas;
  v_doc text;
  v_usuario text := (select usuario from public.perfiles where id = auth.uid());
  v_total numeric := 0;
  e jsonb;
  n int := 0;
  v_cant numeric; v_costo numeric;
begin
  if not public.es_personal() then raise exception 'No tienes permiso para esta acción'; end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then raise exception 'Agrega al menos un producto a la compra'; end if;
  select * into v_bodega from public.inv_bodegas where id = nullif(p_datos ->> 'bodega_id', '')::bigint;
  if v_bodega.id is null or not public.ve_sede(v_bodega.localidad_id) then raise exception 'Elige una bodega de tu sede'; end if;
  insert into public.inv_compras (proveedor_id, bodega_id, fecha, tipo_documento, serie, numero_documento, dias_credito, observaciones, localidad_id, organizacion_id)
  values (nullif(p_datos ->> 'proveedor_id', '')::bigint, v_bodega.id, coalesce(nullif(p_datos ->> 'fecha', '')::date, current_date),
          coalesce(nullif(p_datos ->> 'tipo_documento', ''), 'factura'), nullif(trim(p_datos ->> 'serie'), ''), nullif(trim(p_datos ->> 'numero_documento'), ''),
          coalesce(nullif(p_datos ->> 'dias_credito', '')::int, 0), nullif(trim(p_datos ->> 'observaciones'), ''), v_bodega.localidad_id, v_bodega.organizacion_id)
  returning id into v_id;
  select 'Compra N.º ' || numero || coalesce(' · ' || nullif(concat_ws(' ', serie, numero_documento), ''), '') into v_doc from public.inv_compras where id = v_id;
  for e in select * from jsonb_array_elements(p_items) loop
    v_cant := coalesce(nullif(e ->> 'cantidad', '')::numeric, 0);
    v_costo := greatest(coalesce(nullif(e ->> 'costo_unitario', '')::numeric, 0), 0);
    if v_cant <= 0 then raise exception 'La cantidad de cada producto debe ser mayor que cero'; end if;
    if not exists (select 1 from public.inv_productos where id = (e ->> 'producto_id')::bigint) then raise exception 'Producto no válido en la línea %', n + 1; end if;
    n := n + 1;
    insert into public.inv_compra_items (compra_id, linea, producto_id, cantidad, costo_unitario, subtotal, lote, vencimiento)
    values (v_id, n, (e ->> 'producto_id')::bigint, v_cant, v_costo, round(v_cant * v_costo, 2), nullif(trim(e ->> 'lote'), ''), nullif(e ->> 'vencimiento', '')::date);
    insert into public.inv_movimientos (fecha, producto_id, bodega_id, tipo, origen, compra_id, documento, cantidad, costo_unitario, usuario, localidad_id, organizacion_id)
    values (now(), (e ->> 'producto_id')::bigint, v_bodega.id, 'entrada', 'compra', v_id, v_doc, v_cant, v_costo, v_usuario, v_bodega.localidad_id, v_bodega.organizacion_id);
    if v_costo > 0 then update public.inv_productos set costo = round(v_costo, 2) where id = (e ->> 'producto_id')::bigint; end if;
    v_total := v_total + round(v_cant * v_costo, 2);
  end loop;
  update public.inv_compras set total = v_total where id = v_id;
  return v_id;
end;
$$;
revoke execute on function public.registrar_compra(jsonb, jsonb) from public, anon;
grant execute on function public.registrar_compra(jsonb, jsonb) to authenticated;

-- Anular una compra (Super Administrador): saca del kardex lo que había ingresado
create or replace function public.anular_compra(p_id bigint, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_usuario text := (select usuario from public.perfiles where id = auth.uid());
begin
  if not public.es_super_administrador() then raise exception 'Solo el Super Administrador puede anular compras'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Escribe el motivo de la anulación'; end if;
  update public.inv_compras set estado = 'anulada', anulado_motivo = trim(p_motivo), anulado_en = now(), anulado_por = v_usuario
   where id = p_id and estado = 'registrada';
  if not found then raise exception 'La compra no existe o ya estaba anulada'; end if;
  insert into public.inv_movimientos (fecha, producto_id, bodega_id, tipo, origen, compra_id, documento, cantidad, costo_unitario, observaciones, usuario, localidad_id, organizacion_id)
  select now(), producto_id, bodega_id, 'salida', 'anulacion_compra', compra_id, 'Anulación · ' || documento, cantidad, costo_unitario, trim(p_motivo), v_usuario, localidad_id, organizacion_id
    from public.inv_movimientos where compra_id = p_id and origen = 'compra';
end;
$$;
revoke execute on function public.anular_compra(bigint, text) from public, anon;
grant execute on function public.anular_compra(bigint, text) to authenticated;

-- Ajuste de inventario (inventario inicial, conteo físico, vencidos, merma): entrada o salida con motivo
create or replace function public.registrar_ajuste_inventario(p_producto bigint, p_bodega bigint, p_tipo text, p_cantidad numeric, p_motivo text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_bodega public.inv_bodegas; v_id bigint;
begin
  if not public.es_personal() then raise exception 'No tienes permiso para esta acción'; end if;
  if p_tipo not in ('entrada', 'salida') then raise exception 'El ajuste debe ser entrada o salida'; end if;
  if coalesce(p_cantidad, 0) <= 0 then raise exception 'La cantidad debe ser mayor que cero'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Escribe el motivo del ajuste'; end if;
  select * into v_bodega from public.inv_bodegas where id = p_bodega;
  if v_bodega.id is null or not public.ve_sede(v_bodega.localidad_id) then raise exception 'Elige una bodega de tu sede'; end if;
  insert into public.inv_movimientos (fecha, producto_id, bodega_id, tipo, origen, documento, cantidad, costo_unitario, observaciones, usuario, localidad_id, organizacion_id)
  values (now(), p_producto, v_bodega.id, p_tipo, 'ajuste', 'Ajuste de inventario', p_cantidad,
          coalesce((select costo from public.inv_productos where id = p_producto), 0), trim(p_motivo),
          (select usuario from public.perfiles where id = auth.uid()), v_bodega.localidad_id, v_bodega.organizacion_id)
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.registrar_ajuste_inventario(bigint, bigint, text, numeric, text) from public, anon;
grant execute on function public.registrar_ajuste_inventario(bigint, bigint, text, numeric, text) to authenticated;

-- Registra el pago y su detalle en un solo paso. Los montos del pago son la suma de las líneas.
-- Cada línea es un tipo de procedimiento o un producto (con cantidad); el producto sale de la bodega indicada
-- o de la bodega general de la sede.
create or replace function public.registrar_pago(p_datos jsonb, p_lineas jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
  v_q numeric := 0;
  v_usd numeric := 0;
  v_estado text := coalesce(nullif(p_datos ->> 'estado_doc', ''), 'emitido');
  v_usuario text := (select usuario from public.perfiles where id = auth.uid());
  v_doc text;
  v_bodega public.inv_bodegas;
  v_prod bigint; v_cant numeric;
  e jsonb;
  n int := 0;
begin
  if not public.es_personal() then
    raise exception 'No tienes permiso para esta acción';
  end if;
  if jsonb_array_length(coalesce(p_lineas, '[]'::jsonb)) = 0 then
    raise exception 'Agrega al menos una línea al detalle del pago';
  end if;
  if v_estado not in ('emitido', 'aplicado', 'certificado') then
    raise exception 'Un pago nuevo no puede registrarse como anulado';
  end if;
  select coalesce(sum(greatest(coalesce((l ->> 'monto')::numeric, 0), 0)), 0),
         coalesce(sum(greatest(coalesce((l ->> 'monto_usd')::numeric, 0), 0)), 0)
    into v_q, v_usd
    from jsonb_array_elements(p_lineas) l;
  if v_q <= 0 then
    raise exception 'El total en quetzales del detalle debe ser mayor que cero';
  end if;
  insert into public.pagos (paciente_id, presupuesto_id, fecha, monto, monto_usd, metodo, referencia, concepto,
                            nit, tipo_documento, serie, numero_factura, numero_dte, numero_cuota, estado_doc, observaciones)
  values ((p_datos ->> 'paciente_id')::bigint, nullif(p_datos ->> 'presupuesto_id', '')::bigint,
          coalesce(nullif(p_datos ->> 'fecha', '')::date, current_date), round(v_q, 2), round(v_usd, 2),
          (p_datos ->> 'metodo')::public.metodo_pago, nullif(trim(p_datos ->> 'referencia'), ''), nullif(trim(p_datos ->> 'concepto'), ''),
          nullif(trim(p_datos ->> 'nit'), ''), coalesce(nullif(p_datos ->> 'tipo_documento', ''), 'recibo'), nullif(trim(p_datos ->> 'serie'), ''),
          nullif(trim(p_datos ->> 'numero_factura'), ''), nullif(trim(p_datos ->> 'numero_dte'), ''),
          nullif(p_datos ->> 'numero_cuota', '')::int, v_estado, nullif(trim(p_datos ->> 'observaciones'), ''))
  returning id into v_id;
  select case when tipo_documento = 'factura' and numero_factura is not null then 'Factura ' || concat_ws('-', serie, numero_factura)
              else 'Recibo ' || coalesce(correlativo, id::text) end
    into v_doc from public.pagos where id = v_id;
  for e in select * from jsonb_array_elements(p_lineas) loop
    n := n + 1;
    v_prod := nullif(e ->> 'producto_id', '')::bigint;
    v_cant := case when v_prod is null then null else coalesce(nullif(e ->> 'cantidad', '')::numeric, 1) end;
    if v_prod is null and nullif(e ->> 'tipo_procedimiento_id', '') is null then
      raise exception 'Elige el procedimiento o el producto de la línea %', n;
    end if;
    v_bodega := null;
    if v_prod is not null then
      if v_cant <= 0 then raise exception 'La cantidad del producto de la línea % debe ser mayor que cero', n; end if;
      select * into v_bodega from public.inv_bodegas where id = coalesce(nullif(e ->> 'bodega_id', '')::bigint, public.inv_bodega_general());
      if v_bodega.id is null or not public.ve_sede(v_bodega.localidad_id) then
        raise exception 'No hay una bodega general activa en tu sede para despachar el producto de la línea %', n;
      end if;
    end if;
    insert into public.pago_detalle (pago_id, linea, tipo_procedimiento_id, producto_id, cantidad, bodega_id, clasificacion, monto, monto_usd)
    values (v_id, n, case when v_prod is null then nullif(e ->> 'tipo_procedimiento_id', '')::bigint end, v_prod, v_cant, v_bodega.id,
            coalesce(nullif(e ->> 'clasificacion', ''), 'bien'),
            round(greatest(coalesce((e ->> 'monto')::numeric, 0), 0), 2), round(greatest(coalesce((e ->> 'monto_usd')::numeric, 0), 0), 2));
    if v_prod is not null then
      insert into public.inv_movimientos (fecha, producto_id, bodega_id, tipo, origen, pago_id, documento, cantidad, costo_unitario, usuario, localidad_id, organizacion_id)
      values (now(), v_prod, v_bodega.id, 'salida', 'venta', v_id, v_doc, v_cant,
              coalesce((select costo from public.inv_productos where id = v_prod), 0), v_usuario, v_bodega.localidad_id, v_bodega.organizacion_id);
    end if;
  end loop;
  return v_id;
end;
$$;
revoke execute on function public.registrar_pago(jsonb, jsonb) from public, anon;
grant execute on function public.registrar_pago(jsonb, jsonb) to authenticated;

-- Al anular un pago, los productos vendidos regresan a la bodega (entrada en el kardex)
create or replace function public.inv_pago_anulado()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.anulado and not coalesce(old.anulado, false) then
    insert into public.inv_movimientos (fecha, producto_id, bodega_id, tipo, origen, pago_id, documento, cantidad, costo_unitario, observaciones, usuario, localidad_id, organizacion_id)
    select now(), producto_id, bodega_id, 'entrada', 'anulacion_venta', pago_id, 'Anulación · ' || documento, cantidad, costo_unitario, new.anulado_motivo,
           (select usuario from public.perfiles where id = auth.uid()), localidad_id, organizacion_id
      from public.inv_movimientos where pago_id = new.id and origen = 'venta';
  end if;
  return new;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'pagos_inventario' and tgrelid = 'public.pagos'::regclass) then
    create trigger pagos_inventario after update of anulado on public.pagos for each row execute function public.inv_pago_anulado();
  end if;
end $$;

-- ===== Inventarios: compras con carga al inventario, reversión, abonos y productos no definidos =====
-- La compra se graba primero (estado «Grabada», se puede modificar) y luego se carga al inventario (estado «Operada»,
-- entrada en el kardex). «Revertir carga» saca los productos del kardex y la regresa a «Grabada». «Anular» la cierra.
-- Los abonos (pagos al proveedor) son un sub-detalle de la factura de compra.
alter table public.inv_compras add column if not exists moneda text not null default 'GTQ' check (moneda in ('GTQ', 'USD'));
alter table public.inv_compras add column if not exists tipo_compra text not null default 'local' check (tipo_compra in ('local', 'importacion'));
alter table public.inv_compras add column if not exists tipo_cambio numeric(12,4) not null default 1 check (tipo_cambio > 0);
alter table public.inv_compras add column if not exists no_interno text check (char_length(no_interno) <= 40);
alter table public.inv_compras add column if not exists orden_compra text check (char_length(orden_compra) <= 40);
alter table public.inv_compras add column if not exists nota_credito numeric(12,2) not null default 0 check (nota_credito >= 0);
alter table public.inv_compras add column if not exists descuentos numeric(12,2) not null default 0 check (descuentos >= 0);
alter table public.inv_compras add column if not exists aplica_retencion boolean not null default false;
alter table public.inv_compras add column if not exists valor_retencion numeric(12,2) not null default 0 check (valor_retencion >= 0);
alter table public.inv_compras add column if not exists formulario_retencion text check (char_length(formulario_retencion) <= 40);
alter table public.inv_compras add column if not exists regimen_isr text check (char_length(regimen_isr) <= 20);
alter table public.inv_compras add column if not exists regimen_isr_desc text check (char_length(regimen_isr_desc) <= 120);
alter table public.inv_compras add column if not exists transaccion text check (char_length(transaccion) <= 20);
alter table public.inv_compras add column if not exists documento_muestras boolean not null default false;
alter table public.inv_compras add column if not exists total_usd numeric(12,2) not null default 0 check (total_usd >= 0);
alter table public.inv_compras add column if not exists cargado_en timestamptz;
alter table public.inv_compras add column if not exists cargado_por text;
-- Estados: grabada (sin cargar) → operada (cargada al inventario) → anulada
alter table public.inv_compras drop constraint if exists inv_compras_estado_check;
update public.inv_compras set estado = 'operada' where estado = 'registrada';
alter table public.inv_compras alter column estado set default 'grabada';
alter table public.inv_compras add constraint inv_compras_estado_check check (estado in ('grabada', 'operada', 'anulada'));
update public.inv_compras set cargado_en = coalesce(cargado_en, creado), cargado_por = coalesce(cargado_por, creado_por) where estado = 'operada';

alter table public.inv_compra_items alter column producto_id drop not null;
alter table public.inv_compra_items add column if not exists codigo text check (char_length(codigo) <= 40);
alter table public.inv_compra_items add column if not exists nombre text check (char_length(nombre) <= 200);
alter table public.inv_compra_items add column if not exists fecha_fabricacion date;
alter table public.inv_compra_items add column if not exists descuento numeric(12,2) not null default 0 check (descuento >= 0);
alter table public.inv_compra_items add column if not exists costo_unitario_mi numeric(12,4) not null default 0 check (costo_unitario_mi >= 0);
alter table public.inv_compra_items add column if not exists subtotal_mi numeric(12,2) not null default 0 check (subtotal_mi >= 0);
alter table public.inv_compra_items add column if not exists afecta_inventario boolean not null default true;
alter table public.inv_compra_items add column if not exists controla_fecha boolean not null default false;

-- Producto creado desde una compra, pendiente de completar su definición
alter table public.inv_productos add column if not exists no_definido boolean not null default false;

-- Origen nuevo en el kardex: reversión de la carga de una compra
alter table public.inv_movimientos drop constraint if exists inv_movimientos_origen_check;
alter table public.inv_movimientos add constraint inv_movimientos_origen_check
  check (origen in ('compra', 'venta', 'ajuste', 'anulacion_compra', 'anulacion_venta', 'reversion_compra'));

-- Abonos a la factura de compra (cuenta bancaria, documento, fecha de pago, total en quetzales y en moneda internacional)
create table if not exists public.inv_compra_abonos (
  id               bigint generated always as identity primary key,
  compra_id        bigint not null references public.inv_compras (id) on delete cascade,
  cuenta_bancaria  text check (char_length(cuenta_bancaria) <= 80),
  descripcion      text check (char_length(descripcion) <= 200),
  fecha_pago       date not null default current_date,
  total            numeric(12,2) not null check (total > 0),
  total_mi         numeric(12,2) not null default 0 check (total_mi >= 0),
  creado           timestamptz not null default now(),
  creado_por       text,
  modificado       timestamptz,
  modificado_por   text
);
create index if not exists inv_compra_abonos_compra on public.inv_compra_abonos (compra_id);
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'inv_compra_abonos_registro' and tgrelid = 'public.inv_compra_abonos'::regclass) then
    create trigger inv_compra_abonos_registro before insert or update on public.inv_compra_abonos for each row execute function public.inv_registro();
  end if;
end $$;
alter table public.inv_compra_abonos enable row level security;
drop policy if exists inv_compra_abonos_lee on public.inv_compra_abonos;
create policy inv_compra_abonos_lee on public.inv_compra_abonos for select to authenticated
  using (public.es_personal() and exists (select 1 from public.inv_compras c where c.id = compra_id and public.ve_sede(c.localidad_id)));
drop policy if exists inv_compra_abonos_crea on public.inv_compra_abonos;
create policy inv_compra_abonos_crea on public.inv_compra_abonos for insert to authenticated
  with check (public.es_personal() and exists (select 1 from public.inv_compras c where c.id = compra_id and c.estado <> 'anulada' and public.ve_sede(c.localidad_id)));
drop policy if exists inv_compra_abonos_edita on public.inv_compra_abonos;
create policy inv_compra_abonos_edita on public.inv_compra_abonos for update to authenticated
  using (public.es_personal() and exists (select 1 from public.inv_compras c where c.id = compra_id and c.estado <> 'anulada' and public.ve_sede(c.localidad_id)))
  with check (public.es_personal() and exists (select 1 from public.inv_compras c where c.id = compra_id and c.estado <> 'anulada' and public.ve_sede(c.localidad_id)));
drop policy if exists inv_compra_abonos_borra on public.inv_compra_abonos;
create policy inv_compra_abonos_borra on public.inv_compra_abonos for delete to authenticated
  using (public.es_personal() and exists (select 1 from public.inv_compras c where c.id = compra_id and c.estado <> 'anulada' and public.ve_sede(c.localidad_id)));
grant select, insert, update, delete on public.inv_compra_abonos to authenticated;

-- Grabar (nueva o modificar) una compra en estado «Grabada», con su detalle. No mueve el inventario.
create or replace function public.guardar_compra(p_id bigint, p_datos jsonb, p_items jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_id bigint := p_id;
  v_bodega public.inv_bodegas;
  v_cambio numeric := greatest(coalesce(nullif(p_datos ->> 'tipo_cambio', '')::numeric, 1), 0.0001);
  v_moneda text := coalesce(nullif(p_datos ->> 'moneda', ''), 'GTQ');
  v_total numeric := 0;
  e jsonb; n int := 0;
  v_cant numeric; v_costo numeric; v_desc numeric; v_sub numeric; v_q numeric;
begin
  if not public.es_personal() then raise exception 'No tienes permiso para esta acción'; end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then raise exception 'Agrega al menos un artículo a la compra'; end if;
  select * into v_bodega from public.inv_bodegas where id = nullif(p_datos ->> 'bodega_id', '')::bigint;
  if v_bodega.id is null or not public.ve_sede(v_bodega.localidad_id) then raise exception 'Elige una bodega de tu sede'; end if;
  if v_id is not null and not exists (select 1 from public.inv_compras where id = v_id and estado = 'grabada' and public.ve_sede(localidad_id)) then
    raise exception 'Solo se puede modificar una compra en estado Grabada (revierte la carga primero)';
  end if;
  if v_id is null then
    insert into public.inv_compras (bodega_id, localidad_id, organizacion_id, estado) values (v_bodega.id, v_bodega.localidad_id, v_bodega.organizacion_id, 'grabada') returning id into v_id;
  end if;
  update public.inv_compras set
    proveedor_id = nullif(p_datos ->> 'proveedor_id', '')::bigint, bodega_id = v_bodega.id,
    fecha = coalesce(nullif(p_datos ->> 'fecha', '')::date, current_date),
    tipo_documento = coalesce(nullif(p_datos ->> 'tipo_documento', ''), 'factura'),
    serie = nullif(trim(p_datos ->> 'serie'), ''), numero_documento = nullif(trim(p_datos ->> 'numero_documento'), ''),
    dias_credito = coalesce(nullif(p_datos ->> 'dias_credito', '')::int, 0), observaciones = nullif(trim(p_datos ->> 'observaciones'), ''),
    moneda = v_moneda, tipo_compra = coalesce(nullif(p_datos ->> 'tipo_compra', ''), 'local'), tipo_cambio = v_cambio,
    no_interno = nullif(trim(p_datos ->> 'no_interno'), ''), orden_compra = nullif(trim(p_datos ->> 'orden_compra'), ''),
    nota_credito = greatest(coalesce(nullif(p_datos ->> 'nota_credito', '')::numeric, 0), 0),
    descuentos = greatest(coalesce(nullif(p_datos ->> 'descuentos', '')::numeric, 0), 0),
    aplica_retencion = coalesce((p_datos ->> 'aplica_retencion')::boolean, false),
    valor_retencion = greatest(coalesce(nullif(p_datos ->> 'valor_retencion', '')::numeric, 0), 0),
    formulario_retencion = nullif(trim(p_datos ->> 'formulario_retencion'), ''),
    regimen_isr = nullif(trim(p_datos ->> 'regimen_isr'), ''), regimen_isr_desc = nullif(trim(p_datos ->> 'regimen_isr_desc'), ''),
    transaccion = nullif(trim(p_datos ->> 'transaccion'), ''), documento_muestras = coalesce((p_datos ->> 'documento_muestras')::boolean, false)
   where id = v_id;
  delete from public.inv_compra_items where compra_id = v_id;
  for e in select * from jsonb_array_elements(p_items) loop
    v_cant := coalesce(nullif(e ->> 'cantidad', '')::numeric, 0);
    v_costo := greatest(coalesce(nullif(e ->> 'costo_unitario', '')::numeric, 0), 0);
    v_desc := greatest(coalesce(nullif(e ->> 'descuento', '')::numeric, 0), 0);
    if v_cant <= 0 then raise exception 'La cantidad de cada artículo debe ser mayor que cero'; end if;
    if nullif(e ->> 'producto_id', '') is null and coalesce(trim(e ->> 'nombre'), '') = '' then raise exception 'Escribe el producto de la línea %', n + 1; end if;
    n := n + 1;
    v_sub := greatest(round(v_cant * v_costo - v_desc, 2), 0);       -- en la moneda de la compra
    v_q := case when v_moneda = 'USD' then round(v_sub * v_cambio, 2) else v_sub end;
    insert into public.inv_compra_items (compra_id, linea, producto_id, codigo, nombre, cantidad, costo_unitario, descuento, subtotal, costo_unitario_mi, subtotal_mi,
                                         lote, fecha_fabricacion, vencimiento, afecta_inventario, controla_fecha)
    values (v_id, n, nullif(e ->> 'producto_id', '')::bigint, nullif(trim(e ->> 'codigo'), ''), nullif(trim(e ->> 'nombre'), ''), v_cant,
            case when v_moneda = 'USD' then round(v_costo * v_cambio, 4) else v_costo end, case when v_moneda = 'USD' then round(v_desc * v_cambio, 2) else v_desc end, v_q,
            case when v_moneda = 'USD' then v_costo else round(v_costo / v_cambio, 4) end, round(v_q / v_cambio, 2),
            nullif(trim(e ->> 'lote'), ''), nullif(e ->> 'fecha_fabricacion', '')::date, nullif(e ->> 'vencimiento', '')::date,
            coalesce((e ->> 'afecta_inventario')::boolean, true), coalesce((e ->> 'controla_fecha')::boolean, false));
    v_total := v_total + v_q;
  end loop;
  v_total := greatest(v_total - (select descuentos + nota_credito from public.inv_compras where id = v_id), 0);
  update public.inv_compras set total = round(v_total, 2), total_usd = round(v_total / v_cambio, 2) where id = v_id;
  return v_id;
end;
$$;
revoke execute on function public.guardar_compra(bigint, jsonb, jsonb) from public, anon;
grant execute on function public.guardar_compra(bigint, jsonb, jsonb) to authenticated;

-- Cargar al inventario: entrada en el kardex de cada artículo que afecta inventario; actualiza el último costo
create or replace function public.cargar_compra(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare c public.inv_compras; v_doc text; v_usuario text := (select usuario from public.perfiles where id = auth.uid());
begin
  if not public.es_personal() then raise exception 'No tienes permiso para esta acción'; end if;
  select * into c from public.inv_compras where id = p_id for update;
  if c.id is null or not public.ve_sede(c.localidad_id) then raise exception 'La compra no existe'; end if;
  if c.estado <> 'grabada' then raise exception 'La compra ya está cargada o anulada'; end if;
  if exists (select 1 from public.inv_compra_items where compra_id = p_id and producto_id is null) then
    raise exception 'Hay artículos sin producto en el inventario: usa «Crear producto» antes de cargar';
  end if;
  v_doc := 'Compra N.º ' || c.numero || coalesce(' · ' || nullif(concat_ws(' ', c.serie, c.numero_documento), ''), '');
  insert into public.inv_movimientos (fecha, producto_id, bodega_id, tipo, origen, compra_id, documento, cantidad, costo_unitario, usuario, localidad_id, organizacion_id)
  select now(), i.producto_id, c.bodega_id, 'entrada', 'compra', c.id, v_doc, i.cantidad, round(i.subtotal / i.cantidad, 4), v_usuario, c.localidad_id, c.organizacion_id
    from public.inv_compra_items i where i.compra_id = p_id and i.afecta_inventario order by i.linea;
  update public.inv_productos p set costo = round(i.subtotal / i.cantidad, 2)
    from public.inv_compra_items i where i.compra_id = p_id and i.afecta_inventario and i.producto_id = p.id and i.subtotal > 0;
  update public.inv_compras set estado = 'operada', cargado_en = now(), cargado_por = v_usuario where id = p_id;
end;
$$;
revoke execute on function public.cargar_compra(bigint) from public, anon;
grant execute on function public.cargar_compra(bigint) to authenticated;

-- Revertir la carga: salida en el kardex de lo cargado y la compra vuelve a «Grabada» para corregirla
create or replace function public.revertir_carga_compra(p_id bigint, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.inv_compras; v_usuario text := (select usuario from public.perfiles where id = auth.uid());
begin
  if not public.es_personal() then raise exception 'No tienes permiso para esta acción'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Escribe el motivo de la reversión'; end if;
  select * into c from public.inv_compras where id = p_id for update;
  if c.id is null or not public.ve_sede(c.localidad_id) then raise exception 'La compra no existe'; end if;
  if c.estado <> 'operada' then raise exception 'Solo se revierte una compra cargada al inventario (Operada)'; end if;
  insert into public.inv_movimientos (fecha, producto_id, bodega_id, tipo, origen, compra_id, documento, cantidad, costo_unitario, observaciones, usuario, localidad_id, organizacion_id)
  select now(), producto_id, bodega_id, 'salida', 'reversion_compra', p_id, 'Reversión · Compra N.º ' || c.numero || coalesce(' · ' || nullif(concat_ws(' ', c.serie, c.numero_documento), ''), ''),
           sum(case when origen = 'compra' then cantidad else -cantidad end),
           (array_agg(costo_unitario order by id desc) filter (where origen = 'compra'))[1], trim(p_motivo), v_usuario, localidad_id, organizacion_id
      from public.inv_movimientos where compra_id = p_id and origen in ('compra', 'reversion_compra')
     group by producto_id, bodega_id, localidad_id, organizacion_id
    having sum(case when origen = 'compra' then cantidad else -cantidad end) > 0;
  update public.inv_compras set estado = 'grabada', cargado_en = null, cargado_por = null where id = p_id;
end;
$$;
revoke execute on function public.revertir_carga_compra(bigint, text) from public, anon;
grant execute on function public.revertir_carga_compra(bigint, text) to authenticated;

-- Anular (Super Administrador): si estaba cargada, saca del kardex lo que quedaba ingresado
create or replace function public.anular_compra(p_id bigint, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.inv_compras; v_usuario text := (select usuario from public.perfiles where id = auth.uid());
begin
  if not public.es_super_administrador() then raise exception 'Solo el Super Administrador puede anular compras'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Escribe el motivo de la anulación'; end if;
  select * into c from public.inv_compras where id = p_id for update;
  if c.id is null or c.estado = 'anulada' then raise exception 'La compra no existe o ya estaba anulada'; end if;
  if c.estado = 'operada' then
    insert into public.inv_movimientos (fecha, producto_id, bodega_id, tipo, origen, compra_id, documento, cantidad, costo_unitario, observaciones, usuario, localidad_id, organizacion_id)
    select now(), producto_id, bodega_id, 'salida', 'anulacion_compra', p_id, 'Anulación · Compra N.º ' || c.numero || coalesce(' · ' || nullif(concat_ws(' ', c.serie, c.numero_documento), ''), ''),
           sum(case when origen = 'compra' then cantidad else -cantidad end),
           (array_agg(costo_unitario order by id desc) filter (where origen = 'compra'))[1], trim(p_motivo), v_usuario, localidad_id, organizacion_id
      from public.inv_movimientos where compra_id = p_id and origen in ('compra', 'reversion_compra')
     group by producto_id, bodega_id, localidad_id, organizacion_id
    having sum(case when origen = 'compra' then cantidad else -cantidad end) > 0;
  end if;
  update public.inv_compras set estado = 'anulada', anulado_motivo = trim(p_motivo), anulado_en = now(), anulado_por = v_usuario where id = p_id;
end;
$$;
revoke execute on function public.anular_compra(bigint, text) from public, anon;
grant execute on function public.anular_compra(bigint, text) to authenticated;

-- Crear en el catálogo los artículos de la compra que no existen (marcados «No definido» para completarlos después)
create or replace function public.crear_productos_compra(p_id bigint)
returns int language plpgsql security definer set search_path = public as $$
declare c public.inv_compras; i record; v_prod bigint; n int := 0;
begin
  if not public.es_personal() then raise exception 'No tienes permiso para esta acción'; end if;
  select * into c from public.inv_compras where id = p_id;
  if c.id is null or not public.ve_sede(c.localidad_id) then raise exception 'La compra no existe'; end if;
  if c.estado <> 'grabada' then raise exception 'Solo en una compra Grabada'; end if;
  for i in select * from public.inv_compra_items where compra_id = p_id and producto_id is null order by linea loop
    select id into v_prod from public.inv_productos
     where localidad_id is not distinct from c.localidad_id and ((i.codigo is not null and lower(codigo) = lower(i.codigo)) or lower(nombre) = lower(i.nombre)) limit 1;
    if v_prod is null then
      insert into public.inv_productos (codigo, nombre, costo, proveedor_id, bodega_id, no_definido, localidad_id, organizacion_id)
      values (i.codigo, coalesce(i.nombre, i.codigo), round(i.subtotal / i.cantidad, 2), c.proveedor_id, c.bodega_id, true, c.localidad_id, c.organizacion_id)
      returning id into v_prod;
      n := n + 1;
    end if;
    update public.inv_compra_items set producto_id = v_prod where id = i.id;
  end loop;
  return n;
end;
$$;
revoke execute on function public.crear_productos_compra(bigint) from public, anon;
grant execute on function public.crear_productos_compra(bigint) to authenticated;

-- ===== Inventarios: proveedores de productos dentales y medicamentos en Guatemala (datos iniciales) =====
-- Depósitos dentales y droguerías con presencia en Guatemala, tomados de sus sitios y directorios públicos (oct. 2026).
-- Sin NIT ni condiciones de crédito: quedan «Pendiente de revisar» para que se confirmen con cada proveedor.
-- Solo se insertan los que falten, en la sede 2-01 (Plus Dental).
insert into public.inv_proveedores (nombre_comercial, nombre_fiscal, direccion, telefonos, contacto, dias_credito, pendiente_revisar, localidad_id, organizacion_id)
select x.comercial, x.fiscal, x.direccion, x.telefonos, x.contacto, 0, true, l.id, l.organizacion_id
  from (values
  ('Magno Dental', 'Magno Dental, S.A.', '11 Avenida 19-39, Zona 10, Ciudad de Guatemala', null, 'Alex Mármol (distribuidor autorizado Ultradent)'),
  ('Dentfarma', 'Dentfarma', '4 Calle A 11-69, Zona 4 de Mixco, Colonia Monte Real', '3267-1296 / 5306-7988', 'Representa 3M y Ultradent'),
  ('Distribuidora Dental (DIDESA)', 'Distribuidora Dental, S.A.', 'Zona 9, Ciudad de Guatemala', '2296-0115', 'Distribuidor oficial MIS Implants'),
  ('Denti Clínica', 'Denti Clínica, S.A.', null, null, 'Materiales y equipo dental y médico-quirúrgico'),
  ('Bodega Dental', 'Bodega Dental', null, null, 'Adhesivos, cementos, descartables'),
  ('Importadora Delgado', 'Importadora Delgado, S.A.', 'Quetzaltenango (envíos a todo el país)', null, 'Depósito dental'),
  ('Depósito Dental Leal Castro', 'Depósito Dental Leal Castro', '13 Calle 4-24, Zona 1, Ciudad de Guatemala', '2251-8716', 'Materiales de laboratorio dental'),
  ('Tecnodentic', 'Tecnodentic', 'Zona 11, Colonia Toledo, Ciudad de Guatemala', null, 'Equipos, instrumental y materiales dentales'),
  ('Denteco', 'Denteco', '3 Calle A 7-35, Zona 10, Ciudad de Guatemala', null, 'Depósito dental'),
  ('Alumbra', 'Alumbra, S.A.', null, null, 'Equipo médico y dental, implantes, autoclaves'),
  ('Droguería Colón', 'Droguería Colón, S.A.', '13 Avenida 5-40, Zona 1, Ciudad de Guatemala', null, 'Medicamentos'),
  ('Droguería Pisa', 'Droguería Pisa de Guatemala, S.A.', 'Zona 13, Ciudad de Guatemala', '2302-4500 / 5730-7171', 'Medicamentos e insumos hospitalarios'),
  ('Droguería Americana (Grupo DASA)', 'Droguería Americana, S.A.', '7 Avenida 6-51, Zona 2, Ciudad de Guatemala', null, 'Medicamentos'),
  ('Droguería Italiana', 'Droguería Italiana', null, null, 'Representa 12 laboratorios farmacéuticos'),
  ('Supharma', 'Supharma, S.A.', null, null, 'Medicamentos, naturales y nutricionales'),
  ('Medissa', 'Medissa', null, null, 'Distribuidora de medicamentos')
  ) x (comercial, fiscal, direccion, telefonos, contacto)
  cross join (select l.id, l.organizacion_id from public.org_localidades l join public.organizaciones o on o.id = l.organizacion_id where o.codigo = '2' and l.codigo = '1') l
 where not exists (select 1 from public.inv_proveedores p where lower(p.nombre_comercial) = lower(x.comercial) and p.localidad_id = l.id);

-- ===== Inventarios: datos adicionales del proveedor (clasificación, contables y de pago) =====
-- Concepto de gastos, nacional/extranjero, servicio crítico, tipo de proveedor, régimen ISR, bodega predeterminada,
-- cuenta contable de gastos (una o varias), «visualizar en», transacción y 2da. transacción (exenciones).
alter table public.inv_proveedores add column if not exists concepto_gastos text not null default 'Proveedor estándar' check (char_length(concepto_gastos) between 1 and 150);
alter table public.inv_proveedores add column if not exists proveedor_nacional boolean not null default true;
alter table public.inv_proveedores add column if not exists servicio_critico boolean not null default false;
alter table public.inv_proveedores add column if not exists tipo_proveedor text not null default '1' check (char_length(tipo_proveedor) <= 10);
alter table public.inv_proveedores add column if not exists regimen_isr text check (char_length(regimen_isr) <= 10);
alter table public.inv_proveedores add column if not exists bodega_id bigint references public.inv_bodegas (id) on delete set null;
alter table public.inv_proveedores add column if not exists cuenta_gastos text check (char_length(cuenta_gastos) <= 30);
alter table public.inv_proveedores add column if not exists cuenta_gastos_desc text check (char_length(cuenta_gastos_desc) <= 150);
alter table public.inv_proveedores add column if not exists varias_cuentas boolean not null default false;
alter table public.inv_proveedores add column if not exists visualizar_en text not null default 'compras_inventario' check (visualizar_en in ('compras_inventario', 'compras_gastos', 'ambos'));
alter table public.inv_proveedores add column if not exists transaccion text check (char_length(transaccion) <= 20);
alter table public.inv_proveedores add column if not exists transaccion_exencion text check (char_length(transaccion_exencion) <= 20);

-- Varias cuentas contables de gasto por proveedor
create table if not exists public.inv_proveedor_cuentas (
  id            bigint generated always as identity primary key,
  proveedor_id  bigint not null references public.inv_proveedores (id) on delete cascade,
  cuenta        text not null check (char_length(cuenta) between 1 and 30),
  descripcion   text check (char_length(descripcion) <= 150),
  creado        timestamptz not null default now()
);
create unique index if not exists inv_proveedor_cuentas_unica on public.inv_proveedor_cuentas (proveedor_id, lower(cuenta));
alter table public.inv_proveedor_cuentas enable row level security;
drop policy if exists inv_proveedor_cuentas_personal on public.inv_proveedor_cuentas;
create policy inv_proveedor_cuentas_personal on public.inv_proveedor_cuentas for all to authenticated
  using (public.es_personal() and exists (select 1 from public.inv_proveedores p where p.id = proveedor_id and public.ve_sede(p.localidad_id)))
  with check (public.es_personal() and exists (select 1 from public.inv_proveedores p where p.id = proveedor_id and public.ve_sede(p.localidad_id)));
grant select, insert, update, delete on public.inv_proveedor_cuentas to authenticated;

-- Proveedores ya cargados: nacionales, de compras de inventario, con la bodega general y la transacción de su tipo
update public.inv_proveedores p
   set bodega_id = coalesce(p.bodega_id, (select b.id from public.inv_bodegas b where b.tipo = 'general' and b.localidad_id is not distinct from p.localidad_id order by b.numero limit 1)),
       transaccion = coalesce(p.transaccion, case when p.nombre_comercial ilike 'drogu%' or p.nombre_comercial ilike 'medissa%' or p.nombre_comercial ilike 'supharma%' then '1011' else '1012' end)
 where p.bodega_id is null or p.transaccion is null;

-- ===== Inventarios: traslados de productos entre bodegas =====
-- Flujo: Grabar (estado «Grabado», no mueve inventario) → Descargar (estado «Operado»: salida de la bodega origen y
-- entrada en la bodega destino en el kardex) → Revertir (deshace los movimientos y vuelve a «Grabado»).
create table if not exists public.inv_traslados (
  id                 bigint generated always as identity primary key,
  numero             bigint,
  fecha              timestamptz not null default now(),
  estado             text not null default 'grabado' check (estado in ('grabado', 'operado')),
  bodega_origen_id   bigint not null references public.inv_bodegas (id),
  bodega_destino_id  bigint not null references public.inv_bodegas (id),
  descripcion        text check (char_length(descripcion) <= 500),
  aplica_conta       boolean not null default false,
  operado_en         timestamptz,
  operado_por        text,
  revertido_en       timestamptz,
  revertido_por      text,
  revertido_motivo   text check (char_length(revertido_motivo) <= 300),
  creado             timestamptz not null default now(),
  creado_por         text,
  modificado         timestamptz,
  modificado_por     text,
  organizacion_id    bigint references public.organizaciones (id) on delete set null,
  localidad_id       bigint references public.org_localidades (id) on delete set null,
  check (bodega_origen_id <> bodega_destino_id)
);
create table if not exists public.inv_traslado_items (
  id                 bigint generated always as identity primary key,
  traslado_id        bigint not null references public.inv_traslados (id) on delete cascade,
  linea              int not null default 1,
  producto_id        bigint not null references public.inv_productos (id),
  lote               text check (char_length(lote) <= 40),
  vencimiento        date,
  cantidad           numeric(12,2) not null check (cantidad > 0),
  afecta_inventario  boolean not null default true
);
create index if not exists inv_traslado_items_traslado on public.inv_traslado_items (traslado_id, linea);

-- El kardex sabe de qué traslado sale cada movimiento
alter table public.inv_movimientos add column if not exists traslado_id bigint references public.inv_traslados (id) on delete set null;
create index if not exists inv_movimientos_traslado on public.inv_movimientos (traslado_id) where traslado_id is not null;
alter table public.inv_movimientos drop constraint if exists inv_movimientos_origen_check;
alter table public.inv_movimientos add constraint inv_movimientos_origen_check
  check (origen in ('compra', 'venta', 'ajuste', 'anulacion_compra', 'anulacion_venta', 'reversion_compra', 'traslado', 'reversion_traslado'));

-- El registro automático también numera los traslados
create or replace function public.inv_registro()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_usuario text := coalesce((select usuario from public.perfiles where id = auth.uid()), 'Sin usuario');
begin
  if tg_op = 'INSERT' then
    if tg_table_name in ('inv_proveedores', 'inv_bodegas', 'inv_productos', 'inv_tipos_producto', 'inv_compras', 'inv_traslados') then
      perform pg_advisory_xact_lock(hashtext(tg_table_name || '_numero'));
      execute format('select coalesce(max(numero), 0) + 1 from public.%I', tg_table_name) into new.numero;
    end if;
    new.creado := now(); new.creado_por := v_usuario; new.modificado := null; new.modificado_por := null;
  else
    if tg_table_name in ('inv_proveedores', 'inv_bodegas', 'inv_productos', 'inv_tipos_producto', 'inv_compras', 'inv_traslados') then new.numero := old.numero; end if;
    new.creado := old.creado; new.creado_por := old.creado_por;
    new.modificado := now(); new.modificado_por := v_usuario;
  end if;
  return new;
end;
$$;
do $$ declare t text := 'inv_traslados'; begin
  if not exists (select 1 from pg_trigger where tgname = t || '_registro' and tgrelid = ('public.' || t)::regclass) then
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.inv_registro()', t || '_registro', t);
  end if;
  if not exists (select 1 from pg_trigger where tgname = t || '_sede' and tgrelid = ('public.' || t)::regclass) then
    execute format('create trigger %I before insert or update of organizacion_id, localidad_id on public.%I for each row execute function public.sede_registro()', t || '_sede', t);
  end if;
end $$;

-- Lectura para el personal de su sede; se graban solo con las funciones de abajo
alter table public.inv_traslados enable row level security;
drop policy if exists inv_traslados_lee on public.inv_traslados;
create policy inv_traslados_lee on public.inv_traslados for select to authenticated using (public.es_personal() and public.ve_sede(localidad_id));
grant select on public.inv_traslados to authenticated;
alter table public.inv_traslado_items enable row level security;
drop policy if exists inv_traslado_items_lee on public.inv_traslado_items;
create policy inv_traslado_items_lee on public.inv_traslado_items for select to authenticated
  using (public.es_personal() and exists (select 1 from public.inv_traslados t where t.id = traslado_id and public.ve_sede(t.localidad_id)));
grant select on public.inv_traslado_items to authenticated;

-- Grabar (nuevo o modificar) un traslado en estado «Grabado», con su detalle. No mueve el inventario.
create or replace function public.guardar_traslado(p_id bigint, p_datos jsonb, p_items jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_id bigint := p_id;
  v_org public.inv_bodegas; v_des public.inv_bodegas;
  e jsonb; n int := 0;
begin
  if not public.es_personal() then raise exception 'No tienes permiso para esta acción'; end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then raise exception 'Agrega al menos un producto al traslado'; end if;
  select * into v_org from public.inv_bodegas where id = nullif(p_datos ->> 'bodega_origen_id', '')::bigint;
  select * into v_des from public.inv_bodegas where id = nullif(p_datos ->> 'bodega_destino_id', '')::bigint;
  if v_org.id is null or not public.ve_sede(v_org.localidad_id) then raise exception 'Elige la bodega origen de tu sede'; end if;
  if v_des.id is null or not public.ve_sede(v_des.localidad_id) then raise exception 'Elige la bodega destino de tu sede'; end if;
  if v_org.id = v_des.id then raise exception 'La bodega origen y la destino deben ser distintas'; end if;
  if v_id is not null and not exists (select 1 from public.inv_traslados where id = v_id and estado = 'grabado' and public.ve_sede(localidad_id)) then
    raise exception 'Solo se puede modificar un traslado en estado Grabado (revierte la descarga primero)';
  end if;
  if v_id is null then
    insert into public.inv_traslados (bodega_origen_id, bodega_destino_id, localidad_id, organizacion_id)
    values (v_org.id, v_des.id, v_org.localidad_id, v_org.organizacion_id) returning id into v_id;
  end if;
  update public.inv_traslados set bodega_origen_id = v_org.id, bodega_destino_id = v_des.id,
    descripcion = nullif(trim(p_datos ->> 'descripcion'), ''), aplica_conta = coalesce((p_datos ->> 'aplica_conta')::boolean, false)
   where id = v_id;
  delete from public.inv_traslado_items where traslado_id = v_id;
  for e in select * from jsonb_array_elements(p_items) loop
    if nullif(e ->> 'producto_id', '') is null then raise exception 'Cada línea necesita un producto del inventario'; end if;
    if coalesce(nullif(e ->> 'cantidad', '')::numeric, 0) <= 0 then raise exception 'La cantidad de cada producto debe ser mayor que cero'; end if;
    n := n + 1;
    insert into public.inv_traslado_items (traslado_id, linea, producto_id, lote, vencimiento, cantidad, afecta_inventario)
    values (v_id, n, (e ->> 'producto_id')::bigint, nullif(trim(e ->> 'lote'), ''), nullif(e ->> 'vencimiento', '')::date,
            (e ->> 'cantidad')::numeric, coalesce((e ->> 'afecta_inventario')::boolean, true));
  end loop;
  return v_id;
end;
$$;
revoke execute on function public.guardar_traslado(bigint, jsonb, jsonb) from public, anon;
grant execute on function public.guardar_traslado(bigint, jsonb, jsonb) to authenticated;

-- Descargar: salida de la bodega origen y entrada en la destino (al costo del producto). Exige existencia suficiente.
create or replace function public.descargar_traslado(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare t public.inv_traslados; v_doc text; v_usuario text := (select usuario from public.perfiles where id = auth.uid()); f record;
begin
  if not public.es_personal() then raise exception 'No tienes permiso para esta acción'; end if;
  select * into t from public.inv_traslados where id = p_id for update;
  if t.id is null or not public.ve_sede(t.localidad_id) then raise exception 'El traslado no existe'; end if;
  if t.estado <> 'grabado' then raise exception 'El traslado ya fue descargado'; end if;
  for f in select i.producto_id, sum(i.cantidad) as cant, max(p.nombre) as nombre,
                  coalesce((select sum(case when m.tipo = 'entrada' then m.cantidad else -m.cantidad end) from public.inv_movimientos m
                             where m.producto_id = i.producto_id and m.bodega_id = t.bodega_origen_id), 0) as exist
             from public.inv_traslado_items i join public.inv_productos p on p.id = i.producto_id
            where i.traslado_id = p_id and i.afecta_inventario group by i.producto_id loop
    if f.exist < f.cant then raise exception 'Existencia insuficiente de «%» en la bodega origen: hay %, se trasladan %', f.nombre, f.exist, f.cant; end if;
  end loop;
  v_doc := 'Traslado N.º ' || t.numero;
  insert into public.inv_movimientos (fecha, producto_id, bodega_id, tipo, origen, traslado_id, documento, cantidad, costo_unitario, observaciones, usuario, localidad_id, organizacion_id)
  select now(), i.producto_id, x.bodega, x.tipo, 'traslado', t.id, v_doc, i.cantidad, coalesce(p.costo, 0), t.descripcion, v_usuario, b.localidad_id, b.organizacion_id
    from public.inv_traslado_items i join public.inv_productos p on p.id = i.producto_id
    cross join (values (t.bodega_origen_id, 'salida', 1), (t.bodega_destino_id, 'entrada', 2)) as x(bodega, tipo, orden)
    join public.inv_bodegas b on b.id = x.bodega
   where i.traslado_id = p_id and i.afecta_inventario order by i.linea, x.orden;
  update public.inv_traslados set estado = 'operado', fecha = now(), operado_en = now(), operado_por = v_usuario where id = p_id;
end;
$$;
revoke execute on function public.descargar_traslado(bigint) from public, anon;
grant execute on function public.descargar_traslado(bigint) to authenticated;

-- Revertir: devuelve los productos a la bodega origen y el traslado vuelve a «Grabado» para corregirlo
create or replace function public.revertir_traslado(p_id bigint, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare t public.inv_traslados; v_usuario text := (select usuario from public.perfiles where id = auth.uid()); f record;
begin
  if not public.es_personal() then raise exception 'No tienes permiso para esta acción'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Escribe el motivo de la reversión'; end if;
  select * into t from public.inv_traslados where id = p_id for update;
  if t.id is null or not public.ve_sede(t.localidad_id) then raise exception 'El traslado no existe'; end if;
  if t.estado <> 'operado' then raise exception 'Solo se revierte un traslado descargado (Operado)'; end if;
  -- Lo que entró al destino por este traslado y sigue neto se devuelve
  for f in select m.producto_id, max(p.nombre) as nombre,
                  sum(case when m.origen = 'traslado' then m.cantidad else -m.cantidad end) as neto,
                  coalesce((select sum(case when k.tipo = 'entrada' then k.cantidad else -k.cantidad end) from public.inv_movimientos k
                             where k.producto_id = m.producto_id and k.bodega_id = t.bodega_destino_id), 0) as exist
             from public.inv_movimientos m join public.inv_productos p on p.id = m.producto_id
            where m.traslado_id = p_id and m.bodega_id = t.bodega_destino_id group by m.producto_id loop
    if f.neto > 0 and f.exist < f.neto then raise exception 'No se puede revertir: en la bodega destino solo quedan % de «%» (el traslado ingresó %)', f.exist, f.nombre, f.neto; end if;
  end loop;
  insert into public.inv_movimientos (fecha, producto_id, bodega_id, tipo, origen, traslado_id, documento, cantidad, costo_unitario, observaciones, usuario, localidad_id, organizacion_id)
  select now(), producto_id, bodega_id, case when sum(case when tipo = 'entrada' then cantidad else -cantidad end) > 0 then 'salida' else 'entrada' end,
         'reversion_traslado', p_id, 'Reversión · Traslado N.º ' || t.numero,
         abs(sum(case when tipo = 'entrada' then cantidad else -cantidad end)), (array_agg(costo_unitario order by id desc))[1], trim(p_motivo), v_usuario, localidad_id, organizacion_id
    from public.inv_movimientos where traslado_id = p_id
   group by producto_id, bodega_id, localidad_id, organizacion_id
  having sum(case when tipo = 'entrada' then cantidad else -cantidad end) <> 0;
  update public.inv_traslados set estado = 'grabado', operado_en = null, operado_por = null, revertido_en = now(), revertido_por = v_usuario, revertido_motivo = trim(p_motivo) where id = p_id;
end;
$$;
revoke execute on function public.revertir_traslado(bigint, text) from public, anon;
grant execute on function public.revertir_traslado(bigint, text) to authenticated;

-- ===== Inventarios: órdenes de compra =====
-- Flujo: Grabar (estado «Solicitada») → Autorizar (estado «Autorizada», con la cantidad que se aprueba por producto)
-- → la compra la asocia en «Aplica orden» (lista de valores). Revertir autorización (si ninguna compra la usa) / Anular.
create table if not exists public.inv_ordenes_compra (
  id                 bigint generated always as identity primary key,
  numero             bigint,
  numero_orden       text check (char_length(numero_orden) <= 40),
  fecha              date not null default current_date,
  estado             text not null default 'solicitada' check (estado in ('solicitada', 'autorizada', 'anulada')),
  proveedor_id       bigint references public.inv_proveedores (id) on delete set null,
  bodega_id          bigint references public.inv_bodegas (id) on delete set null,
  forma_pago         text not null default 'credito' check (forma_pago in ('contado', 'credito')),
  dias_credito       int not null default 0 check (dias_credito between 0 and 365),
  moneda             text not null default 'GTQ' check (moneda in ('GTQ', 'USD')),
  tipo_cambio        numeric(12,4) not null default 1 check (tipo_cambio > 0),
  tipo_proveedor     text not null default 'local' check (tipo_proveedor in ('local', 'exterior')),
  obs_internas       text check (char_length(obs_internas) <= 500),
  obs_proveedor      text check (char_length(obs_proveedor) <= 500),
  total              numeric(14,2) not null default 0,
  total_mi           numeric(14,2) not null default 0,
  aprobado_en        timestamptz,
  aprobado_por       text,
  anulado_en         timestamptz,
  anulado_por        text,
  anulado_motivo     text check (char_length(anulado_motivo) <= 300),
  creado             timestamptz not null default now(),
  creado_por         text,
  modificado         timestamptz,
  modificado_por     text,
  organizacion_id    bigint references public.organizaciones (id) on delete set null,
  localidad_id       bigint references public.org_localidades (id) on delete set null
);
create table if not exists public.inv_orden_items (
  id                 bigint generated always as identity primary key,
  orden_id           bigint not null references public.inv_ordenes_compra (id) on delete cascade,
  linea              int not null default 1,
  producto_id        bigint not null references public.inv_productos (id),
  cantidad_solicita  numeric(12,2) not null check (cantidad_solicita > 0),
  cantidad_aprueba   numeric(12,2) check (cantidad_aprueba >= 0),
  precio_unitario    numeric(12,4) not null default 0 check (precio_unitario >= 0),
  observaciones      text check (char_length(observaciones) <= 300)
);
create index if not exists inv_orden_items_orden on public.inv_orden_items (orden_id, linea);

-- La compra guarda de qué orden viene
alter table public.inv_compras add column if not exists orden_id bigint references public.inv_ordenes_compra (id) on delete set null;
create index if not exists inv_compras_orden on public.inv_compras (orden_id) where orden_id is not null;

-- El registro automático también numera las órdenes (folio)
create or replace function public.inv_registro()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_usuario text := coalesce((select usuario from public.perfiles where id = auth.uid()), 'Sin usuario');
begin
  if tg_op = 'INSERT' then
    if tg_table_name in ('inv_proveedores', 'inv_bodegas', 'inv_productos', 'inv_tipos_producto', 'inv_compras', 'inv_traslados', 'inv_ordenes_compra') then
      perform pg_advisory_xact_lock(hashtext(tg_table_name || '_numero'));
      execute format('select coalesce(max(numero), 0) + 1 from public.%I', tg_table_name) into new.numero;
    end if;
    new.creado := now(); new.creado_por := v_usuario; new.modificado := null; new.modificado_por := null;
  else
    if tg_table_name in ('inv_proveedores', 'inv_bodegas', 'inv_productos', 'inv_tipos_producto', 'inv_compras', 'inv_traslados', 'inv_ordenes_compra') then new.numero := old.numero; end if;
    new.creado := old.creado; new.creado_por := old.creado_por;
    new.modificado := now(); new.modificado_por := v_usuario;
  end if;
  return new;
end;
$$;
do $$ declare t text := 'inv_ordenes_compra'; begin
  if not exists (select 1 from pg_trigger where tgname = t || '_registro' and tgrelid = ('public.' || t)::regclass) then
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.inv_registro()', t || '_registro', t);
  end if;
  if not exists (select 1 from pg_trigger where tgname = t || '_sede' and tgrelid = ('public.' || t)::regclass) then
    execute format('create trigger %I before insert or update of organizacion_id, localidad_id on public.%I for each row execute function public.sede_registro()', t || '_sede', t);
  end if;
end $$;

alter table public.inv_ordenes_compra enable row level security;
drop policy if exists inv_ordenes_compra_lee on public.inv_ordenes_compra;
create policy inv_ordenes_compra_lee on public.inv_ordenes_compra for select to authenticated using (public.es_personal() and public.ve_sede(localidad_id));
grant select on public.inv_ordenes_compra to authenticated;
alter table public.inv_orden_items enable row level security;
drop policy if exists inv_orden_items_lee on public.inv_orden_items;
create policy inv_orden_items_lee on public.inv_orden_items for select to authenticated
  using (public.es_personal() and exists (select 1 from public.inv_ordenes_compra o where o.id = orden_id and public.ve_sede(o.localidad_id)));
grant select on public.inv_orden_items to authenticated;

-- Grabar (nueva o modificar) una orden en estado «Solicitada», con su detalle
create or replace function public.guardar_orden_compra(p_id bigint, p_datos jsonb, p_items jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_id bigint := p_id; v_bod public.inv_bodegas; e jsonb; n int := 0; v_total numeric := 0;
  v_cambio numeric := greatest(coalesce(nullif(p_datos ->> 'tipo_cambio', '')::numeric, 1), 0.0001);
  v_moneda text := coalesce(nullif(p_datos ->> 'moneda', ''), 'GTQ'); v_num bigint;
begin
  if not public.es_personal() then raise exception 'No tienes permiso para esta acción'; end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then raise exception 'Agrega al menos un producto a la orden'; end if;
  select * into v_bod from public.inv_bodegas where id = nullif(p_datos ->> 'bodega_id', '')::bigint;
  if v_bod.id is null or not public.ve_sede(v_bod.localidad_id) then raise exception 'Elige una bodega de tu sede'; end if;
  if nullif(p_datos ->> 'proveedor_id', '') is null then raise exception 'Elige el proveedor'; end if;
  if v_id is not null and not exists (select 1 from public.inv_ordenes_compra where id = v_id and estado = 'solicitada' and public.ve_sede(localidad_id)) then
    raise exception 'Solo se puede modificar una orden en estado Solicitada (revierte la autorización primero)';
  end if;
  if v_id is null then
    insert into public.inv_ordenes_compra (bodega_id, localidad_id, organizacion_id) values (v_bod.id, v_bod.localidad_id, v_bod.organizacion_id) returning id, numero into v_id, v_num;
  end if;
  update public.inv_ordenes_compra set
    numero_orden = coalesce(nullif(trim(p_datos ->> 'numero_orden'), ''), numero_orden, 'OC-' || lpad(numero::text, 3, '0') || '-' || to_char(current_date, 'MM-YYYY')),
    fecha = coalesce(nullif(p_datos ->> 'fecha', '')::date, current_date), proveedor_id = (p_datos ->> 'proveedor_id')::bigint, bodega_id = v_bod.id,
    forma_pago = coalesce(nullif(p_datos ->> 'forma_pago', ''), 'credito'), dias_credito = coalesce(nullif(p_datos ->> 'dias_credito', '')::int, 0),
    moneda = v_moneda, tipo_cambio = v_cambio, tipo_proveedor = coalesce(nullif(p_datos ->> 'tipo_proveedor', ''), 'local'),
    obs_internas = nullif(trim(p_datos ->> 'obs_internas'), ''), obs_proveedor = nullif(trim(p_datos ->> 'obs_proveedor'), '')
   where id = v_id;
  delete from public.inv_orden_items where orden_id = v_id;
  for e in select * from jsonb_array_elements(p_items) loop
    if nullif(e ->> 'producto_id', '') is null then raise exception 'Cada línea necesita un producto del inventario'; end if;
    if coalesce(nullif(e ->> 'cantidad_solicita', '')::numeric, 0) <= 0 then raise exception 'La cantidad solicitada debe ser mayor que cero'; end if;
    n := n + 1;
    insert into public.inv_orden_items (orden_id, linea, producto_id, cantidad_solicita, cantidad_aprueba, precio_unitario, observaciones)
    values (v_id, n, (e ->> 'producto_id')::bigint, (e ->> 'cantidad_solicita')::numeric, nullif(e ->> 'cantidad_aprueba', '')::numeric,
            greatest(coalesce(nullif(e ->> 'precio_unitario', '')::numeric, 0), 0), nullif(trim(e ->> 'observaciones'), ''));
    v_total := v_total + coalesce(nullif(e ->> 'cantidad_aprueba', '')::numeric, (e ->> 'cantidad_solicita')::numeric) * greatest(coalesce(nullif(e ->> 'precio_unitario', '')::numeric, 0), 0);
  end loop;
  -- Totales en quetzales y en moneda internacional (el precio se digita en la moneda de la orden)
  update public.inv_ordenes_compra set total = round(case when v_moneda = 'USD' then v_total * v_cambio else v_total end, 2),
                                       total_mi = round(case when v_moneda = 'USD' then v_total else v_total / v_cambio end, 2) where id = v_id;
  return v_id;
end;
$$;
revoke execute on function public.guardar_orden_compra(bigint, jsonb, jsonb) from public, anon;
grant execute on function public.guardar_orden_compra(bigint, jsonb, jsonb) to authenticated;

-- Autorizar: lo no aprobado explícitamente se aprueba por lo solicitado
create or replace function public.autorizar_orden_compra(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare o public.inv_ordenes_compra; v_usuario text := (select usuario from public.perfiles where id = auth.uid());
begin
  if not public.es_personal() then raise exception 'No tienes permiso para esta acción'; end if;
  select * into o from public.inv_ordenes_compra where id = p_id for update;
  if o.id is null or not public.ve_sede(o.localidad_id) then raise exception 'La orden no existe'; end if;
  if o.estado <> 'solicitada' then raise exception 'La orden ya está autorizada o anulada'; end if;
  update public.inv_orden_items set cantidad_aprueba = cantidad_solicita where orden_id = p_id and cantidad_aprueba is null;
  if not exists (select 1 from public.inv_orden_items where orden_id = p_id and cantidad_aprueba > 0) then raise exception 'Aprueba al menos un producto (cantidad mayor que cero)'; end if;
  update public.inv_ordenes_compra set estado = 'autorizada', aprobado_en = now(), aprobado_por = v_usuario,
    total = round((select sum(cantidad_aprueba * precio_unitario) from public.inv_orden_items where orden_id = p_id) * case when o.moneda = 'USD' then o.tipo_cambio else 1 end, 2),
    total_mi = round((select sum(cantidad_aprueba * precio_unitario) from public.inv_orden_items where orden_id = p_id) / case when o.moneda = 'USD' then 1 else o.tipo_cambio end, 2)
   where id = p_id;
end;
$$;
revoke execute on function public.autorizar_orden_compra(bigint) from public, anon;
grant execute on function public.autorizar_orden_compra(bigint) to authenticated;

-- Revertir la autorización (vuelve a «Solicitada»), solo si ninguna compra vigente la usa
create or replace function public.revertir_orden_compra(p_id bigint, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare o public.inv_ordenes_compra;
begin
  if not public.es_personal() then raise exception 'No tienes permiso para esta acción'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Escribe el motivo'; end if;
  select * into o from public.inv_ordenes_compra where id = p_id for update;
  if o.id is null or not public.ve_sede(o.localidad_id) then raise exception 'La orden no existe'; end if;
  if o.estado <> 'autorizada' then raise exception 'Solo se revierte una orden Autorizada'; end if;
  if exists (select 1 from public.inv_compras where orden_id = p_id and estado <> 'anulada') then raise exception 'La orden ya está asociada a una compra: desasóciala o anula la compra primero'; end if;
  update public.inv_ordenes_compra set estado = 'solicitada', aprobado_en = null, aprobado_por = null,
    obs_internas = left(concat_ws(' · ', obs_internas, 'Autorización revertida: ' || trim(p_motivo)), 500) where id = p_id;
end;
$$;
revoke execute on function public.revertir_orden_compra(bigint, text) from public, anon;
grant execute on function public.revertir_orden_compra(bigint, text) to authenticated;

-- Anular (Super Administrador), si ninguna compra vigente la usa
create or replace function public.anular_orden_compra(p_id bigint, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare o public.inv_ordenes_compra; v_usuario text := (select usuario from public.perfiles where id = auth.uid());
begin
  if not public.es_super_administrador() then raise exception 'Solo el Super Administrador puede anular órdenes de compra'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Escribe el motivo de la anulación'; end if;
  select * into o from public.inv_ordenes_compra where id = p_id for update;
  if o.id is null or o.estado = 'anulada' then raise exception 'La orden no existe o ya estaba anulada'; end if;
  if exists (select 1 from public.inv_compras where orden_id = p_id and estado <> 'anulada') then raise exception 'La orden está asociada a una compra vigente'; end if;
  update public.inv_ordenes_compra set estado = 'anulada', anulado_en = now(), anulado_por = v_usuario, anulado_motivo = trim(p_motivo) where id = p_id;
end;
$$;
revoke execute on function public.anular_orden_compra(bigint, text) from public, anon;
grant execute on function public.anular_orden_compra(bigint, text) to authenticated;

-- Grabar compra: guarda también la orden de compra asociada (debe estar Autorizada)
create or replace function public.guardar_compra(p_id bigint, p_datos jsonb, p_items jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_id bigint := p_id;
  v_bodega public.inv_bodegas;
  v_cambio numeric := greatest(coalesce(nullif(p_datos ->> 'tipo_cambio', '')::numeric, 1), 0.0001);
  v_moneda text := coalesce(nullif(p_datos ->> 'moneda', ''), 'GTQ');
  v_total numeric := 0;
  e jsonb; n int := 0;
  v_cant numeric; v_costo numeric; v_desc numeric; v_sub numeric; v_q numeric;
begin
  if not public.es_personal() then raise exception 'No tienes permiso para esta acción'; end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then raise exception 'Agrega al menos un artículo a la compra'; end if;
  select * into v_bodega from public.inv_bodegas where id = nullif(p_datos ->> 'bodega_id', '')::bigint;
  if v_bodega.id is null or not public.ve_sede(v_bodega.localidad_id) then raise exception 'Elige una bodega de tu sede'; end if;
  if nullif(p_datos ->> 'orden_id', '') is not null and not exists (select 1 from public.inv_ordenes_compra where id = (p_datos ->> 'orden_id')::bigint and estado = 'autorizada' and public.ve_sede(localidad_id)) then
    raise exception 'La orden de compra debe estar Autorizada y ser de tu sede';
  end if;
  if v_id is not null and not exists (select 1 from public.inv_compras where id = v_id and estado = 'grabada' and public.ve_sede(localidad_id)) then
    raise exception 'Solo se puede modificar una compra en estado Grabada (revierte la carga primero)';
  end if;
  if v_id is null then
    insert into public.inv_compras (bodega_id, localidad_id, organizacion_id, estado) values (v_bodega.id, v_bodega.localidad_id, v_bodega.organizacion_id, 'grabada') returning id into v_id;
  end if;
  update public.inv_compras set
    proveedor_id = nullif(p_datos ->> 'proveedor_id', '')::bigint, bodega_id = v_bodega.id,
    fecha = coalesce(nullif(p_datos ->> 'fecha', '')::date, current_date),
    tipo_documento = coalesce(nullif(p_datos ->> 'tipo_documento', ''), 'factura'),
    serie = nullif(trim(p_datos ->> 'serie'), ''), numero_documento = nullif(trim(p_datos ->> 'numero_documento'), ''),
    dias_credito = coalesce(nullif(p_datos ->> 'dias_credito', '')::int, 0), observaciones = nullif(trim(p_datos ->> 'observaciones'), ''),
    moneda = v_moneda, tipo_compra = coalesce(nullif(p_datos ->> 'tipo_compra', ''), 'local'), tipo_cambio = v_cambio,
    no_interno = nullif(trim(p_datos ->> 'no_interno'), ''), orden_compra = nullif(trim(p_datos ->> 'orden_compra'), ''), orden_id = nullif(p_datos ->> 'orden_id', '')::bigint,
    nota_credito = greatest(coalesce(nullif(p_datos ->> 'nota_credito', '')::numeric, 0), 0),
    descuentos = greatest(coalesce(nullif(p_datos ->> 'descuentos', '')::numeric, 0), 0),
    aplica_retencion = coalesce((p_datos ->> 'aplica_retencion')::boolean, false),
    valor_retencion = greatest(coalesce(nullif(p_datos ->> 'valor_retencion', '')::numeric, 0), 0),
    formulario_retencion = nullif(trim(p_datos ->> 'formulario_retencion'), ''),
    regimen_isr = nullif(trim(p_datos ->> 'regimen_isr'), ''), regimen_isr_desc = nullif(trim(p_datos ->> 'regimen_isr_desc'), ''),
    transaccion = nullif(trim(p_datos ->> 'transaccion'), ''), documento_muestras = coalesce((p_datos ->> 'documento_muestras')::boolean, false)
   where id = v_id;
  delete from public.inv_compra_items where compra_id = v_id;
  for e in select * from jsonb_array_elements(p_items) loop
    v_cant := coalesce(nullif(e ->> 'cantidad', '')::numeric, 0);
    v_costo := greatest(coalesce(nullif(e ->> 'costo_unitario', '')::numeric, 0), 0);
    v_desc := greatest(coalesce(nullif(e ->> 'descuento', '')::numeric, 0), 0);
    if v_cant <= 0 then raise exception 'La cantidad de cada artículo debe ser mayor que cero'; end if;
    if nullif(e ->> 'producto_id', '') is null and coalesce(trim(e ->> 'nombre'), '') = '' then raise exception 'Escribe el producto de la línea %', n + 1; end if;
    n := n + 1;
    v_sub := greatest(round(v_cant * v_costo - v_desc, 2), 0);       -- en la moneda de la compra
    v_q := case when v_moneda = 'USD' then round(v_sub * v_cambio, 2) else v_sub end;
    insert into public.inv_compra_items (compra_id, linea, producto_id, codigo, nombre, cantidad, costo_unitario, descuento, subtotal, costo_unitario_mi, subtotal_mi,
                                         lote, fecha_fabricacion, vencimiento, afecta_inventario, controla_fecha)
    values (v_id, n, nullif(e ->> 'producto_id', '')::bigint, nullif(trim(e ->> 'codigo'), ''), nullif(trim(e ->> 'nombre'), ''), v_cant,
            case when v_moneda = 'USD' then round(v_costo * v_cambio, 4) else v_costo end, case when v_moneda = 'USD' then round(v_desc * v_cambio, 2) else v_desc end, v_q,
            case when v_moneda = 'USD' then v_costo else round(v_costo / v_cambio, 4) end, round(v_q / v_cambio, 2),
            nullif(trim(e ->> 'lote'), ''), nullif(e ->> 'fecha_fabricacion', '')::date, nullif(e ->> 'vencimiento', '')::date,
            coalesce((e ->> 'afecta_inventario')::boolean, true), coalesce((e ->> 'controla_fecha')::boolean, false));
    v_total := v_total + v_q;
  end loop;
  v_total := greatest(v_total - (select descuentos + nota_credito from public.inv_compras where id = v_id), 0);
  update public.inv_compras set total = round(v_total, 2), total_usd = round(v_total / v_cambio, 2) where id = v_id;
  return v_id;
end;
$$;

-- ===== Pacientes: tipo de cliente (el mismo catálogo de tipos de precio) =====
alter table public.pacientes add column if not exists tipo_cliente text not null default 'directo';
alter table public.pacientes drop constraint if exists pacientes_tipo_cliente_check;
alter table public.pacientes add constraint pacientes_tipo_cliente_check check (tipo_cliente in ('directo', 'institucional', 'vip', 'referido', 'paquete', 'especial'));

-- PRIMER SUPER ADMINISTRADOR
-- Después de crear tu usuario desde la página (botón «Crear usuario»), ejecuta esta línea
-- cambiando «oliver» por tu nombre de usuario:
--
-- update public.perfiles set rol = 'super_administrador' where usuario = 'oliver';
