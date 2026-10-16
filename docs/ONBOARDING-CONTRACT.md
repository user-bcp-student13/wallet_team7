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
| 3 | `pin` | 4 | Sin campos. El servidor genera el PIN. | Devuelve el PIN generado una vez. [G canal, ver abajo] |
| 4 | `pinConfirmation` | 4 | `pinSavedConfirmation: true` | Activa la wallet: `walletStatus: active`, `status: completed`. |

[G] Si el paso `pin` debe ser un paso separado de la confirmación, o si la confirmación puede ir en la misma petición. Este borrador usa dos pasos. Seguridad y producto lo confirman.

## Endpoints

### Onboarding

| Método | Ruta | Estado | Descripción |
|---|---|---|---|
| POST | `/onboardings` | [C] | Crea el flujo. |
| GET | `/onboardings/current` | [C] | Consulta el progreso y el paso actual. |
| PUT | `/onboardings/current/steps/{stepId}` | [C] | Valida y completa un paso. |
| POST | `/onboardings/current/close` | [C] | Cierra el flujo sin activar la wallet. |
| POST | `/onboardings/current/otp/resend` | [P] | Reenvía el OTP. Sujeto a un máximo de reenvíos [G]. |

[G] "Cambiar número" no tiene endpoint. Brecha 1 de `endpoints_onboarding.md`. Se propone volver al paso `phone` con `PUT` y un `Idempotency-Key` nuevo, pero no está decidido.

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

[G] Número de intentos, duración del bloqueo, vigencia del código y máximo de reenvíos. Los define seguridad. Deben ser parámetros de configuración (spec OTP, criterios 5 y 6).

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
```

[G] Si `limits` vive en `Onboarding` o en la respuesta de la wallet. Lo decide producto. Los valores son parámetros de configuración (spec de límite, criterio 5). Pendiente: el tope total diario es S/ 50 (5 × S/ 10) y no está confirmado.

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

[G] Canal de entrega. Opciones: en la respuesta de la API (este borrador), o por otro canal. Si va por SMS, comparte canal con el OTP y reduce la protección (spec PIN, riesgos).

[G] Para que un reintento devuelva el mismo PIN sin guardarlo en claro, hace falta una caché temporal cifrada de la respuesta. Hay que decidir si se permite y por cuánto tiempo (spec PIN, criterio 6, supuesto).

[G] Visibilidad en pantalla: oculto por defecto con opción de mostrar, o siempre visible. Pendiente con seguridad.

[G] Regeneración del PIN: si el usuario puede pedir otro, cuántas veces y qué pasa con el anterior.

[G] Bloqueo por intentos fallidos de uso del PIN (reglas §5.6): intentos, ventana y duración. Sin definir, porque el PIN todavía no autoriza operaciones.

[G] Si el generador excluye patrones débiles (`000000`, `123456`). Seguridad decide.

### Límites de transferencia [P]

- Límite por transferencia: S/ 10.00. Máximo 5 transferencias por día.
- Una transferencia de S/ 10.00 se acepta sin DNI. Una de S/ 10.01 se rechaza con un mensaje de límite superado. No solicita DNI ni promete aumentos.
- La sexta transferencia del día se rechaza con el mismo tipo de mensaje.
- Montos inválidos (cero, negativos, más de dos decimales) se rechazan con `422`.
- La respuesta de rechazo no refleja el monto ingresado (reglas §4.5).
- El rechazo se registra como evento sin datos personales (reglas §7.3).

[G] El cumplimiento de S/ 10 sin DNI en Perú no está confirmado por compliance. Si el proveedor real tiene un límite menor, prevalece el menor.

[G] Zona horaria (propuesta `America/Lima`) y hora de reinicio del conteo diario de 5 transferencias.

[G] Si una transferencia por encima del límite se rechaza o queda en espera. El supuesto es rechazo. Confirmar.

Los límites se aplican en el contrato de transferencias, que no pertenece a este documento [G].

## Reglas para el cliente

- [C] El cliente no asume cuántos pasos hay ni sus identificadores. Los toma de `steps`.
- [C] Antes de mostrar un paso, usar `GET /onboardings/current` para conocer `currentStepId`.
- [C] Tras un `422`, marcar los campos de `errors[].field` y no avanzar.
- [P] Tras la respuesta del paso `pin`, el cliente muestra el PIN una sola vez. No lo guarda, no lo registra y no lo envía a analítica.
- [P] No se persisten `otpCode`, `phoneNumber` ni `generatedPin` en almacenamiento local ni en logs.
- [C] No registrar `answers` en logs, analítica ni crash reports.
- [C] La analítica la registra el servidor. La app no envía eventos de onboarding.

## Pendiente de contrato anterior no migrado

El contrato anterior incluía `GET /internal/analytics/onboarding/monthly` (métricas mensuales, CAC y actividad). No es parte de la app móvil. Se excluye de este documento y se decide en un contrato interno aparte [G].

## Preguntas abiertas antes de codificar

1. Parámetros de OTP: intentos, bloqueo, vigencia y reenvíos (seguridad).
2. Validación formal del segundo factor: OTP por SMS + PIN, frente a reglas §3.4 y riesgo de SIM swap (seguridad).
3. Canal y visibilidad del PIN, y caché de la respuesta con el PIN (seguridad).
4. Regeneración del PIN y PIN débiles (seguridad).
5. Bloqueo por intentos del PIN (seguridad).
6. Dónde viven `limits` y cómo se aplican en transferencias (producto).
7. Zona horaria y reinicio del conteo; tope diario de S/ 50 (producto).
8. Cumplimiento de S/ 10 sin DNI (compliance).
9. Flujo "Ya tengo cuenta" y acceso con 401 (producto).
10. Términos y política de datos: URL y texto aprobado (compliance).
11. Si el paso `pin` y la confirmación son dos pasos (este borrador asume que sí).
12. Reenvío y cambio de número en este sprint (producto).

## Fuera de alcance

- Diseño visual y textos finales.
- Verificación de DNI y límites superiores a S/ 10 (siguiente sprint).
- Endpoints de transferencias.
- Analítica interna.
