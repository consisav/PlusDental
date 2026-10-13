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

-- PRIMER SUPER ADMINISTRADOR
-- Después de crear tu usuario desde la página (botón «Crear usuario»), ejecuta esta línea
-- cambiando «oliver» por tu nombre de usuario:
--
-- update public.perfiles set rol = 'super_administrador' where usuario = 'oliver';
