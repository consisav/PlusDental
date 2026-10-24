// Plus Dental — Preguntas frecuentes: preguntas y respuestas de tratamientos dentales por tema,
// con buscador inteligente (entiende sinónimos y frases como «me duele una muela con lo frío»).
// Cada pregunta tiene su versión en inglés para el selector de idioma (idiomas.js la usa).
(function () {
  var WHATSAPP = '50237565739';
  var VISIBLES = 8;

  var TEMAS = [
    ['visita', 'Primera visita', 'First visit'], ['limpieza', 'Limpieza', 'Cleaning'], ['estetica', 'Estética', 'Cosmetic'],
    ['ortodoncia', 'Ortodoncia', 'Orthodontics'], ['implantes', 'Implantes', 'Implants'], ['endodoncia', 'Endodoncia', 'Endodontics'],
    ['ninos', 'Niños', 'Children'], ['encias', 'Encías', 'Gums'], ['urgencias', 'Urgencias', 'Emergencies'], ['cuidados', 'Cuidados', 'Aftercare']
  ];

  // [tema, pregunta, respuesta, consejos, palabras clave, pregunta EN, respuesta EN, consejos EN]
  var FAQ = [
    ['visita', '¿Qué incluye la primera consulta?',
      'Revisamos dientes, encías y mordida, tomamos fotografías clínicas y, si hace falta, una radiografía digital. Al final te explicamos el diagnóstico con calma y te entregamos un plan por escrito con opciones, tiempos y costos.',
      ['Trae la lista de medicamentos que tomas', 'Avísanos si tienes alergias o estás embarazada', 'Llega 10 minutos antes'],
      'primera vez consulta evaluacion revision diagnostico plan incluye',
      'What does the first visit include?',
      'We examine your teeth, gums and bite, take clinical photos and, if needed, a digital X-ray. At the end we calmly explain the diagnosis and give you a written plan with options, timelines and costs.',
      ['Bring a list of the medicines you take', 'Let us know if you have allergies or are pregnant', 'Arrive 10 minutes early']],
    ['visita', '¿Cuánto cuesta la primera evaluación?',
      '[PRECIO DE EVALUACIÓN]. Incluye revisión clínica, diagnóstico y un plan de tratamiento por escrito.', [],
      'precio costo cuanto vale cobran evaluacion consulta',
      'How much is the first evaluation?', '[EVALUATION PRICE]. It includes a clinical exam, diagnosis and a written treatment plan.', []],
    ['visita', '¿Aceptan seguros o pagos en cuotas?',
      '[DETALLE DE SEGUROS Y FINANCIAMIENTO]. Te explicamos todas las opciones antes de iniciar cualquier tratamiento.', [],
      'seguro aseguradora cuotas financiamiento pagos tarjeta credito',
      'Do you accept insurance or installment payments?', '[INSURANCE AND FINANCING DETAILS]. We explain all the options before starting any treatment.', []],
    ['visita', '¿Qué pasa si necesito cambiar mi cita?',
      'Puedes reprogramar sin costo avisando con al menos [HORAS] horas de anticipación.', [],
      'cambiar cita reprogramar cancelar mover horario',
      'What if I need to change my appointment?', 'You can reschedule free of charge with at least [HOURS] hours’ notice.', []],
    ['visita', '¿Cada cuánto debo ir al dentista?',
      'Lo ideal es una revisión y limpieza cada seis meses. Si tienes problemas de encías, usas ortodoncia o tienes facilidad para las caries, tu odontólogo puede recomendarte controles cada tres o cuatro meses.', [],
      'cada cuanto frecuencia revision control chequeo seis meses',
      'How often should I see the dentist?',
      'Ideally, a checkup and cleaning every six months. If you have gum problems, wear braces or get cavities easily, your dentist may recommend checkups every three or four months.', []],
    ['visita', 'Tengo miedo al dentista, ¿qué pueden hacer por mí?',
      'Es más común de lo que crees. Te explicamos cada paso antes de hacerlo, usamos anestesia local eficaz y acordamos una señal para hacer pausas cuando lo necesites. Podemos empezar con citas cortas y, en casos especiales, el odontólogo puede valorar opciones de sedación.',
      ['Cuéntanos tu temor desde la primera cita', 'Pide que te expliquen cada paso', 'Agenda en horarios en que no tengas prisa'],
      'miedo nervios ansiedad panico temor fobia sedacion dormir',
      'I am afraid of the dentist. What can you do for me?',
      'It is more common than you think. We explain every step before doing it, use effective local anesthesia and agree on a signal so you can pause whenever you need. We can start with short visits and, in special cases, the dentist can consider sedation options.',
      ['Tell us about your fear from the first visit', 'Ask us to explain each step', 'Book at times when you are not in a hurry']],
    ['visita', '¿Puedo atenderme si estoy embarazada?',
      'Sí. Las limpiezas y los tratamientos necesarios suelen poder hacerse con seguridad, idealmente en el segundo trimestre. Las radiografías se toman solo si son indispensables y con protección. Avísanos siempre que estés embarazada.', [],
      'embarazo embarazada gestacion bebe trimestre lactancia',
      'Can I be treated if I am pregnant?',
      'Yes. Cleanings and necessary treatments can usually be done safely, ideally in the second trimester. X-rays are taken only when essential and with protection. Always let us know if you are pregnant.', []],

    ['limpieza', '¿Qué es una limpieza dental profesional?',
      'Es la eliminación de la placa y el sarro que el cepillo no logra quitar, seguida de un pulido de los dientes y una revisión de las encías. Dura unos 45 minutos y, por lo general, no duele.', [],
      'limpieza profilaxis sarro placa pulido tartaro',
      'What is a professional dental cleaning?',
      'It removes the plaque and tartar that a toothbrush cannot, followed by polishing and a gum check. It takes about 45 minutes and is usually painless.', []],
    ['limpieza', '¿La limpieza desgasta o blanquea los dientes?',
      'No desgasta el esmalte. Quita las manchas superficiales del café, el té o el tabaco, por eso los dientes se ven más claros, pero no cambia su color natural; para eso existe el blanqueamiento.', [],
      'limpieza desgasta esmalte blanquea manchas cafe',
      'Does a cleaning wear down or whiten my teeth?',
      'It does not wear down the enamel. It removes surface stains from coffee, tea or tobacco, so teeth look brighter, but it does not change their natural shade; whitening does that.', []],
    ['limpieza', '¿Cómo debo cepillarme correctamente?',
      'Cepíllate al menos dos veces al día durante dos minutos, con un cepillo suave y pasta con flúor. Inclina el cepillo hacia la encía y haz movimientos cortos y suaves. Limpia entre los dientes a diario.',
      ['Usa hilo dental o cepillos interdentales cada día', 'Cambia el cepillo cada tres meses', 'No olvides limpiar la lengua'],
      'cepillar cepillado tecnica hilo dental pasta fluor higiene',
      'How should I brush properly?',
      'Brush at least twice a day for two minutes with a soft brush and fluoride toothpaste. Angle the brush toward the gums and use short, gentle strokes. Clean between your teeth every day.',
      ['Use floss or interdental brushes daily', 'Replace your toothbrush every three months', 'Do not forget to clean your tongue']],
    ['limpieza', '¿Por qué tengo mal aliento?',
      'En la mayoría de los casos el origen está en la boca: placa en la lengua o entre los dientes, encías inflamadas, caries o boca seca. Limpiar la lengua y usar hilo dental ayuda mucho; si persiste, conviene una revisión.', [],
      'mal aliento halitosis olor boca seca',
      'Why do I have bad breath?',
      'In most cases it starts in the mouth: plaque on the tongue or between the teeth, inflamed gums, cavities or dry mouth. Cleaning your tongue and flossing help a lot; if it persists, a checkup is a good idea.', []],
    ['limpieza', '¿Por qué me duelen los dientes con lo frío?',
      'La sensibilidad suele deberse a esmalte desgastado, encías retraídas o una caries que se acerca al nervio. Si el dolor dura más de unos segundos, aparece solo o te despierta, conviene revisarlo pronto.',
      ['Usa pasta para dientes sensibles', 'Evita cepillarte con fuerza', 'Agenda una evaluación si continúa'],
      'sensibilidad sensible frio caliente helado duele dolor diente muela',
      'Why do my teeth hurt with cold drinks?',
      'Sensitivity is usually caused by worn enamel, receding gums or a cavity close to the nerve. If the pain lasts more than a few seconds, appears on its own or wakes you up, have it checked soon.',
      ['Use toothpaste for sensitive teeth', 'Avoid brushing hard', 'Book an evaluation if it continues']],

    ['estetica', '¿El blanqueamiento dental daña el esmalte?',
      'Hecho bajo supervisión profesional es seguro y no daña el esmalte. Puede causar sensibilidad pasajera durante unos días. No aclara coronas, carillas ni resinas, por eso lo evaluamos antes.', [],
      'blanqueamiento blanquear dientes blancos amarillos danio esmalte',
      'Does teeth whitening damage the enamel?',
      'Done under professional supervision it is safe and does not damage the enamel. It may cause temporary sensitivity for a few days. It does not lighten crowns, veneers or fillings, so we evaluate first.', []],
    ['estetica', '¿Cuánto dura el blanqueamiento?',
      'Generalmente de uno a tres años, según tus hábitos. El café, el té, el vino y el tabaco lo oscurecen más rápido. Un retoque ocasional mantiene el resultado.', [],
      'blanqueamiento dura duracion cuanto tiempo retoque',
      'How long does whitening last?',
      'Usually one to three years, depending on your habits. Coffee, tea, wine and tobacco darken teeth faster. An occasional touch-up keeps the result.', []],
    ['estetica', '¿Qué son las carillas y cuánto duran?',
      'Son láminas delgadas de porcelana o resina que se adhieren al frente de los dientes para mejorar su forma, color y alineación. Las de porcelana pueden durar de 10 a 15 años con buenos cuidados; las de resina, de 5 a 7.', [],
      'carillas porcelana resina laminas sonrisa forma color',
      'What are veneers and how long do they last?',
      'They are thin layers of porcelain or composite bonded to the front of the teeth to improve shape, color and alignment. Porcelain veneers can last 10 to 15 years with good care; composite ones, 5 to 7.', []],
    ['estetica', '¿Qué es el diseño de sonrisa?',
      'Es la planificación de tu nueva sonrisa con fotografías y simulación digital, para que veas el resultado antes de empezar. Puede combinar blanqueamiento, carillas, ajuste de encías u ortodoncia.', [],
      'diseno sonrisa simulacion digital estetica cambio',
      'What is smile design?',
      'It is the planning of your new smile with photos and a digital simulation, so you can see the result before starting. It may combine whitening, veneers, gum contouring or orthodontics.', []],

    ['ortodoncia', '¿Brackets o alineadores transparentes?',
      'Ambos corrigen la posición de los dientes. Los alineadores son casi invisibles y removibles, pero deben usarse de 20 a 22 horas al día. Los brackets son fijos y resuelven muy bien los casos complejos. En la evaluación te recomendamos el más adecuado.', [],
      'brackets frenos alineadores invisalign transparentes ortodoncia dientes torcidos chuecos',
      'Braces or clear aligners?',
      'Both straighten teeth. Aligners are nearly invisible and removable, but must be worn 20 to 22 hours a day. Braces are fixed and handle complex cases very well. At the evaluation we recommend the best option for you.', []],
    ['ortodoncia', '¿Cuánto dura un tratamiento de ortodoncia?',
      'Normalmente entre 6 y 24 meses, según la complejidad del caso. Los casos leves pueden resolverse en pocos meses. Cumplir las citas y las indicaciones acorta el tiempo.', [],
      'ortodoncia brackets alineadores dura duracion meses tiempo',
      'How long does orthodontic treatment take?',
      'Usually between 6 and 24 months, depending on how complex the case is. Mild cases can be solved in a few months. Keeping appointments and following instructions shortens the time.', []],
    ['ortodoncia', '¿Hay edad límite para la ortodoncia?',
      'No. Los adultos con encías sanas pueden tratarse sin problema. En los niños recomendamos una primera evaluación alrededor de los 7 años para detectar problemas a tiempo.', [],
      'ortodoncia edad adultos mayor limite brackets',
      'Is there an age limit for orthodontics?',
      'No. Adults with healthy gums can be treated without problems. For children we recommend a first evaluation around age 7 to catch problems early.', []],
    ['ortodoncia', '¿Por qué debo usar retenedores?',
      'Al terminar, los dientes tienden a volver a su posición anterior. El retenedor, generalmente de noche, conserva el resultado. Úsalo tal como te indique tu odontólogo.', [],
      'retenedor retenedores despues ortodoncia volver mover',
      'Why do I need to wear retainers?',
      'After treatment, teeth tend to move back. A retainer, usually worn at night, keeps the result. Wear it exactly as your dentist recommends.', []],
    ['ortodoncia', '¿Duele la ortodoncia?',
      'Es normal sentir una molestia leve los primeros días y después de cada ajuste o cambio de alineador. Una dieta blanda y un analgésico común suelen ser suficientes.', [],
      'ortodoncia duele dolor molestia brackets ajuste',
      'Do braces hurt?',
      'It is normal to feel mild discomfort for the first few days and after each adjustment or new aligner. A soft diet and a common pain reliever are usually enough.', []],

    ['implantes', '¿Qué es un implante dental?',
      'Es una pequeña pieza de titanio que se coloca en el hueso y reemplaza la raíz de un diente perdido. Sobre ella se fija una corona que se ve, se siente y funciona como un diente natural.', [],
      'implante implantes titanio diente perdido falta pieza reemplazar',
      'What is a dental implant?',
      'It is a small titanium post placed in the bone that replaces the root of a missing tooth. A crown is attached on top that looks, feels and works like a natural tooth.', []],
    ['implantes', '¿La colocación de un implante duele?',
      'Se realiza con anestesia local, así que durante el procedimiento no sientes dolor. Después puede haber molestia o inflamación leve unos días, que se controla con los medicamentos indicados.', [],
      'implante duele dolor colocacion cirugia anestesia',
      'Does getting an implant hurt?',
      'It is done under local anesthesia, so you feel no pain during the procedure. Afterwards there may be mild discomfort or swelling for a few days, controlled with the prescribed medication.', []],
    ['implantes', '¿Cuánto tiempo toma el tratamiento con implantes?',
      'El implante necesita de 3 a 6 meses para unirse al hueso antes de colocar la corona definitiva. En algunos casos se puede poner un diente provisional el mismo día. Si falta hueso, puede requerirse un injerto previo.', [],
      'implante tiempo cuanto dura meses provisional injerto hueso',
      'How long does implant treatment take?',
      'The implant needs 3 to 6 months to bond with the bone before the final crown is placed. In some cases a temporary tooth can be placed the same day. If bone is lacking, a graft may be needed first.', []],
    ['implantes', '¿Cualquier persona puede tener implantes?',
      'La mayoría de los adultos sí. Evaluamos la cantidad de hueso, la salud de las encías y la salud general. Condiciones como la diabetes deben estar controladas, y fumar reduce el éxito del implante.', [],
      'implante candidato requisitos diabetes fumar hueso salud',
      'Can anyone get implants?',
      'Most adults can. We evaluate bone volume, gum health and overall health. Conditions such as diabetes must be under control, and smoking lowers the success rate.', []],
    ['implantes', '¿Cuánto dura un implante?',
      'Con buena higiene y controles periódicos, un implante puede durar muchos años e incluso toda la vida. La corona puede necesitar cambio con el tiempo por el desgaste normal.', [],
      'implante dura duracion vida corona',
      'How long does an implant last?',
      'With good hygiene and regular checkups, an implant can last many years and even a lifetime. The crown may need replacing over time due to normal wear.', []],

    ['endodoncia', '¿Qué es un tratamiento de conductos?',
      'Es el procedimiento que retira el nervio inflamado o infectado del interior del diente, limpia los conductos y los sella. Así se elimina el dolor y se conserva tu diente natural.', [],
      'endodoncia conductos nervio matar nervio infeccion',
      'What is a root canal treatment?',
      'It removes the inflamed or infected nerve from inside the tooth, cleans the canals and seals them. This eliminates the pain and saves your natural tooth.', []],
    ['endodoncia', '¿El tratamiento de conductos duele?',
      'Con la anestesia actual se siente muy parecido a una restauración común. De hecho, alivia el dolor que causa el nervio. Puede quedar una molestia leve dos o tres días.', [],
      'endodoncia conductos duele dolor anestesia',
      'Does a root canal hurt?',
      'With modern anesthesia it feels very much like a regular filling. In fact, it relieves the pain caused by the nerve. Mild discomfort may last two or three days.', []],
    ['endodoncia', '¿Necesito una corona después de la endodoncia?',
      'En las muelas casi siempre se recomienda, porque el diente queda más frágil y podría fracturarse al masticar. En los dientes de adelante depende de cuánto diente sano quede.', [],
      'corona despues endodoncia conductos fractura muela',
      'Do I need a crown after a root canal?',
      'For molars it is almost always recommended, because the tooth becomes more fragile and could break when chewing. For front teeth it depends on how much healthy tooth remains.', []],
    ['endodoncia', '¿Cómo sé si necesito una endodoncia?',
      'Algunas señales son dolor intenso que late, dolor que te despierta en la noche, sensibilidad al calor o al frío que no se quita, encía inflamada o un diente oscurecido. Solo la evaluación con radiografía lo confirma.', [],
      'senales sintomas dolor late noche despierta muela diente oscuro nervio',
      'How do I know if I need a root canal?',
      'Some signs are intense throbbing pain, pain that wakes you at night, lingering sensitivity to heat or cold, swollen gums or a darkened tooth. Only an evaluation with an X-ray can confirm it.', []],

    ['ninos', '¿A qué edad debe ir mi hijo al dentista por primera vez?',
      'Cuando le salga el primer diente o, a más tardar, antes de cumplir un año. Las primeras visitas son cortas y ayudan a que se familiarice con el consultorio sin miedo.', [],
      'nino hijo bebe primera vez edad dentista infantil',
      'When should my child first see the dentist?',
      'When the first tooth appears or, at the latest, before their first birthday. The first visits are short and help them get used to the office without fear.', []],
    ['ninos', '¿Los dientes de leche importan si se van a caer?',
      'Sí. Sirven para masticar y hablar bien, y guardan el espacio para los dientes permanentes. Una caries en un diente de leche puede doler, infectarse y afectar al diente que viene.', [],
      'dientes leche temporales nino caries importan',
      'Do baby teeth matter if they will fall out?',
      'Yes. They help children chew and speak properly and hold space for the permanent teeth. A cavity in a baby tooth can hurt, get infected and affect the tooth underneath.', []],
    ['ninos', '¿Qué son los selladores dentales?',
      'Son una capa protectora que se aplica en los surcos de las muelas, donde suelen empezar las caries. Es rápido, no duele y se recomienda cuando salen las muelas permanentes.', [],
      'selladores sellantes ninos muelas caries prevencion',
      'What are dental sealants?',
      'They are a protective coating applied to the grooves of the molars, where cavities often start. It is quick, painless and recommended when the permanent molars come in.', []],
    ['ninos', '¿Cuánta pasta dental debe usar un niño?',
      'Menores de 3 años: una cantidad como un grano de arroz, con flúor. De 3 a 6 años: como un chícharo. Supervisa el cepillado hasta los 7 u 8 años.', [],
      'pasta dental nino cantidad fluor cepillado bebe',
      'How much toothpaste should a child use?',
      'Under 3 years: an amount the size of a grain of rice, with fluoride. Ages 3 to 6: the size of a pea. Supervise brushing until age 7 or 8.', []],

    ['encias', '¿Por qué me sangran las encías?',
      'Casi siempre es gingivitis, una inflamación causada por la placa acumulada. Se corrige con una limpieza profesional y buena higiene diaria. Si no mejora, puede ser periodontitis y necesita tratamiento.', [],
      'encias sangran sangrado gingivitis inflamadas rojas',
      'Why do my gums bleed?',
      'It is almost always gingivitis, an inflammation caused by plaque buildup. It is corrected with a professional cleaning and good daily hygiene. If it does not improve, it may be periodontitis and needs treatment.', []],
    ['encias', '¿Qué es la periodontitis?',
      'Es una infección de las encías que destruye el hueso que sostiene los dientes. Puede causar retracción de encías, mal aliento y dientes flojos. Se trata con limpieza profunda y controles cada tres o cuatro meses.', [],
      'periodontitis piorrea dientes flojos hueso encias retraidas',
      'What is periodontitis?',
      'It is a gum infection that destroys the bone that supports the teeth. It can cause receding gums, bad breath and loose teeth. It is treated with deep cleaning and checkups every three or four months.', []],
    ['encias', '¿Fumar afecta mis encías?',
      'Sí. Fumar aumenta el riesgo de enfermedad de las encías, retrasa la cicatrización y puede ocultar el sangrado, que es una señal de alerta. Dejar de fumar mejora mucho los resultados de cualquier tratamiento.', [],
      'fumar tabaco cigarro encias cicatrizacion',
      'Does smoking affect my gums?',
      'Yes. Smoking increases the risk of gum disease, slows healing and can hide bleeding, which is a warning sign. Quitting greatly improves the results of any treatment.', []],

    ['urgencias', '¿Atienden urgencias?',
      '[POLÍTICA DE URGENCIAS]. Si tienes dolor intenso, escríbenos por WhatsApp al +502 3756-5739 para buscarte el espacio más cercano.', [],
      'urgencia urgencias emergencia atienden dolor intenso hoy',
      'Do you handle emergencies?', '[EMERGENCY POLICY]. If you are in severe pain, message us on WhatsApp at +502 3756-5739 and we will find you the earliest opening.', []],
    ['urgencias', '¿Qué hago si se me cae o se rompe un diente por un golpe?',
      'Si se cayó un diente permanente, tómalo por la corona sin tocar la raíz, enjuágalo sin frotar y llévalo en leche o en tu propia saliva. Acude de inmediato: en la primera hora hay más posibilidades de salvarlo. Si se rompió, guarda el fragmento.',
      ['No lo limpies con jabón ni lo dejes secar', 'Llámanos o escríbenos por WhatsApp de camino', 'Los dientes de leche no se vuelven a colocar'],
      'golpe roto rompio quebro cayo diente accidente caida fractura',
      'What should I do if a tooth is knocked out or broken?',
      'If a permanent tooth was knocked out, hold it by the crown without touching the root, rinse it without rubbing and carry it in milk or your own saliva. Come in right away: within the first hour there is a better chance of saving it. If it broke, keep the fragment.',
      ['Do not clean it with soap or let it dry', 'Call or message us on WhatsApp on your way', 'Baby teeth are not put back in place']],
    ['urgencias', 'Tengo la cara hinchada y dolor de muela, ¿qué hago?',
      'Puede ser una infección y requiere atención pronto: contáctanos de inmediato. Si tienes fiebre alta, dificultad para tragar o para respirar, acude a una emergencia hospitalaria sin esperar.', [],
      'hinchada hinchazon inflamada cara absceso infeccion pus fiebre dolor muela',
      'My face is swollen and my tooth hurts. What should I do?',
      'It may be an infection and needs prompt care: contact us right away. If you have a high fever or trouble swallowing or breathing, go to a hospital emergency room without waiting.', []],
    ['urgencias', '¿Qué puedo hacer para el dolor de muela mientras llego?',
      'Puedes tomar el analgésico de venta libre que usas normalmente, siguiendo las indicaciones del empaque, y aplicar frío por fuera de la mejilla. No coloques aspirina sobre la encía porque la quema. Agenda tu evaluación lo antes posible.', [],
      'dolor muela diente duele mucho calmar analgesico pastilla mientras',
      'What can I do for a toothache until I get there?',
      'You can take the over-the-counter pain reliever you normally use, following the package directions, and apply cold to the outside of your cheek. Do not put aspirin on the gum because it burns it. Book your evaluation as soon as possible.', []],

    ['cuidados', '¿Qué cuidados tengo después de una extracción?',
      'Muerde la gasa de 30 a 45 minutos. Durante 48 horas no escupas, no uses pajilla y no fumes, para no desprender el coágulo. Come alimentos blandos y fríos y, desde el día siguiente, haz enjuagues suaves con agua tibia y sal.',
      ['Duerme con la cabeza un poco elevada', 'Evita el ejercicio intenso dos días', 'Llámanos si el sangrado o el dolor aumentan'],
      'extraccion sacar muela despues cuidados coagulo comer sangrado cordal',
      'How should I care for myself after an extraction?',
      'Bite on the gauze for 30 to 45 minutes. For 48 hours do not spit, use a straw or smoke, so the clot is not dislodged. Eat soft, cold foods and, from the next day, rinse gently with warm salt water.',
      ['Sleep with your head slightly raised', 'Avoid intense exercise for two days', 'Call us if bleeding or pain increases']],
    ['cuidados', '¿Cuándo puedo comer después de una resina (calza)?',
      'La resina queda firme al terminar la cita, así que puedes comer en cuanto pase el efecto de la anestesia. Espera a recuperar la sensibilidad para no morderte la mejilla o la lengua.', [],
      'resina calza relleno empaste comer despues anestesia',
      'When can I eat after a filling?',
      'A composite filling is set by the end of the visit, so you can eat as soon as the anesthesia wears off. Wait until feeling returns so you do not bite your cheek or tongue.', []],
    ['cuidados', '¿Las muelas del juicio siempre se deben sacar?',
      'No. Solo se extraen si causan dolor, infecciones, caries, falta de espacio o daño al diente vecino. Lo evaluamos con una radiografía para decidir si conviene retirarlas.', [],
      'muelas juicio cordales sacar extraer siempre',
      'Do wisdom teeth always need to come out?',
      'No. They are removed only if they cause pain, infections, cavities, crowding or damage to the neighboring tooth. We evaluate them with an X-ray to decide whether removal is advisable.', []]
  ];

  // Textos de la sección y traducciones para el selector de idioma (idiomas.js las agrega a su lista)
  var EN = window.PD_EN_EXTRA = window.PD_EN_EXTRA || {};
  TEMAS.forEach(function (t) { EN[t[1]] = t[2]; });
  FAQ.forEach(function (f) { EN[f[1]] = f[5]; EN[f[2]] = f[6]; f[3].forEach(function (c, i) { EN[c] = f[7][i]; }); });
  [['Resolvemos tus dudas antes de tu cita.', 'We answer your questions before your visit.'],
   ['Escribe tu duda o elige un tema. Te mostramos la respuesta más adecuada, explicada de forma sencilla.', 'Type your question or choose a topic. We show you the most relevant answer, explained simply.'],
   ['Escribe tu duda, por ejemplo: me duele una muela con lo frío', 'Type your question, for example: my tooth hurts with cold drinks'],
   ['Buscar en preguntas frecuentes', 'Search frequently asked questions'],
   ['Buscar respuesta', 'Find answer'], ['Temas', 'Topics'], ['Mejor respuesta', 'Best answer'], ['Pregunta destacada', 'Featured question'],
   ['Recomendaciones', 'Recommendations'], ['Agendar evaluación →', 'Book an evaluation →'],
   ['Preguntas relacionadas', 'Related questions'], ['Más preguntas', 'More questions'], ['Ver más preguntas', 'See more questions'],
   ['No encontramos una respuesta exacta a tu pregunta.', 'We could not find an exact answer to your question.'],
   ['Pregúntanos por WhatsApp →', 'Ask us on WhatsApp →'], ['Limpiar búsqueda', 'Clear search'],
   ['✦ Respuesta con IA', '✦ AI answer'], ['No estaba en nuestras preguntas frecuentes', 'It was not in our FAQ'],
   ['Buscando una respuesta con IA…', 'Looking for an answer with AI…'], ['Preguntar por WhatsApp', 'Ask on WhatsApp'],
   ['Información general generada por inteligencia artificial. No sustituye la evaluación de un odontólogo.', 'General information generated by artificial intelligence. It does not replace an evaluation by a dentist.'],
   ['Solo podemos responder dudas sobre salud dental y nuestros tratamientos. Escríbenos por WhatsApp si necesitas algo más.', 'We can only answer questions about dental health and our treatments. Message us on WhatsApp if you need something else.'],
   ['Ahora no pudimos consultar la respuesta con IA. Escríbenos por WhatsApp y te respondemos.', 'We could not get an AI answer right now. Message us on WhatsApp and we will reply.'],
   ['Llegaste al límite de preguntas con IA por hoy. Escríbenos por WhatsApp y te respondemos.', 'You reached today’s limit of AI questions. Message us on WhatsApp and we will reply.'],
   ['Información general orientativa. Tu odontólogo confirma el diagnóstico y el tratamiento en la evaluación.', 'General guidance only. Your dentist confirms the diagnosis and treatment at your evaluation.']
  ].forEach(function (p) { EN[p[0]] = p[1]; });

  function $(id) { return document.getElementById(id); }
  if (!$('faqLista')) return;
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ---------- Buscador inteligente ----------
  function normal(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ\s]/g, ' '); }
  var VACIAS = 'a al algo como con cual cuales cuando de del el ella en es esta este hay la las le lo los me mi mis muy no o para pero por que se si sin su sus te tengo tiene un una uno y ya yo puedo debo hago hacer mucho the a an and are be can do does for how i if in is it my of on or should the to what when why with you your'.split(' ');
  // Palabras que significan lo mismo (incluye inglés)
  var SINONIMOS = [
    'dolor duele duelen doler molestia molesta punzada late pain hurt hurts ache toothache',
    'muela muelas diente dientes pieza piezas tooth teeth molar molars',
    'sensibilidad sensible sensibles frio fria helado helada caliente calor cold hot sensitive sensitivity',
    'ortodoncia brackets bracket frenos alineadores alineador invisalign torcidos chuecos apinados braces aligners orthodontics crooked',
    'blanqueamiento blanquear blanco blancos amarillos amarillo manchas manchados whitening whiter white yellow stains',
    'implante implantes perdi falta faltan perdido implant implants missing',
    'endodoncia conductos conducto nervio canal root',
    'encias encia gingivitis periodontitis piorrea sangran sangrado sangra gums gum bleeding bleed',
    'nino ninos nina ninas hijo hija hijos bebe bebes infantil pediatrico child children kid kids baby son daughter',
    'urgencia urgencias emergencia golpe roto rompio quebro cayo accidente fractura emergency broken knocked',
    'hinchada hinchado hinchazon inflamada inflamado absceso pus swollen swelling infection infeccion',
    'precio precios costo costos cuanto cuesta vale cobran pagar pago cuotas price cost costs pay',
    'extraccion extracciones sacar sacaron extraer cordal cordales juicio extraction wisdom pulled',
    'miedo nervios ansiedad panico temor fobia fear afraid anxiety scared',
    'limpieza profilaxis sarro placa tartaro cleaning tartar plaque',
    'aliento halitosis olor breath smell',
    'embarazo embarazada embarazadas pregnant pregnancy',
    'carillas carilla veneers veneer',
    'cepillar cepillado cepillo cepillarme hilo brush brushing floss toothbrush',
    'cita citas reprogramar cancelar cambiar appointment reschedule',
    'seguro seguros aseguradora insurance financiamiento financing',
    'fumar fumo fuma fumador fumadora tabaco cigarro cigarros cigarrillo smoke smoking smoker'
  ];
  var CANON = {};
  SINONIMOS.forEach(function (g) { var p = g.split(' '); p.forEach(function (w) { CANON[w] = p[0]; }); });
  function raiz(w) { return CANON[w] || CANON[w.replace(/(es|s)$/, '')] || w.replace(/(es|s)$/, ''); }
  // Palabras que indican «ya pasó» (me sacaron, me operaron…) también buscan los cuidados de después
  var AMPLIAR = { sacaron: ['extraccion', 'despues'], extrajeron: ['extraccion', 'despues'], quitaron: ['extraccion', 'despues'], operaron: ['despues'], pusieron: ['despues'] };
  function claves(t) {
    var r = [];
    normal(t).split(/\s+/).filter(function (w) { return w.length > 1 && VACIAS.indexOf(w) < 0; }).forEach(function (w) {
      [raiz(w)].concat((AMPLIAR[w] || []).map(raiz)).forEach(function (x) { if (r.indexOf(x) < 0) r.push(x); });
    });
    return r;
  }
  var GENERICAS = ['muela'];   // «diente», «muela», «tooth»: aparecen en casi todo, cuentan poco
  var INDICE = FAQ.map(function (f) {
    return { pregunta: claves(f[1] + ' ' + f[5]), clave: claves(f[4]), texto: claves(f[2] + ' ' + f[6]) };
  });
  // Las palabras que aparecen en pocas preguntas (p. ej. «noche») pesan más que las muy comunes (p. ej. «dolor»)
  var VECES = {};
  INDICE.forEach(function (x) {
    var vistas = {};
    x.pregunta.concat(x.clave, x.texto).forEach(function (w) { if (!vistas[w]) { vistas[w] = 1; VECES[w] = (VECES[w] || 0) + 1; } });
  });
  function peso(w) { return Math.log(1 + FAQ.length / (VECES[w] || 1)); }
  function puntaje(i, q) {
    var x = INDICE[i], s = 0;
    q.forEach(function (w) {
      if (GENERICAS.indexOf(w) >= 0) { if (x.pregunta.indexOf(w) >= 0 || x.clave.indexOf(w) >= 0) s += 1; return; }
      var b = 0;
      if (x.pregunta.indexOf(w) >= 0) b += 3;
      if (x.clave.indexOf(w) >= 0) b += 2;
      else if (x.texto.indexOf(w) >= 0) b += 1;
      s += b * peso(w);
    });
    return s;
  }

  // Qué parte de la pregunta cubre una respuesta (0 a 1): sirve para decidir si hace falta la IA
  function cobertura(i, consultaTxt) {
    var x = INDICE[i], base = [];
    normal(consultaTxt).split(/\s+/).filter(function (w) { return w.length > 1 && VACIAS.indexOf(w) < 0; }).forEach(function (w) {
      var r = raiz(w); if (GENERICAS.indexOf(r) < 0 && base.indexOf(r) < 0) base.push(r);
    });
    if (!base.length) return 1;
    var s = 0;
    base.forEach(function (w) { if (x.pregunta.indexOf(w) >= 0 || x.clave.indexOf(w) >= 0) s += 1; else if (x.texto.indexOf(w) >= 0) s += 0.5; });
    return s / base.length;
  }

  // ---------- Pantalla ----------
  var tema = 'todos', consulta = '', abierta = -1, todas = false, sinRespuestaClara = false;

  // ---------- Respuesta con IA (solo si la página no tiene una respuesta clara) ----------
  var CFG = window.PLUS_DENTAL_CONFIG || {}, iaTurno = 0;
  function idioma() { return window.PD_IDIOMA && window.PD_IDIOMA() === 'en' ? 'en' : 'es'; }
  function ocultarIA() { iaTurno++; $('faqIA').hidden = true; $('faqIA').innerHTML = ''; }
  function botonesIA(pregunta) {
    return '<div class="faq-ia-acc"><a href="#agenda" class="prim">Agendar evaluación →</a>' +
      '<a href="https://wa.me/' + WHATSAPP + '?text=' + encodeURIComponent('Hola Plus Dental, tengo una pregunta: ' + pregunta) + '" target="_blank" rel="noopener">Preguntar por WhatsApp</a></div>';
  }
  async function preguntarIA(pregunta) {
    var turno = ++iaTurno, caja = $('faqIA');
    if (!CFG.supabaseUrl || pregunta.length < 6) { caja.hidden = true; return; }
    caja.hidden = false;
    caja.innerHTML = '<div class="faq-ia-cargando"><i aria-hidden="true"></i><span>Buscando una respuesta con IA…</span></div>';
    var datos = null, estado = 0;
    try {
      var r = await fetch(CFG.supabaseUrl + '/functions/v1/faq-ia', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: CFG.supabaseKey },
        body: JSON.stringify({ pregunta: pregunta, idioma: idioma() }) });
      estado = r.status; datos = await r.json().catch(function () { return null; });
    } catch (err) { datos = null; }
    if (turno !== iaTurno) return;
    // Función aún no instalada o sin clave: se muestra el aviso normal de «sin respuesta»
    if (!datos || estado === 404 || estado === 503) { caja.hidden = true; caja.innerHTML = ''; $('faqNada').hidden = false; return; }
    var cabeza = '<div class="faq-ia-tag"><span>✦ Respuesta con IA</span><small>No estaba en nuestras preguntas frecuentes</small></div><h3>' + esc(pregunta) + '</h3>';
    if (datos && datos.respuesta) {
      caja.innerHTML = cabeza + '<p data-sin-traducir>' + esc(datos.respuesta) + '</p>' +
        '<p class="faq-ia-nota">Información general generada por inteligencia artificial. No sustituye la evaluación de un odontólogo.</p>' + botonesIA(pregunta);
    } else {
      var msg = datos && datos.fuera ? 'Solo podemos responder dudas sobre salud dental y nuestros tratamientos. Escríbenos por WhatsApp si necesitas algo más.'
        : estado === 429 ? 'Llegaste al límite de preguntas con IA por hoy. Escríbenos por WhatsApp y te respondemos.'
        : 'Ahora no pudimos consultar la respuesta con IA. Escríbenos por WhatsApp y te respondemos.';
      caja.innerHTML = cabeza + '<p>' + msg + '</p>' + botonesIA(pregunta);
    }
    if (window.PD_TRADUCIR) window.PD_TRADUCIR(caja);
  }

  function nombreTema(k) { var t = TEMAS.filter(function (x) { return x[0] === k; })[0]; return t ? t[1] : ''; }
  function pintarTemas() {
    $('faqTemas').innerHTML = [['todos', 'Todas']].concat(TEMAS).map(function (t) {
      return '<button type="button" data-faq-tema="' + t[0] + '" aria-pressed="' + (tema === t[0]) + '">' + esc(t[1]) + '</button>';
    }).join('');
  }
  function tarjeta(i, etiqueta) {
    var f = FAQ[i];
    return '<span class="faq-mejor-tag">✦ ' + esc(etiqueta) + '</span>' +
      '<span class="faq-tema">' + esc(nombreTema(f[0])) + '</span>' +
      '<h3>' + esc(f[1]) + '</h3><p>' + esc(f[2]) + '</p>' +
      (f[3].length ? '<span class="faq-rec">Recomendaciones</span><ul>' + f[3].map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul>' : '') +
      '<a href="#agenda" class="faq-agendar">Agendar evaluación →</a>';
  }
  function item(i) {
    var f = FAQ[i], abierto = abierta === i;
    return '<div class="faq-item"><button type="button" data-faq-item="' + i + '" aria-expanded="' + abierto + '" aria-controls="faqR' + i + '">' +
      '<span><span class="faq-tema">' + esc(nombreTema(f[0])) + '</span>' + esc(f[1]) + '</span><span class="faq-mas" aria-hidden="true">' + (abierto ? '−' : '+') + '</span></button>' +
      '<div class="faq-resp" id="faqR' + i + '"' + (abierto ? '' : ' hidden') + '><p>' + esc(f[2]) + '</p>' +
      (f[3].length ? '<ul>' + f[3].map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul>' : '') + '</div></div>';
  }
  function pintar() {
    pintarTemas();
    var q = claves(consulta), lista, mejor, etiqueta, titulo;
    sinRespuestaClara = false;
    var delTema = FAQ.map(function (f, i) { return i; }).filter(function (i) { return tema === 'todos' || FAQ[i][0] === tema; });
    if (q.length) {
      var con = delTema.map(function (i) { return [i, puntaje(i, q)]; }).filter(function (x) { return x[1] > 0; })
        .sort(function (a, b) { return b[1] - a[1] || a[0] - b[0]; });
      // Relacionadas: solo las que comparten algo importante con la mejor respuesta
      var minimo = con.length ? Math.max(2, con[0][1] * 0.4) : 0;
      con = con.filter(function (x, k) { return k === 0 || x[1] >= minimo; }).map(function (x) { return x[0]; });
      $('faqNada').hidden = con.length > 0;
      $('faqWa').href = 'https://wa.me/' + WHATSAPP + '?text=' + encodeURIComponent('Hola Plus Dental, tengo una pregunta: ' + consulta.trim());
      if (!con.length) { mejor = null; lista = delTema; titulo = 'Más preguntas'; }
      else { mejor = con[0]; lista = con.slice(1); etiqueta = 'Mejor respuesta'; titulo = 'Preguntas relacionadas'; }
      sinRespuestaClara = !con.length || cobertura(con[0], consulta) < 0.6;
    } else {
      $('faqNada').hidden = true;
      mejor = delTema[0]; lista = delTema.slice(1); etiqueta = 'Pregunta destacada'; titulo = 'Más preguntas';
    }
    $('faqMejor').hidden = mejor == null;
    $('faqMejor').innerHTML = mejor == null ? '' : tarjeta(mejor, etiqueta);
    $('faqListaTitulo').textContent = titulo;
    $('faqListaTitulo').hidden = !lista.length;
    var cortar = !todas && lista.length > VISIBLES;
    $('faqLista').innerHTML = (cortar ? lista.slice(0, VISIBLES) : lista).map(item).join('');
    $('faqVerMas').hidden = !cortar;
    $('faqLimpiar').hidden = !consulta.trim();
  }

  var espera = null;
  $('faqTexto').addEventListener('input', function () {
    clearTimeout(espera);
    ocultarIA();
    espera = setTimeout(function () { consulta = $('faqTexto').value; tema = 'todos'; abierta = -1; todas = false; pintar(); }, 180);
  });
  $('faqBuscar').addEventListener('submit', function (e) {
    e.preventDefault(); clearTimeout(espera);
    consulta = $('faqTexto').value; tema = 'todos'; abierta = -1; todas = false; pintar();
    if (consulta.trim() && sinRespuestaClara) { $('faqNada').hidden = true; preguntarIA(consulta.trim()); $('faqIA').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); return; }
    ocultarIA();
    if (!$('faqMejor').hidden) $('faqMejor').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  $('faqLimpiar').addEventListener('click', function () { ocultarIA(); $('faqTexto').value = ''; consulta = ''; abierta = -1; pintar(); $('faqTexto').focus(); });
  $('faqTemas').addEventListener('click', function (e) {
    var b = e.target.closest('[data-faq-tema]');
    if (!b) return;
    tema = b.dataset.faqTema; abierta = -1; todas = false; ocultarIA(); pintar();
  });
  $('faqLista').addEventListener('click', function (e) {
    var b = e.target.closest('[data-faq-item]');
    if (!b) return;
    var i = +b.dataset.faqItem;
    abierta = abierta === i ? -1 : i;
    pintar();
    var nuevo = document.querySelector('[data-faq-item="' + i + '"]');
    if (nuevo) nuevo.focus();
  });
  $('faqVerMas').addEventListener('click', function () { todas = true; pintar(); });
  // Búsqueda para el asistente virtual: la pregunta frecuente que mejor responde un texto (o null)
  window.PD_FAQ = {
    buscar: function (texto) {
      var q = claves(texto);
      if (!q.length) return null;
      var con = FAQ.map(function (f, i) { return [i, puntaje(i, q)]; }).filter(function (x) { return x[1] > 0; }).sort(function (a, b) { return b[1] - a[1]; });
      if (!con.length) return null;
      var i = con[0][0];
      return { pregunta: FAQ[i][1], respuesta: FAQ[i][2], recomendaciones: FAQ[i][3], cobertura: cobertura(i, texto) };
    }
  };
  pintar();
})();
