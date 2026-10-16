# Contrato de API: onboarding MVP de wallet

Estado: **borrador para revisión**. No está aprobado por producto, compliance ni seguridad. Reemplaza al contrato anterior `docs/ENDPOINTS.md`, que se eliminó.

Fuentes:

- Specs: [OTP](../HU/user-stories/user-onboarding-otp-phone-verification.sp.md), [PIN autogenerado](../HU/user-stories/user-onboarding-generated-pin.sp.md), [límite de S/ 10 sin DNI](../HU/user-stories/user-onboarding-low-limit-without-dni.sp.md) e [historia padre](../HU/user-stories/user-onboarding-mvp-completion.sp.md).
- Pantallas y brechas: [endpoints_onboarding.md](./endpoints_onboarding.md) y [prototipo](./prototipo-onboarding-celular.html).
- Reglas: [reglas-security.md](../reglas/reglas-security.md) y [REGLAS.md](../REGLAS.md).

## Leyenda

- **[C] Base**: convención heredada del contrato anterior (`ENDPOINTS.md`). Se mantiene.
- **[P] Propuesta**: diseño nuevo que cubre los specs. Requiere aprobación antes de codificar.
- **[G] Brecha**: decisión pendiente. No codificar sin resolverla.

## Alcance y convenciones

- [C] OpenAPI 3.0.3. Base URL `/api/v1`.
- [C] Autenticación `Bearer` (JWT). El cliente no envía `userId`; la identidad sale del token.
- [C] País: `PE`. Moneda: `PEN`.
- [C] `Idempotency-Key` obligatorio en los `POST` y `PUT` del onboarding. Longitud de 16 a 128 caracteres. Si se repite con el mismo cuerpo, devuelve el mismo resultado. Si se repite con otro cuerpo, responde `409`.
- [C] Errores en `application/problem+json` (RFC 9457) con `code` estable. La app muestra solo `message`.
- [P] Ningún mensaje de error refleja datos ingresados por el usuario (reglas §4.5).
- [P] Los `answers` se validan contra una lista explícita de campos por paso. Los campos no esperados se rechazan con `422` (reglas §4.2). El contrato anterior usaba `additionalProperties: true`; esa parte se reemplaza.
- [P] El servidor es la única fuente de límites y reglas. La app no los fija (reglas §3.5).

## Flujo

Los pasos y su orden los define el servidor en `steps`. El cliente sigue `currentStepId`.

| Orden | `stepId` [P] | Pantalla | Qué se envía | Resultado al completar |
|---|---|---|---|---|
| 1 | `phone` | 2 | `phoneNumber` (9 dígitos) y `termsAccepted` | El servidor envía el OTP por el proveedor (mock en este sprint). |
| 2 | `otp` | 3 | `otpCode` (6 dígitos) | Avanza si el código es correcto. |
| 3 | `pin` | 4 | Sin campos. El servidor genera el PIN. | Devuelve el PIN generado una vez por el canal decidido (ver Decisiones cerradas). |
| 4 | `pinConfirmation` | 4 | `pinSavedConfirmation: true` | Activa la wallet: `walletStatus: active`, `status: completed`. |

Confirmado: `pin` y `pinConfirmation` son dos pasos separados.

## Endpoints

### Onboarding

| Método | Ruta | Estado | Descripción |
|---|---|---|---|
| POST | `/onboardings` | [C] | Crea el flujo. |
| GET | `/onboardings/current` | [C] | Consulta el progreso y el paso actual. |
| PUT | `/onboardings/current/steps/{stepId}` | [C] | Valida y completa un paso. |
| POST | `/onboardings/current/close` | [C] | Cierra el flujo sin activar la wallet. |
| POST | `/onboardings/current/otp/resend` | [P] | Reenvía el OTP. Máximo 3 reenvíos por onboarding (parámetro OTP). |

Cambio de número: incluido en este sprint. [G] Mecanismo sin definir. Se propone volver al paso `phone` con `PUT` y un `Idempotency-Key` nuevo; el endpoint o paso concreto lo confirma producto.

### Errores comunes

