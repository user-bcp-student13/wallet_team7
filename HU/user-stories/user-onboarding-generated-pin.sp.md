# PIN autogenerado en el onboarding

## Fuente

- Historia padre: [Registro y activación del MVP de wallet](./user-onboarding-mvp-completion.sp.md) (criterios 1 y 3).
- Decisión del Product Owner: la política de PIN es autogenerada y aleatoria. El usuario no elige su PIN.
- Decisión del Product Owner: el PIN tiene 6 dígitos.
- Reglas aplicables: [reglas-security.md](../../reglas/reglas-security.md) §4.5, §4.6, §4.7, §5.6, §6.4, §6.5, §7.3, §8.1, §9.1.
- Pantalla de referencia actual: pantalla 4 de [endpoints_onboarding.md](../../docs/endpoints_onboarding.md) y del [prototipo](../../docs/prototipo-onboarding-celular.html). Ambos describen un PIN que elige el cliente y quedan desactualizados con esta decisión.

## Contexto actual

- El prototipo y el documento de endpoints describen la pantalla 4 como un PIN de 6 dígitos que el cliente escribe dos veces, con validación de patrones.
- La brecha 9 de [endpoints_onboarding.md](../../docs/endpoints_onboarding.md) indica que no está definido cómo viaja ni cómo se almacena el PIN.
- El contrato no define ningún campo para generar ni presentar un PIN.

## Problema confirmado

El PIN es requisito para activar la wallet, pero la política elegida cambia quién lo crea: el servidor lo genera y el usuario lo recibe. El diseño actual y el contrato no reflejan esa política, así que el paso de activación no puede implementarse como está descrito.

## Comportamiento a preservar

- La wallet pasa a `walletStatus: active` y el onboarding a `status: completed` solo al final del flujo (contrato, `Onboarding`).
- El PIN nunca se guarda en texto plano (reglas §6.5).
- Inicio, finalización de cada paso y activación se registran en servidor (criterio 4 de la historia padre).

## Alcance

- Generación en servidor de un PIN aleatorio de 6 dígitos al llegar al paso de activación.
- Presentación del PIN al usuario en la pantalla de activación, una vez por onboarding.
- Almacenamiento de un hash del PIN con algoritmo resistente (reglas §6.4).
- Activación de la wallet después de que el usuario confirma que registró su PIN [supuesto a confirmar].

## Fuera de alcance

- Elección o edición de PIN por parte del usuario.
- Cambio de PIN posterior a la activación.
- Uso del PIN para autorizar pagos (cubierto por las historias de pagos).
- Cambios en `docs/ONBOARDING-CONTRACT.md`, en el prototipo y en el documento de endpoints. Esta spec solo deja registrado que deben actualizarse.

## Criterios de aceptación

1. Al llegar al paso de activación, el servidor genera un PIN de 6 dígitos y lo devuelve para presentarlo en la pantalla de activación.
2. El PIN se genera con una fuente de aleatoriedad segura y no depende del número de celular, de la fecha ni de otros datos del usuario. Verificable en revisión de código de seguridad.
3. La app no permite que el usuario escriba, elija ni edite el PIN durante el onboarding.
4. En base de datos solo se guarda un hash del PIN. Verificable revisando el esquema y los registros.
5. El PIN no aparece en logs, trazas, métricas, analítica, mensajes de error ni en el historial de la app. Verificable con pruebas de no exposición (reglas §10.5).
6. La respuesta que contiene el PIN no se almacena en caché del cliente ni de intermediarios. `reglas-security.md` no lo regula de forma explícita; [supuesto a confirmar con seguridad].
7. Un reintento con la misma `Idempotency-Key` y el mismo cuerpo devuelve el mismo resultado. No genera un PIN nuevo ni reemplaza el ya presentado (reglas §4.7).
8. Después de la activación no existe ningún endpoint que devuelva el PIN en claro. Verificable revisando el contrato.
9. La wallet no pasa a `active` hasta que el usuario confirma que registró su PIN [supuesto a confirmar]. Si no confirma, el onboarding queda en progreso y no se activa.
10. La activación se registra por evento sin incluir el PIN.

## Contratos afectados o protegidos

- `PUT /onboardings/current/steps/{stepId}`: el paso de activación ya no recibe un PIN del cliente. El contrato anterior no tenía forma de devolver el PIN generado. El borrador `docs/ONBOARDING-CONTRACT.md` propone devolver `generatedPin` en la respuesta del paso `pin`, pendiente de aprobación. Ese contrato queda protegido en esta spec.
- `Onboarding.walletStatus` (`pending`, `active`): sin cambios en los valores, pero la transición depende de la confirmación del usuario.

## Riesgos, supuestos y preguntas abiertas

- **Canal de entrega del PIN:** ¿el PIN viaja en la respuesta de la API o por otro canal? Si se envía por SMS, comparte canal con el OTP y reduce la protección. Debe decidirlo seguridad.
- **Exposición en pantalla:** el PIN visible puede ser visto por otras personas. Falta decidir si se oculta por defecto con opción de mostrar.
- **Confirmación del usuario:** la regla de activación tras confirmación es un supuesto. Confirmar con producto.
- **Regeneración:** ¿el usuario puede pedir un PIN nuevo si no lo anotó? Si se permite, ¿cuántas veces y con qué efecto sobre el PIN anterior?
- **Uso del PIN:** no está definido qué operaciones lo requieren. Sin esa definición no se puede validar la política de bloqueo.
- **Bloqueo por intentos fallidos del PIN (§5.6):** falta definir intentos, ventana y duración del bloqueo.
- **Aleatoriedad:** "aleatorio" no excluye PIN fáciles de adivinar (por ejemplo `000000` o `123456`). Seguridad debe decidir si el generador excluye esos patrones.
- **Documentos desactualizados:** la pantalla 4 del prototipo y la brecha 9 de [endpoints_onboarding.md](../../docs/endpoints_onboarding.md) describen el PIN elegido por el cliente y deben corregirse antes de codificar.
