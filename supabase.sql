-- Plus Dental — usuarios y tipos de usuario
-- Ejecutar una sola vez en Supabase: SQL Editor → New query → pegar todo → Run.
-- Se ingresa con nombre de usuario y clave. Supabase exige un correo, así que la página
-- guarda cada usuario como <usuario>@usuarios.plusdental.com (correo interno que nadie recibe).
-- En Authentication → Sign In / Providers → Email, desactivar «Confirm email».

-- Tipos de usuario
create type public.rol_usuario as enum ('cliente', 'administrador', 'super_administrador');

-- Un perfil por cada usuario creado en Supabase Auth
create table public.perfiles (
  id      uuid primary key references auth.users (id) on delete cascade,
  usuario text unique,
  nombre  text,
  correo  text,
  rol     public.rol_usuario not null default 'cliente',
  creado  timestamptz not null default now()
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

create type public.estado_cita as enum ('pendiente', 'confirmada', 'cancelada');

create table public.citas (
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

-- Un solo paciente por horario (las canceladas liberan el espacio)
create unique index citas_un_paciente_por_horario on public.citas (fecha, hora) where estado <> 'cancelada';

alter table public.citas enable row level security;

-- Nombre y teléfono de los pacientes: solo los ve el personal
create policy "personal ve citas" on public.citas for select using (public.es_personal());
create policy "personal actualiza citas" on public.citas for update
  using (public.es_personal()) with check (public.es_personal());

create table public.bloqueos (
  id     bigint generated always as identity primary key,
  fecha  date not null,
  hora   time,            -- vacío = todo el día
  motivo text,
  creado timestamptz not null default now()
);

alter table public.bloqueos enable row level security;

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

-- Horarios de un rango de fechas y si están libres (sin datos de pacientes)
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

create table public.pacientes (
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
create unique index pacientes_dpi_unico on public.pacientes (dpi) where dpi is not null and dpi <> '';

alter table public.pacientes enable row level security;
create policy "personal ve pacientes" on public.pacientes for select using (public.es_personal());
create policy "personal crea pacientes" on public.pacientes for insert with check (public.es_personal());
create policy "personal edita pacientes" on public.pacientes for update
  using (public.es_personal()) with check (public.es_personal());
create policy "super administrador borra pacientes" on public.pacientes for delete using (public.es_super_administrador());

create or replace function public.marcar_actualizado()
returns trigger language plpgsql as $$
begin
  new.actualizado := now();
  return new;
end;
$$;

create trigger pacientes_actualizado before update on public.pacientes
  for each row execute function public.marcar_actualizado();

-- Notas de cada visita
create table public.notas_visita (
  id            bigint generated always as identity primary key,
  paciente_id   bigint not null references public.pacientes (id) on delete cascade,
  fecha         date not null default current_date,
  texto         text not null,
  autor         uuid references auth.users (id) on delete set null,
  autor_usuario text,
  creada        timestamptz not null default now()
);
create index notas_visita_paciente on public.notas_visita (paciente_id, fecha desc);

alter table public.notas_visita enable row level security;
create policy "personal ve notas" on public.notas_visita for select using (public.es_personal());
create policy "personal escribe notas" on public.notas_visita for insert with check (public.es_personal());
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

create trigger notas_visita_firma before insert on public.notas_visita
  for each row execute function public.firmar_nota();

-- Radiografías y fotografías clínicas: almacenamiento privado (máx. 10 MB por archivo)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('expedientes', 'expedientes', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create policy "personal ve archivos de expedientes" on storage.objects for select
  using (bucket_id = 'expedientes' and public.es_personal());
create policy "personal sube archivos de expedientes" on storage.objects for insert
  with check (bucket_id = 'expedientes' and public.es_personal());
create policy "super administrador borra archivos de expedientes" on storage.objects for delete
  using (bucket_id = 'expedientes' and public.es_super_administrador());

-- ===== Presupuestos =====
-- Precios con IVA incluido. El costo se carga a la cuenta del paciente cuando cada tratamiento
-- de un presupuesto aprobado se marca como realizado.

-- Catálogo de tratamientos con precio base
create table public.tratamientos (
  id     bigint generated always as identity primary key,
  nombre text not null,
  precio numeric(10,2) not null default 0 check (precio >= 0),
  activo boolean not null default true,
  creado timestamptz not null default now()
);
create unique index tratamientos_nombre_unico on public.tratamientos (lower(nombre));
alter table public.tratamientos enable row level security;
create policy "personal ve tratamientos" on public.tratamientos for select using (public.es_personal());
create policy "personal crea tratamientos" on public.tratamientos for insert with check (public.es_personal());
create policy "personal edita tratamientos" on public.tratamientos for update
  using (public.es_personal()) with check (public.es_personal());

create type public.estado_presupuesto as enum ('borrador', 'enviado', 'aprobado', 'rechazado');

create table public.presupuestos (
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
create index presupuestos_paciente on public.presupuestos (paciente_id);
alter table public.presupuestos enable row level security;
create policy "personal ve presupuestos" on public.presupuestos for select using (public.es_personal());
create policy "personal crea presupuestos" on public.presupuestos for insert with check (public.es_personal());
create policy "personal edita presupuestos" on public.presupuestos for update
  using (public.es_personal()) with check (public.es_personal());
create policy "super administrador borra presupuestos no aprobados" on public.presupuestos for delete
  using (public.es_super_administrador() and estado <> 'aprobado');

create table public.presupuesto_items (
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
create index presupuesto_items_presupuesto on public.presupuesto_items (presupuesto_id);
alter table public.presupuesto_items enable row level security;
-- Se leen directo; se escriben solo con las funciones de abajo, que validan el estado
create policy "personal ve items" on public.presupuesto_items for select using (public.es_personal());

-- Quién creó el presupuesto
create or replace function public.firmar_presupuesto()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.creado_por := (select usuario from public.perfiles where id = auth.uid());
  return new;
end;
$$;
create trigger presupuestos_firma before insert on public.presupuestos
  for each row execute function public.firmar_presupuesto();

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
create trigger presupuestos_cambio before update on public.presupuestos
  for each row execute function public.antes_de_cambiar_presupuesto();

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

-- PRIMER SUPER ADMINISTRADOR
-- Después de crear tu usuario desde la página (botón «Crear usuario»), ejecuta esta línea
-- cambiando «oliver» por tu nombre de usuario:
--
-- update public.perfiles set rol = 'super_administrador' where usuario = 'oliver';