| Código HTTP | `code` | Cuándo | Acción de la app |
|---|---|---|---|
| 400 | `BAD_REQUEST` | Solicitud mal formada. | Error genérico. |
| 401 | `UNAUTHORIZED` | Token ausente, inválido o vencido. | Reautenticar [G flujo de acceso]. |
| 404 | `ONBOARDING_NOT_FOUND` | No hay onboarding activo o el paso no pertenece al flujo. | Recargar con `GET /onboardings/current`. |
| 409 | `ONBOARDING_ALREADY_IN_PROGRESS` | Ya existe un flujo. Trae `onboardingId`. | Reanudar con `GET /onboardings/current`. |
| 409 | `STEP_NOT_CURRENT` | El paso no es el actual. | Recargar. |
| 409 | `ONBOARDING_CLOSED` | El flujo está cerrado o completado. | Recargar o crear uno nuevo. |
| 409 | `IDEMPOTENCY_KEY_REUSED` | La misma clave con otro cuerpo. | Generar una clave nueva. |
| 422 | `VALIDATION_FAILED` | Datos inválidos o faltantes. Trae `errors[]`. El flujo no avanza. | Marcar los campos y mostrar `message`. |

Para la validación del OTP, `errors[].code` toma estos valores [P]:

- `OTP_INVALID`: código incorrecto.
- `OTP_EXPIRED`: código vencido. Pedir uno nuevo.
- `OTP_ATTEMPTS_EXCEEDED`: bloqueo temporal por intentos.

Parámetros OTP (definidos por seguridad, deben ser configurables; spec OTP, criterios 5 y 6):

- Intentos de validación: 3.
- Bloqueo tras agotar intentos: 4 [supuesto: minutos; confirmar unidad].
- Vigencia del código: 1 minuto.
- Reenvíos máximos: 3.

[G] El prototipo muestra "Te quedan 2 intentos". El contrato no devuelve ese contador. No se codifica fijo.

## Esquemas

### Onboarding [C con cambios [P]]

```yaml
Onboarding:
  type: object
  required: [id, status, walletStatus, countryCode, steps, currentStepId, startedAt, updatedAt, limits]
  properties:
    id: { type: string, example: onb_01JABC }
    status: { type: string, enum: [in_progress, completed, closed] }
    walletStatus: { type: string, enum: [pending, active] }
    countryCode: { type: string, enum: [PE] }
    steps:
      type: array
      items: { $ref: '#/components/schemas/OnboardingStep' }
    currentStepId: { type: string, nullable: true }
    startedAt: { type: string, format: date-time }
    completedAt: { type: string, format: date-time, nullable: true }
    closedAt: { type: string, format: date-time, nullable: true }
    updatedAt: { type: string, format: date-time }
    limits:
      type: object
      description: [P] Límites que muestra la pantalla "Cuenta lista". Los devuelve el servidor.
      properties:
        perTransferMaxPEN: { type: number, example: 10 }
        dailyMaxTransfers: { type: integer, example: 5 }
        currency: { type: string, enum: [PEN] }
        dailyMaxPEN: { type: number, example: 50 }
```

Los valores de `limits` salen de un archivo mock en este sprint (spec de límite, criterio 5). El tope diario es S/ 50 (5 × S/ 10). [G] Si `limits` vive en `Onboarding` o en la respuesta de la wallet a largo plazo.

### OnboardingStep [C]

```yaml
OnboardingStep:
  type: object
  required: [id, title, order, status]
  properties:
    id: { type: string, example: phone }
    title: { type: string, description: Etiqueta para presentación. No sustituye la validación del servidor. }
    order: { type: integer, minimum: 1 }
    status: { type: string, enum: [pending, current, completed] }
    completedAt: { type: string, format: date-time, nullable: true }
```

### SubmitStepRequest [P]

Cada paso define sus campos. El servidor rechaza los demás.

```yaml
SubmitStepRequest:
  type: object
  additionalProperties: false
  required: [answers]
  properties:
    answers:
      oneOf:
        - $ref: '#/components/schemas/PhoneStepAnswers'
        - $ref: '#/components/schemas/OtpStepAnswers'
        - $ref: '#/components/schemas/PinStepAnswers'
        - $ref: '#/components/schemas/PinConfirmationStepAnswers'

PhoneStepAnswers:
  type: object
  additionalProperties: false
  required: [phoneNumber, termsAccepted]
  properties:
    phoneNumber: { type: string, pattern: '^9\d{8}$', description: Celular de 9 dígitos. Es el alias del usuario. Que inicie en 9 es supuesto a confirmar. }
    termsAccepted: { type: boolean, enum: [true] }

OtpStepAnswers:
  type: object
  additionalProperties: false
  required: [otpCode]
  properties:
    otpCode: { type: string, pattern: '^\d{6}$' }

PinStepAnswers:
  type: object
  additionalProperties: false
  description: Sin campos. El servidor genera el PIN.
  properties: {}

PinConfirmationStepAnswers:
  type: object
  additionalProperties: false
  required: [pinSavedConfirmation]
  properties:
    pinSavedConfirmation: { type: boolean, enum: [true], description: [supuesto] El usuario confirma que guardó su PIN. }
```

