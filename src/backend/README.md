# Wallet Team7 · Backend mock de onboarding

Mock en Node.js + Express 5 del API de onboarding definido en
[docs/ONBOARDING-CONTRACT.md](../../docs/ONBOARDING-CONTRACT.md). Sirve también
el prototipo web de `src/frontend/` para probar el flujo de punta a punta.

## Requisitos

- Node.js 20 o superior.

## Instalación y ejecución

```powershell
cd src\backend
npm install
npm start
```

Abre http://localhost:3000/ (o el `PORT` configurado).

## Variables de entorno

| Variable | Default | Descripción |
|----------|---------|-------------|
| `PORT` | `3000` | Puerto HTTP. |
| `OTP_MOCK_CODE` | `123456` | Código OTP fijo del proveedor mock. Debe tener 6 dígitos. |
| `IDEMPOTENCY_CACHE_KEY` | aleatoria por arranque | Clave de 32 bytes en base64. Si falta, se genera al arrancar. |

## Pruebas

```powershell
npm test
```

Usa `node --test` con reloj inyectado. Cubre alta, OTP (incorrecto, bloqueo,
reenvío), PIN (generación, regeneración, confirmación), cierre, idempotencia y
formato de errores RFC 9457.

## Configuración

- `config/limits.mock.json`: límites de transferencia (S/ 10 por transferencia,
  máximo 5 al día, tope diario S/ 50, reinicio 23:59 `America/Lima`).
- `config/onboarding-policy.json`: parámetros de OTP (6 dígitos, vigencia 60 s,
  3 intentos, bloqueo 4 minutos, 3 reenvíos), PIN (6 dígitos, 2 regeneraciones)
  e idempotencia (TTL 10 min, clave de 16 a 128 caracteres).

## Endpoints

Base `/api/v1`. Todas las rutas requieren `Authorization: Bearer <token>`
(mínimo 16 caracteres). `POST` y `PUT` requieren `Idempotency-Key`.

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/onboardings` | Inicia un alta (201). |
| `GET` | `/onboardings/current` | Estado del alta actual. |
| `PUT` | `/onboardings/current/steps/{stepId}` | Envía un paso (`phone`, `otp`, `pin`, `pinConfirmation`). |
| `POST` | `/onboardings/current/otp/resend` | Reenvía el OTP. |
| `POST` | `/onboardings/current/pin/regenerate` | Regenera el PIN (máximo 2). |
| `POST` | `/onboardings/current/close` | Cierra el alta. |

## Supuestos del mock

Estos puntos no están confirmados formalmente por producto:

- La regeneración del PIN solo aplica en `pinConfirmation`, máximo 2 veces. El
  nuevo PIN invalida el anterior.
- El cambio de número se hace con `PUT steps/phone` durante `otp`. Reenvía el
  OTP, reinicia los intentos y consume el mismo límite que los reenvíos.
- Tras el bloqueo de 4 minutos el código ya venció: el usuario debe reenviar
  (consume uno de los 3 reenvíos).
- La unidad del bloqueo OTP se asume en minutos.
- El celular debe iniciar en 9 y tener 9 dígitos. El prefijo no está confirmado.
- Zona horaria del reinicio diario: `America/Lima`.
- El OTP es fijo (`OTP_MOCK_CODE`). El servicio real de terceros se sustituye por
  `MockOtpProvider`.
- Los PIN se hashean con scrypt. La caché de idempotencia está en memoria y no
  está cifrada.
- Los términos y la política de datos son provisionales hasta que compliance
  entregue el texto y la URL.

## Limitaciones

- Almacenamiento en memoria: al reiniciar el servidor se pierden las altas.
- Los límites solo se exponen en `GET /onboardings/current`. No se aplican a
  transferencias porque el módulo de transferencias no está en este alcance.
- `REGLAS.md` del laboratorio exige Java 25 + Quarkus + PostgreSQL. Este mock usa
  Node.js + Express por decisión del equipo para validar el prototipo. Migrar al
  stack definido antes de producción.
- La autenticación es simulada: el `userId` es el hash SHA-256 del token.
