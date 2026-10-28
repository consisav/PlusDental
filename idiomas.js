// Plus Dental — Página en Español o Inglés (selector con banderas de Guatemala y Estados Unidos)
//
// Cómo funciona: cada texto de la página pública se busca en la lista EN (español → inglés).
// Si está, se cambia; si no, se queda en español. Los textos del panel de Administración están en idiomas-admin.js.
//
// PARA AGREGAR UN TEXTO NUEVO: escribe una línea con el texto en español a la izquierda
// y su traducción a la derecha, por ejemplo:   'Mi texto nuevo': 'My new text',
(function () {
  var EN = {
    // ---- Página y barra del menú ----
    'Plus Dental — Tratamientos dentales': 'Plus Dental — Dental care',
    'Plus Dental: odontología integral en zona 10, Ciudad de Guatemala. Limpieza, estética, ortodoncia, implantes y endodoncia. Agenda tu cita en línea.':
      'Plus Dental: comprehensive dentistry in Zone 10, Guatemala City. Cleanings, cosmetic dentistry, orthodontics, implants and root canals. Book your appointment online.',
    'PlusDental, servicios dentales en Guatemala · Odontología integral · La tranquilidad también es parte del tratamiento.':
      'PlusDental, dental services in Guatemala · Comprehensive dentistry · Peace of mind is part of the treatment.',
    'PlusDental · Servicios dentales en Guatemala': 'PlusDental · Dental services in Guatemala',
    'ODONTOLOGÍA INTEGRAL': 'COMPREHENSIVE DENTISTRY',
    'La tranquilidad también es parte del tratamiento.': 'Peace of mind is part of the treatment.',
    'Menú': 'Menu',
    'Principal': 'Main',
    'Nosotros': 'About us',
    'Servicios': 'Services',
    'Historias de impacto': 'Impact stories',
    'Administración': 'Administration',
    'Contactarnos': 'Contact us',
    'Programar consulta': 'Book an appointment',
    'Conectarse': 'Sign in',
    'Idioma': 'Language',

    // ---- Portada ----
    'Odontología integral': 'Comprehensive dentistry',
    'Zona 10, Guatemala': 'Zone 10, Guatemala',
    'Una sonrisa sana,': 'A healthy smile,',
    'planificada': 'planned',
    'a tu medida.': 'just for you.',
    'Diagnóstico digital, tratamientos claros y un plan con tiempos y costos definidos desde la primera consulta. Sin sorpresas.':
      'Digital diagnosis, clear treatments and a plan with defined timelines and costs from your very first visit. No surprises.',
    'Encontrar mi tratamiento': 'Find my treatment',
    'Agendar evaluación': 'Book an evaluation',
    'Radiografía digital': 'Digital X-rays',
    'Plan por escrito': 'Written plan',
    'Opciones de pago': 'Payment options',
    'Espacio para fotografía de la clínica': 'Space for a photo of the clinic',
    '[FOTO DE LA CLÍNICA]': '[CLINIC PHOTO]',
    'Asistente inteligente': 'Smart assistant',
    'Cuéntanos qué sientes y te sugerimos el tratamiento adecuado.': 'Tell us how you feel and we will suggest the right treatment.',
    'Probar ahora →': 'Try it now →',
    'Próximo espacio': 'Next available',
    'Consúltanos por WhatsApp': 'Ask us on WhatsApp',

    // ---- Nosotros ----
    'Una clínica que te explica cada paso.': 'A clinic that explains every step.',
    'En Plus Dental atendemos a toda la familia en zona 10 de Ciudad de Guatemala. Trabajamos con diagnóstico digital y te entregamos el plan por escrito, para que sepas qué vamos a hacer, cuánto tiempo toma y cuánto cuesta antes de empezar.':
      'At Plus Dental we care for the whole family in Zone 10, Guatemala City. We work with digital diagnosis and give you a written plan, so you know what we will do, how long it takes and how much it costs before we start.',
    '[HISTORIA DE LA CLÍNICA: AÑO DE FUNDACIÓN Y QUIÉN LA DIRIGE]': '[CLINIC HISTORY: YEAR FOUNDED AND WHO LEADS IT]',
    'Diagnóstico digital': 'Digital diagnosis',
    'Radiografía digital y fotografías clínicas en cada evaluación.': 'Digital X-rays and clinical photos at every evaluation.',
    'Costos claros': 'Clear costs',
    'Presupuesto completo por escrito y opciones de pago.': 'A complete written estimate and payment options.',
    'Atención sin prisas': 'Unhurried care',
    'Citas puntuales y tiempo para resolver tus dudas.': 'On-time appointments and time to answer your questions.',
    'Toda la familia': 'The whole family',
    'Desde odontopediatría hasta implantes, en un solo lugar.': 'From pediatric dentistry to implants, all in one place.',
    'Nuestro equipo': 'Our team',
    'Los odontólogos que te atienden.': 'The dentists who will care for you.',

    // ---- Especialidades de los dentistas ----
    'Odontología general': 'General dentistry',
    'Ortodoncia y ortopedia maxilar': 'Orthodontics and dentofacial orthopedics',
    'Endodoncia': 'Endodontics',
    'Periodoncia': 'Periodontics',
    'Odontopediatría': 'Pediatric dentistry',
    'Prostodoncia': 'Prosthodontics',
    'Rehabilitación oral': 'Oral rehabilitation',
    'Cirugía oral y maxilofacial': 'Oral and maxillofacial surgery',
    'Implantología oral': 'Oral implantology',
    'Odontología estética': 'Cosmetic dentistry',
    'Odontología restauradora': 'Restorative dentistry',
    'Patología y medicina bucal': 'Oral pathology and medicine',
    'Radiología oral y maxilofacial': 'Oral and maxillofacial radiology',
    'Trastornos temporomandibulares y dolor orofacial': 'TMJ disorders and orofacial pain',
    'Odontogeriatría': 'Geriatric dentistry',
    'Odontología para pacientes con necesidades especiales': 'Special needs dentistry',
    'Odontología forense': 'Forensic dentistry',
    'Salud pública bucal': 'Dental public health',
    'Higiene y prevención dental': 'Dental hygiene and prevention',
    'Odontología deportiva': 'Sports dentistry',
    'Odontología láser': 'Laser dentistry',
    'Sedación y anestesia en odontología': 'Sedation and anesthesia in dentistry',

    // ---- Asistente de tratamiento ----
    'Asistente de tratamiento': 'Treatment assistant',
    '¿Qué te gustaría resolver?': 'What would you like to solve?',
    'Elige lo que más se parece a tu caso. Te mostramos el tratamiento más probable, cuánto suele tomar y qué esperar. La confirmación siempre la da el odontólogo en tu evaluación.':
      'Choose what best matches your case. We will show you the most likely treatment, how long it usually takes and what to expect. Your dentist always confirms it at your evaluation.',
    'Dolor o sensibilidad': 'Pain or sensitivity',
    'Quiero dientes más blancos': 'I want whiter teeth',
    'Dientes torcidos': 'Crooked teeth',
    'Me falta una pieza': 'I am missing a tooth',
    'Encías que sangran': 'Bleeding gums',
    'Solo un chequeo': 'Just a checkup',
    'Tratamiento sugerido': 'Suggested treatment',
    'Duración': 'Duration',
    'Citas': 'Visits',
    'Desde': 'From',
    'Q [PRECIO]': 'Q [PRICE]',
    'Agendar': 'Book',
    'Orientativo. Tiempos y costos finales se confirman tras la evaluación clínica.': 'For guidance only. Final timelines and costs are confirmed after the clinical evaluation.',
    'Evaluación de urgencia y endodoncia': 'Emergency evaluation and root canal',
    'Ubicamos la causa del dolor con examen clínico y radiografía digital. Si el nervio está comprometido, el tratamiento de conductos elimina el dolor y conserva tu pieza.':
      'We find the cause of the pain with a clinical exam and digital X-rays. If the nerve is affected, a root canal relieves the pain and saves your tooth.',
    'Blanqueamiento y diseño de sonrisa': 'Whitening and smile design',
    'Aclaramos el tono de tus dientes de forma segura y, si lo deseas, simulamos carillas para ver el resultado antes de comenzar.':
      'We safely brighten the shade of your teeth and, if you wish, we simulate veneers so you can see the result before we begin.',
    'Ortodoncia con alineadores': 'Orthodontics with aligners',
    'Corregimos la posición de tus dientes con alineadores transparentes o brackets estéticos, con un plan digital de cada etapa.':
      'We straighten your teeth with clear aligners or aesthetic braces, with a digital plan for every stage.',
    'Implantes dentales': 'Dental implants',
    'Reponemos piezas perdidas con implantes fijos, planificados con imagen 3D para una colocación precisa y natural.':
      'We replace missing teeth with fixed implants, planned with 3D imaging for precise and natural placement.',
    'Tratamiento de encías': 'Gum treatment',
    'Si tus encías sangran o están inflamadas, una limpieza profunda y control periódico detienen el avance y protegen tus dientes.':
      'If your gums bleed or are swollen, a deep cleaning and regular checkups stop the progression and protect your teeth.',
    'Limpieza y chequeo preventivo': 'Cleaning and preventive checkup',
    'Revisión completa, limpieza profesional y recomendaciones personalizadas. Ideal cada seis meses.':
      'A full checkup, professional cleaning and personalized recommendations. Ideal every six months.',
    'evaluación de urgencia': 'emergency evaluation',
    'estética dental': 'cosmetic dentistry',
    'ortodoncia': 'orthodontics',
    'valoración de implantes': 'implant assessment',
    'periodoncia': 'periodontics',
    'limpieza': 'cleaning',
    'Mensuales': 'Monthly',

    // ---- Servicios ----
    'Todo lo que tu sonrisa necesita, en un solo lugar.': 'Everything your smile needs, in one place.',
    'Ver disponibilidad →': 'See availability →',
    'Limpieza y prevención': 'Cleaning and prevention',
    'Profilaxis, revisión completa y plan de cuidado en casa para evitar problemas antes de que aparezcan.':
      'Prophylaxis, a full checkup and an at-home care plan to prevent problems before they appear.',
    'Estética dental': 'Cosmetic dentistry',
    'Blanqueamiento, carillas y diseño de sonrisa con simulación previa del resultado.': 'Whitening, veneers and smile design with a preview of the result.',
    'Ortodoncia': 'Orthodontics',
    'Alineadores transparentes y brackets estéticos, con seguimiento digital de cada etapa.': 'Clear aligners and aesthetic braces, with digital tracking of every stage.',
    'Reposición fija de piezas perdidas, planificada con imagen 3D para mayor precisión.': 'Fixed replacement of missing teeth, planned with 3D imaging for greater precision.',
    'Tratamiento de conductos para eliminar el dolor y conservar tu pieza natural.': 'Root canal treatment to relieve pain and save your natural tooth.',
    'Atención amable para niños, con enfoque preventivo y un ambiente sin miedo.': 'Gentle care for children, with a preventive focus and a fear-free environment.',

    // ---- Historias de impacto ----
    'Sonrisas que cambiaron una vida.': 'Smiles that changed a life.',
    'Pacientes reales que nos permitieron compartir su experiencia. Toca cualquier foto o video para verlo en grande.':
      'Real patients who allowed us to share their experience. Tap any photo or video to see it full size.',
    'Filtrar historias': 'Filter stories',
    'Muy pronto compartiremos aquí las historias de nuestros pacientes.': 'Soon we will share our patients’ stories here.',
    'Todas': 'All',
    'Videos': 'Videos',
    'Antes y después': 'Before and after',
    'Fotos': 'Photos',
    'Video': 'Video',
    'Foto': 'Photo',
    'Antes': 'Before',
    'Después': 'After',
    'Deslizar para comparar antes y después': 'Slide to compare before and after',
    'Historia anterior': 'Previous story',
    'Historia siguiente': 'Next story',
    'Cerrar': 'Close',
    'Implantes': 'Implants',

    // ---- Cómo trabajamos ----
    'Cómo trabajamos': 'How we work',
    'Cuatro pasos, cero sorpresas.': 'Four steps, zero surprises.',
    'Evaluación': 'Evaluation',
    'Revisión clínica, fotografías y radiografía digital.': 'Clinical exam, photos and digital X-rays.',
    'Plan claro': 'Clear plan',
    'Opciones, tiempos y costo total por escrito antes de empezar.': 'Options, timelines and total cost in writing before we start.',
    'Tratamiento': 'Treatment',
    'Citas puntuales, recordatorios y atención sin prisas.': 'On-time appointments, reminders and unhurried care.',
    'Seguimiento': 'Follow-up',
    'Control posterior y recordatorio de tu próxima limpieza.': 'A follow-up check and a reminder for your next cleaning.',

    // ---- Agenda en línea ----
    'Agenda en línea': 'Online booking',
    'Reserva tu cita en menos de un minuto.': 'Book your appointment in less than a minute.',
    'Elige el servicio, el día y la hora. Te confirmamos por WhatsApp y te enviamos un recordatorio el día anterior.':
      'Choose the service, day and time. We will confirm by WhatsApp and send you a reminder the day before.',
    '¿Prefieres llamar?': 'Prefer to call?',
    'Ver datos de contacto': 'See contact details', '¿Tienes dudas antes de reservar?': 'Questions before booking?', 'Hoy': 'Today',
    '1. Servicio': '1. Service',
    '2. Día': '2. Day',
    '3. Hora': '3. Time',
    'Evaluación general': 'General evaluation',
    'Limpieza': 'Cleaning',
    'Urgencia / dolor': 'Emergency / pain',
    'Estética': 'Cosmetic',
    'Dom': 'Sun', 'Lun': 'Mon', 'Mar': 'Tue', 'Mié': 'Wed', 'Jue': 'Thu', 'Vie': 'Fri', 'Sáb': 'Sat',
    'Ocupado': 'Booked',
    'No quedan horarios libres este día. Elige otro día o escríbenos por WhatsApp.': 'There are no times left on this day. Choose another day or message us on WhatsApp.',
    'Nombre': 'Name',
    'Tu nombre': 'Your name',
    'Confirmar:': 'Confirm:',
    'elige una hora': 'choose a time',
    'Elige una hora libre.': 'Choose an available time.',
    'Escribe tu nombre y tu WhatsApp para registrar la cita.': 'Enter your name and WhatsApp number to book the appointment.',
    'Registrando tu cita…': 'Booking your appointment…',
    'Ese horario se acaba de ocupar. Elige otro, por favor.': 'That time was just taken. Please choose another one.',
    '¡Solicitud recibida!': 'Request received!',
    'Te escribiremos por WhatsApp para confirmar tu cita.': 'We will message you on WhatsApp to confirm your appointment.',
    'Registramos tu solicitud. Te escribiremos por WhatsApp para confirmarla.': 'We have received your request. We will message you on WhatsApp to confirm it.',
    'Enviar también por WhatsApp →': 'Also send by WhatsApp →',
    'Cambiar cita': 'Change appointment',

    // ---- Preguntas frecuentes ----
    'Preguntas frecuentes': 'Frequently asked questions',
    'Ayuda': 'Help',
    'Preguntas': 'FAQ',
    '¿Cuánto cuesta la primera evaluación?': 'How much is the first evaluation?',
    '[PRECIO DE EVALUACIÓN]. Incluye revisión clínica, diagnóstico y un plan de tratamiento por escrito.':
      '[EVALUATION PRICE]. It includes a clinical exam, diagnosis and a written treatment plan.',
    '¿Aceptan seguros o pagos en cuotas?': 'Do you accept insurance or installment payments?',
    '[DETALLE DE SEGUROS Y FINANCIAMIENTO]. Te explicamos todas las opciones antes de iniciar cualquier tratamiento.':
      '[INSURANCE AND FINANCING DETAILS]. We explain all the options before starting any treatment.',
    '¿Atienden urgencias?': 'Do you handle emergencies?',
    '[POLÍTICA DE URGENCIAS]. Si tienes dolor intenso, escríbenos por WhatsApp al +502 3756-5739 para buscarte el espacio más cercano.':
      '[EMERGENCY POLICY]. If you are in severe pain, message us on WhatsApp at +502 3756-5739 and we will find you the earliest opening.',
    '¿Qué pasa si necesito cambiar mi cita?': 'What if I need to change my appointment?',
    'Puedes reprogramar sin costo avisando con al menos [HORAS] horas de anticipación.': 'You can reschedule free of charge with at least [HOURS] hours’ notice.',

    // ---- Contacto y pie ----
    'Estamos en zona 10.': 'We are in Zone 10.',
    'Teléfono y WhatsApp': 'Phone and WhatsApp',
    'Llamar': 'Call',
    'Escribir por WhatsApp': 'Message on WhatsApp',
    'Escribir por WhatsApp a Plus Dental': 'Message Plus Dental on WhatsApp',
    'Dirección': 'Address',
    'Reforma Montúfar, zona 10, Ciudad de Guatemala': 'Reforma Montúfar, Zone 10, Guatemala City',
    'Ver en Google Maps →': 'View on Google Maps →',
    'Horario': 'Hours',
    'Lunes a viernes': 'Monday to Friday',
    '8:00 a. m. – 6:00 p. m.': '8:00 a.m. – 6:00 p.m.',
    'Sábados': 'Saturdays',
    '8:00 a. m. – 12:30 p. m.': '8:00 a.m. – 12:30 p.m.',
    'Ubicación de Plus Dental en Google Maps': 'Plus Dental location on Google Maps',
    'Reforma Montúfar, zona 10, Guatemala': 'Reforma Montúfar, Zone 10, Guatemala',
    'Lun a vie 8:00 a. m. – 6:00 p. m.': 'Mon–Fri 8:00 a.m. – 6:00 p.m.',
    'Sáb 8:00 a. m. – 12:30 p. m.': 'Sat 8:00 a.m. – 12:30 p.m.',

    // ---- Acceso de usuarios ----
    'Acceso': 'Access',
    'Solo personal autorizado': 'Authorized staff only',
    'Tu cuenta': 'Your account',
    'Usuario': 'Username',
    'Clave': 'Password',
    'Ingresar': 'Sign in',
    '¿Olvidaste tu clave? Comunícate con la clínica al +502 3756-5739.': 'Forgot your password? Contact the clinic at +502 3756-5739.',
    '¿Aún no tienes usuario? Crear usuario': 'Don’t have an account yet? Create one',
    'De 3 a 30 caracteres: letras, números, punto, guion o guion bajo, sin espacios': '3 to 30 characters: letters, numbers, period, hyphen or underscore, no spaces',
    'Clave (mínimo 8 caracteres)': 'Password (at least 8 characters)',
    'Confirmar clave': 'Confirm password',
    'Crear usuario': 'Create account',
    'Tu cuenta se crea como Cliente.': 'Your account is created as a Client.',
    'Tu usuario se crea como Cliente.': 'Your account is created as a Client.',
    'Ya tengo usuario, ingresar': 'I already have an account, sign in',
    'Ver usuarios': 'View users',
    'Cambiar mi clave': 'Change my password',
    'Cerrar sesión': 'Sign out',
    'Cambiar clave': 'Change password',
    'Nueva clave (mínimo 8 caracteres)': 'New password (at least 8 characters)',
    'Guardar clave': 'Save password',
    'Cliente': 'Client',
    'Administrador': 'Administrator',
    'Super Administrador': 'Super Administrator',
    'Ingresando…': 'Signing in…',
    'Creando usuario…': 'Creating account…',
    'Guardando…': 'Saving…',
    'Listo. Tu clave se cambió.': 'Done. Your password was changed.',
    'Las dos claves no coinciden.': 'The two passwords do not match.',
    'Usuario o clave incorrectos.': 'Incorrect username or password.',
    'Tu usuario todavía no está activado. Comunícate con la clínica.': 'Your account is not activated yet. Please contact the clinic.',
    'Ese nombre de usuario ya existe. Elige otro o usa «Ingresar».': 'That username already exists. Choose another one or use “Sign in”.',
    'Ese nombre de usuario ya existe. Elige otro o usa «Ya tengo usuario, ingresar».': 'That username already exists. Choose another one or use “I already have an account, sign in”.',
    'Ese nombre de usuario no es válido.': 'That username is not valid.',
    'La clave debe tener al menos 8 caracteres.': 'The password must have at least 8 characters.',
    'La nueva clave debe ser distinta de la actual.': 'The new password must be different from the current one.',
    'Demasiados intentos. Espera unos minutos y vuelve a probar.': 'Too many attempts. Wait a few minutes and try again.',
    'El usuario debe tener de 3 a 30 caracteres: letras, números, punto, guion o guion bajo, sin espacios.': 'The username must have 3 to 30 characters: letters, numbers, period, hyphen or underscore, no spaces.',
    'Tu usuario se creó, pero falta activarlo. Comunícate con la clínica.': 'Your account was created but still needs to be activated. Please contact the clinic.',
    'El registro en línea todavía no está configurado.': 'Online sign-up is not set up yet.',
    'El acceso en línea todavía no está configurado. Comunícate con la clínica al +502 3756-5739.': 'Online access is not set up yet. Contact the clinic at +502 3756-5739.',
    'Tu usuario es de tipo Cliente. Administración es solo para el personal de la clínica.': 'Your account is a Client account. Administration is for clinic staff only.'
  };

  // Traducciones que traen otros programas (p. ej. las preguntas frecuentes de faq.js)
  var extra = window.PD_EN_EXTRA || {};
  Object.keys(extra).forEach(function (k) { if (!Object.prototype.hasOwnProperty.call(EN, k)) EN[k] = extra[k]; });

  // Textos que llevan datos variables (fechas, números, nombres)
  var DIAS = { Dom: 'Sun', Lun: 'Mon', Mar: 'Tue', 'Mié': 'Wed', Jue: 'Thu', Vie: 'Fri', 'Sáb': 'Sat' };
  var MESES = { ene: 'Jan', feb: 'Feb', mar: 'Mar', abr: 'Apr', may: 'May', jun: 'Jun', jul: 'Jul', ago: 'Aug', sep: 'Sep', sept: 'Sep', oct: 'Oct', nov: 'Nov', dic: 'Dec' };
  var ROLES = { 'Super Administrador': 'Super Administrator', 'Administrador': 'Administrator', 'Cliente': 'Client' };
  var M = '(ene|feb|mar|abr|may|jun|jul|ago|sept?|oct|nov|dic)\\.?';
  var REGLAS = [
    [/^(Dom|Lun|Mar|Mié|Jue|Vie|Sáb) (\d{1,2})$/, function (m, d, n) { return DIAS[d] + ' ' + n; }],
    // fechas del panel: «Sáb 17 oct», «17 oct 2026», «14 oct 2026, 09:32»
    [new RegExp('^(Dom|Lun|Mar|Mié|Jue|Vie|Sáb) (\\d{1,2}) ' + M + '$', 'i'), function (m, d, n, mes) { return DIAS[d] + ' ' + MESES[mes.toLowerCase()] + ' ' + n; }],
    [new RegExp('^(\\d{1,2}) ' + M + ' (\\d{4})(,? \\d{1,2}:\\d{2})?$', 'i'), function (m, n, mes, a, h) { return MESES[mes.toLowerCase()] + ' ' + n + ', ' + a + (h ? ', ' + h.replace(/^,? /, '') : ''); }],
    [new RegExp('^(\\d{1,2}) ' + M + '$', 'i'), function (m, n, mes) { return MESES[mes.toLowerCase()] + ' ' + n; }],
    [/^Conectado como (.+?) · (Super Administrador|Administrador|Cliente)\.\s*(.*)$/, function (m, u, r, resto) { return 'Signed in as ' + u + ' · ' + ROLES[r] + '. ' + (simple(resto) || resto); }],
    [/^Presupuesto N\.º (\d+)$/, 'Quote No. $1'],
    [/^Subtotal (.+)$/, 'Subtotal $1'],
    [/^(Lunes|Martes|Miércoles|Jueves|Viernes|Sábado|Domingo): (desde|hasta|abre|cierra)$/, function (m, d, q) {
      var D = { Lunes: 'Monday', Martes: 'Tuesday', 'Miércoles': 'Wednesday', Jueves: 'Thursday', Viernes: 'Friday', 'Sábado': 'Saturday', Domingo: 'Sunday' };
      return D[d] + ': ' + { desde: 'from', hasta: 'until', abre: 'opens', cierra: 'closes' }[q];
    }],
    [/^registrado por (.+)$/, 'registered by $1'],
    [/^última modificación por (.+)$/, 'last modified by $1'],
    [/^máx\. (.+)$/, 'max. $1'],
    [/^(\d+) en tu catálogo$/, '$1 in your catalog'],
    [/^(\d+) sugeridos? por agregar$/, '$1 suggested to add'],
    [/^Comisión (.+)$/, 'Commission $1'],
    [/^Ahorra (.+)$/, 'Save $1'],
    [/^Ahorro (.+)$/, 'Savings $1'],
    [/^Vigente del (.+) al (.+)$/, 'Valid from $1 to $2'],
    [/^Desde el (.+), sin vencimiento$/, 'From $1, no expiry'],
    [/^desc\. máx\. (.+)$/, 'max. disc. $1'],
    [/^(\d+) (tratamientos?|citas?|pacientes?|cobros?|agentes?)$/, function (m, n, p) { var e = { tratamiento: 'treatment', tratamientos: 'treatments', cita: 'appointment', citas: 'appointments', paciente: 'patient', pacientes: 'patients', cobro: 'payment', cobros: 'payments', agente: 'agent', agentes: 'agents' }; return n + ' ' + e[p]; }],
    [/^ANULADO: (.*)$/, 'VOIDED: $1'],
    [/^(\d+) años?$/, function (m, n) { return n + (n === '1' ? ' year' : ' years'); }],
    [/^Registrado por (.+)$/, 'Registered by $1'],
    [/^por (.+)$/, 'by $1'],
    [/^Recibo (N\.º )?(\d+)$/, 'Receipt No. $2'],
    [/^Recibo N\.º (\d+): estado cambiado a (Emitido|Aplicado|Certificado)\.$/, function (m, n, e) { return 'Receipt No. ' + n + ': status changed to ' + { Emitido: 'Issued', Aplicado: 'Applied', Certificado: 'Certified' }[e] + '.'; }],
    [/^Pago registrado con el recibo N\.º (\d+)\. Puedes imprimirlo o enviarlo desde la lista\.$/, 'Payment registered with receipt No. $1. You can print or send it from the list.'],
    [/^Pago registrado con el correlativo (\S+) \(recibo N\.º (\d+)\)\. Puedes imprimirlo o enviarlo desde la lista\.$/, 'Payment registered with sequence No. $1 (receipt No. $2). You can print or send it from the list.'],
    [/^(Factura|Recibo)( [A-Za-z0-9-]+)?$/, function (m, t, n) { return (t === 'Factura' ? 'Invoice' : 'Receipt') + (n || ''); }],
    [/^Cuota (\d+)$/, 'Installment $1'],
    [/^Agenda de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre) (\d{4})$/, function (m, mes, a) {
      return 'Schedule for ' + { enero: 'January', febrero: 'February', marzo: 'March', abril: 'April', mayo: 'May', junio: 'June', julio: 'July', agosto: 'August', septiembre: 'September', octubre: 'October', noviembre: 'November', diciembre: 'December' }[mes] + ' ' + a;
    }],
    [/^\+ (\d+) más$/, '+ $1 more'],
    [/^(\d+) cuotas( de (Q[\d,.]+))?$/, function (m, n, x, v) { return n + ' installments' + (v ? ' of ' + v : ''); }],
    [/^1 pago de (Q[\d,.]+)$/, '1 payment of $1'],
    [/^(\d+) cuotas$/, '$1 installments'],
    [/^1 pago$/, '1 payment'],
    [/^Presupuesto (\d{4,}-\d{4}-\d{3,}-V\d{2,})$/, 'Quote $1'],
    [/^Elegir procedimiento para (\d+) hallazgos? sin procedimiento$/, function (m, n) { return 'Choose a procedure for ' + n + (n === '1' ? ' finding' : ' findings') + ' without one'; }],
    [/^Impreso el (\d{1,2}) (\S+?)\.? (\d{4})(, \d{1,2}:\d{2})?$/, function (m, d, mes, a, h) {
      var M = { ene: 'Jan', feb: 'Feb', mar: 'Mar', abr: 'Apr', may: 'May', jun: 'Jun', jul: 'Jul', ago: 'Aug', sept: 'Sep', sep: 'Sep', oct: 'Oct', nov: 'Nov', dic: 'Dec' };
      return 'Printed on ' + (M[mes.toLowerCase()] || mes) + ' ' + d + ', ' + a + (h || '');
    }],
    [/^Recibido por: (.+)$/, 'Received by: $1'],
    [/^PAGO ANULADO — (.*)$/, 'PAYMENT VOIDED — $1'],
    [/^A favor (Q[\d,.]+)$/, 'In favor $1'],
    [/^(.+) · Comprobante interno$/, '$1 · Internal voucher'],
    [/^(Tipo de procedimiento|Clasificación|Monto en quetzales|Monto en dólares) de la línea (\d+)$/, function (m, c, n) { return { 'Tipo de procedimiento': 'Procedure type', 'Clasificación': 'Classification', 'Monto en quetzales': 'Amount in quetzales', 'Monto en dólares': 'Amount in dollars' }[c] + ' for line ' + n; }],
    [/^(\d{1,2}:\d{2}), ocupado$/, '$1, booked'],
    [/^(\d+(?:–\d+)?) meses$/, '$1 months'],
    [/^1 mes$/, '1 month'],
    [/^(\d+(?:–\d+)?) citas$/, '$1 visits'],
    [/^1 cita$/, '1 visit'],
    [/^(\d+) años de experiencia$/, '$1 years of experience'],
    [/^1 año de experiencia$/, '1 year of experience'],
    [/^Colegiado N\.º (.+)$/, 'License No. $1'],
    [/^Ver video: (.+)$/, 'View video: $1'],
    [/^Ver foto: (.+)$/, 'View photo: $1'],
    [/^Ver antes y después: (.+)$/, 'View before and after: $1'],
    [/^Usuario: (.+)$/, 'Username: $1'],
    [/^No se pudo registrar la cita: (.+)$/, 'The appointment could not be booked: $1'],
    [/^No se pudo completar: (.+)$/, 'Could not complete: $1']
  ];

  var ATRIBUTOS = ['placeholder', 'aria-label', 'alt', 'title'];
  var GUARDADO = 'pd_idioma';
  var idioma = 'es';
  var textoOriginal = new WeakMap(), textoPuesto = new WeakMap();
  var atrOriginal = new WeakMap(), atrPuesto = new WeakMap();
  var meta = document.querySelector('meta[name="description"]');
  var metaEs = meta ? meta.getAttribute('content') : '';

  function simple(t) {
    if (Object.prototype.hasOwnProperty.call(EN, t)) return EN[t];
    for (var i = 0; i < REGLAS.length; i++) {
      var r = REGLAS[i];
      if (r[0].test(t)) return t.replace(r[0], r[1]);
    }
    return null;
  }
  // Traduce un texto completo; si no está en la lista, prueba por partes separadas por « · »
  function traducir(texto) {
    var limpio = texto.replace(/\s+/g, ' ').trim();
    if (!limpio) return null;
    var r = simple(limpio);
    if (r == null && limpio.indexOf(' · ') > 0) {
      var alguna = false;
      var partes = limpio.split(' · ').map(function (p) {
        var x = p ? simple(p) : null;
        if (x != null) { alguna = true; return x; }
        return p;
      });
      if (alguna) r = partes.join(' · ');
    }
    if (r == null && /·$/.test(limpio)) {
      var sin = simple(limpio.replace(/\s*·$/, ''));
      if (sin != null) r = sin + ' ·';
    }
    if (r == null) return null;
    var inicio = texto.match(/^\s*/)[0], fin = texto.match(/\s*$/)[0];
    return inicio + r + fin;
  }

  function excluido(el) { return !el || !!el.closest('script, style, [data-no-traducir]'); }

  function hacerTexto(n) {
    if (excluido(n.parentElement)) return;
    var actual = n.nodeValue;
    // si el programa cambió el texto, el nuevo valor es el original en español
    if (!textoOriginal.has(n) || textoPuesto.get(n) !== actual) textoOriginal.set(n, actual);
    var es = textoOriginal.get(n);
    var nuevo = idioma === 'en' ? (traducir(es) || es) : es;
    textoPuesto.set(n, nuevo);
    if (actual !== nuevo) n.nodeValue = nuevo;
  }
  function hacerAtributos(el) {
    if (excluido(el)) return;
    var orig = atrOriginal.get(el) || {}, puesto = atrPuesto.get(el) || {};
    ATRIBUTOS.forEach(function (a) {
      if (!el.hasAttribute(a)) return;
      var actual = el.getAttribute(a);
      if (!(a in orig) || puesto[a] !== actual) orig[a] = actual;
      var nuevo = idioma === 'en' ? (traducir(orig[a]) || orig[a]) : orig[a];
      puesto[a] = nuevo;
      if (actual !== nuevo) el.setAttribute(a, nuevo);
    });
    atrOriginal.set(el, orig); atrPuesto.set(el, puesto);
  }
  function recorrer(raiz) {
    if (raiz.nodeType === 3) { hacerTexto(raiz); return; }
    if (raiz.nodeType !== 1 || excluido(raiz)) return;
    hacerAtributos(raiz);
    var w = document.createTreeWalker(raiz, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (n.nodeType === 1 && (n.tagName === 'SCRIPT' || n.tagName === 'STYLE' || n.hasAttribute('data-no-traducir'))) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var n;
    while ((n = w.nextNode())) { if (n.nodeType === 3) hacerTexto(n); else hacerAtributos(n); }
  }

  var observador = new MutationObserver(function (cambios) {
    observador.disconnect();
    cambios.forEach(function (c) {
      if (c.type === 'childList') c.addedNodes.forEach(recorrer);
      else if (c.type === 'characterData') hacerTexto(c.target);
      else if (c.type === 'attributes') hacerAtributos(c.target);
    });
    observar();
  });
  function observar() {
    observador.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATRIBUTOS });
  }

  function pintarSelector() {
    document.querySelectorAll('[data-idioma]').forEach(function (b) {
      var on = b.dataset.idioma === idioma;
      b.setAttribute('aria-pressed', on);
      b.classList.toggle('on', on);
    });
  }
  function aplicar(nuevo) {
    idioma = nuevo === 'en' ? 'en' : 'es';
    document.documentElement.lang = idioma;
    if (meta) meta.setAttribute('content', idioma === 'en' ? (EN[metaEs] || metaEs) : metaEs);
    observador.disconnect();
    recorrer(document.head.querySelector('title'));
    recorrer(document.body);
    observar();
    pintarSelector();
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-idioma]');
    if (!b) return;
    aplicar(b.dataset.idioma);
    try { localStorage.setItem(GUARDADO, idioma); } catch (err) { /* sin almacenamiento: solo dura esta visita */ }
  });

  var inicial = 'es';
  try { inicial = localStorage.getItem(GUARDADO) || 'es'; } catch (err) { /* usa español */ }
  aplicar(inicial);

  window.PD_IDIOMA = function () { return idioma; };
})();