Notas:

- [P] El `otpCode` nunca se devuelve en respuestas de éxito ni de error (spec OTP, criterio 2 y 7).
- [P] El `phoneNumber` se envía y se usa solo para el envío del OTP. No se registra en logs (reglas §7.3).
- [P] MFA para alta de cuenta (reglas §3.4): el alta MVP usa dos factores (OTP por SMS como posesión + PIN como conocimiento). No se considera MFA fuerte para elevar límites o cambios KYC; el riesgo de SIM swap/interceptación se mitiga con límites estrictos y controles de abuso.
- [P] Términos y política de datos: la URL y el texto son un mock provisional hasta que compliance entregue el texto aprobado [G].
- [G] El `phoneNumber` no se vuelve a mostrar en la respuesta. Hay que decidir si la pantalla 3 necesita un enmascarado (por ejemplo, `*** *** 123`) y de dónde sale.

### Respuesta del paso `pin` [P]

El paso `pin` devuelve el `Onboarding` más el PIN generado una sola vez.

```yaml
PinStepResponse:
  allOf:
    - $ref: '#/components/schemas/Onboarding'
    - type: object
      required: [generatedPin]
      properties:
        generatedPin:
          type: string
          pattern: '^\d{6}$'
          description: PIN aleatorio de 6 dígitos. Se devuelve una vez.
```

Reglas del PIN [P]:

- Se genera con una fuente segura de aleatoriedad y no depende del celular ni de otros datos del usuario (spec PIN, criterio 2).
- Solo se guarda su hash con Argon2id o bcrypt (reglas §6.4, §6.5). Nunca en texto plano.
- No hay endpoint que devuelva el PIN en claro después de esta respuesta (spec PIN, criterio 8).
- Un reintento con la misma `Idempotency-Key` devuelve el mismo PIN y no genera uno nuevo (reglas §4.7).

[P] Canal de entrega: el PIN se entrega únicamente en la respuesta HTTPS del paso `pin` (campo `generatedPin`). No se envía por SMS ni por otro canal que comparta el riesgo del OTP.

[P] Idempotencia y caché: para permitir reintentos sin guardar el PIN en claro, el backend mantiene una caché temporal cifrada asociada a la `Idempotency-Key`. Ventana propuesta: 10 minutos. Dentro de esa ventana, un reintento devuelve el mismo `generatedPin`. Fuera de esa ventana, el backend no reexpone el PIN.

[P] Visibilidad en pantalla: el cliente muestra el PIN oculto por defecto y lo revela solo por acción explícita del usuario (p. ej. botón “mostrar”).

[P] Regeneración del PIN: máximo 2 veces por onboarding. Cada regeneración invalida el PIN anterior [supuesto]. El mecanismo (paso o endpoint) queda [G].

[P] Bloqueo por intentos fallidos de uso del PIN (reglas §5.6): se bloquea al 4.º intento fallido. Duración y ventana [G].

[G] Si el generador excluye patrones débiles (`000000`, `123456`). Seguridad decide.

### Límites de transferencia [P]

- Límite por transferencia: S/ 10.00. Máximo 5 transferencias por día.
- Una transferencia de S/ 10.00 se acepta sin DNI. Una de S/ 10.01 se rechaza con un mensaje de límite superado. No solicita DNI ni promete aumentos.
- La sexta transferencia del día se rechaza con el mismo tipo de mensaje.
- Montos inválidos (cero, negativos, más de dos decimales) se rechazan con `422`.
- La respuesta de rechazo no refleja el monto ingresado (reglas §4.5).
- El rechazo se registra como evento sin datos personales (reglas §7.3).

El cumplimiento de S/ 10 sin DNI en Perú está confirmado por compliance (ver decisión 11). Si el proveedor real tiene un límite menor, prevalece el menor.

El conteo diario de transferencias se reinicia a las 23:59 en zona `America/Lima` [supuesto: zona por confirmar].

Una transferencia por encima del límite se rechaza con mensaje de límite (confirmado).

Los límites viven en un archivo mock y se aplican en el contrato de transferencias, que no pertenece a este documento.

## Reglas para el cliente

- [C] El cliente no asume cuántos pasos hay ni sus identificadores. Los toma de `steps`.
- [C] Antes de mostrar un paso, usar `GET /onboardings/current` para conocer `currentStepId`.
- [C] Tras un `422`, marcar los campos de `errors[].field` y no avanzar.
- [P] Tras la respuesta del paso `pin`, el cliente muestra el PIN una sola vez. No lo guarda, no lo registra y no lo envía a analítica.
- [P] El PIN se muestra oculto por defecto y se revela solo por acción explícita del usuario.
- [P] No se persisten `otpCode`, `phoneNumber` ni `generatedPin` en almacenamiento local ni en logs.
- [C] No registrar `answers` en logs, analítica ni crash reports.
- [C] La analítica la registra el servidor. La app no envía eventos de onboarding.

## Pendiente de contrato anterior no migrado

El contrato anterior incluía `GET /internal/analytics/onboarding/monthly` (métricas mensuales, CAC y actividad). No es parte de la app móvil. Se excluye de este documento y se decide en un contrato interno aparte [G].



## Preguntas abiertas antes de codificar

1. Bloqueo OTP: unidad de "bloqueo=4" (minutos u otra) (seguridad).
2. Zona horaria exacta del reinicio a las 23:59 (producto; supuesto `America/Lima`).
3. Mecanismo de regeneración del PIN y de cambio de número (producto/seguridad).
4. Política de PIN débiles (`000000`, `123456`) (seguridad).
5. Enmascarado del número en la pantalla 3 y de dónde sale (producto).

## Decisiones cerradas (MVP)

1. **Segundo factor (MFA) para alta**: se valida que el alta MVP cumple la intención de MFA (reglas §3.4) con OTP por SMS (posesión) + PIN (conocimiento). Se reconoce el riesgo de SIM swap/interceptación de SMS; por eso no se considera MFA fuerte para elevar límites o cambios KYC y se mitiga con límites estrictos y controles de abuso. Validación formal pendiente con seguridad.
2. **PIN (canal, visibilidad e idempotencia)**: el PIN se entrega solo por respuesta HTTPS del paso `pin` (no por SMS), se muestra oculto por defecto con acción explícita de revelar, y los reintentos se soportan mediante caché temporal cifrada asociada a `Idempotency-Key` (ventana propuesta 10 minutos) sin reexponer el PIN fuera de esa ventana.
3. **PIN de 6 dígitos, generado por el servidor**, con regeneración máxima de 2 veces y bloqueo al 4.º intento fallido de uso.
4. **OTP (parámetros)**: 3 intentos de validación, vigencia de 1 minuto, 3 reenvíos máximos. Proveedor de terceros mockeado.
5. **Dos pasos confirmados**: `pin` y `pinConfirmation` son pasos separados.
6. **Límites**: S/ 10 por transferencia, máximo 5 al día, tope diario S/ 50, reinicio a las 23:59. Transferencia sobre el límite: se rechaza con mensaje de límite. Valores en archivo mock.
7. **Términos y política de datos**: URL y texto provisionales (mock) hasta aprobación de compliance.
8. **Reenvío de OTP y cambio de número**: incluidos en este sprint.
9. **Alias de usuario**: número de celular de 9 dígitos.
10. **Cuenta existente**: si el celular ya tiene cuenta, se muestra mensaje de cuenta existente y se redirige a iniciar sesión (respuesta 401 en el endpoint correspondiente).
11. **Cumplimiento de S/ 10 sin DNI**: confirmado por compliance, según indicó el usuario. Se mantiene la regla de que, si el proveedor real tiene un límite menor, prevalece el menor.


## Fuera de alcance

- Diseño visual y textos finales.
- Verificación de DNI y límites superiores a S/ 10 (siguiente sprint).
- Endpoints de transferencias.
- Analítica interna.
