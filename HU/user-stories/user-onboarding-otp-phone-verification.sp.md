# Verificación del celular con código OTP en el onboarding

## Fuente

- Historia padre: [Registro y activación del MVP de wallet](./user-onboarding-mvp-completion.sp.md) (criterios 1, 2, 3 y 5).
- Épica: [MVP de wallet en Perú](../epic/peru-wallet-mvp.sp.md) (meta de 3 minutos de onboarding).
- Decisión del Product Owner: el código OTP lo entrega un servicio de terceros. En este sprint se usa un mock.
- Decisión del Product Owner: el alias de usuario es el número de celular de 9 dígitos.
- Reglas aplicables: [reglas-security.md](../../reglas/reglas-security.md) §3.4, §4.5, §4.6, §4.7, §5.6, §7.3, §8.4.
- Pantallas de referencia: [endpoints_onboarding.md](../../docs/endpoints_onboarding.md), pantallas 2 y 3.

## Contexto actual

- El contrato anterior `docs/ENDPOINTS.md` fue eliminado. No definía envío, reenvío ni verificación de código SMS.
- El borrador [ONBOARDING-CONTRACT.md](../../docs/ONBOARDING-CONTRACT.md) define estos flujos en los pasos `phone` y `otp`. Está pendiente de aprobación.
- El prototipo tiene la pantalla 2 (número de celular y términos) y la pantalla 3 (código de 6 dígitos). El prototipo no define reenvío ni cambio de número.
- No hay proveedor OTP contratado. Se usará un mock detrás de una interfaz de integración.

## Problema confirmado

Para activar la wallet hay que confirmar que el usuario controla el celular que registra. Sin un paso de OTP definido, el onboarding no puede validar el celular de forma verificable ni cumplir la meta de 3 minutos de la épica.

## Comportamiento a preservar

- Los pasos del onboarding son visibles y el paso actual se indica en todo momento (criterio 1 de la historia padre).
- Un dato inválido o un código incorrecto bloquea el avance con un mensaje accionable (criterio 2).
- Inicio, finalización de cada paso y cierre se registran en servidor (criterio 4).
- `Idempotency-Key` es obligatorio al enviar pasos. Mismo valor con cuerpo distinto se rechaza como conflicto (contrato; reglas §4.7).

## Alcance

- Envío de un código de 6 dígitos al celular ingresado, solicitado por el servidor al proveedor OTP.
- Validación del código ingresado contra el proveedor. La validación ocurre siempre en el servidor.
- Bloqueo temporal de intentos tras varios códigos incorrectos consecutivos.
- Vencimiento del código después de un tiempo definido.
- Mock del proveedor OTP que permita ejecutar, sin proveedor real, los escenarios de código correcto, incorrecto, vencido y bloqueado.

## Fuera de alcance

- Contratación e integración del proveedor OTP real.
- Canales alternativos de envío (WhatsApp, llamada de voz).
- Verificación de DNI (ver [límite de S/ 10 sin DNI](./user-onboarding-low-limit-without-dni.sp.md)).
- Generación y presentación del PIN (ver [PIN autogenerado](./user-onboarding-generated-pin.sp.md)).
- Cambios en `docs/ONBOARDING-CONTRACT.md`. Esta spec no modifica el contrato.

## Criterios de aceptación

1. Un número de celular válido (9 dígitos, que es el alias del usuario; inicia en 9 [supuesto a confirmar]) dispara el envío de un código de 6 dígitos al proveedor OTP y la app muestra la pantalla de código.
2. La app no conoce ni compara el código esperado. Verificable revisando que ningún valor del código se devuelve en respuestas de éxito ni se almacena en el cliente.
3. Con el código correcto, la respuesta avanza al siguiente paso del onboarding.
4. Con código incorrecto, la respuesta es `422` con `errors[]` (`field`, `code`, `message`). La app muestra el `message` del servidor y no repite el código ingresado.
5. Después de N intentos fallidos consecutivos, el servidor bloquea nuevos intentos durante un periodo. N y el periodo son parámetros de configuración, no valores fijos en código.
6. Un código vencido se rechaza con un mensaje accionable que indica pedir un código nuevo. El tiempo de vigencia es un parámetro de configuración.
7. El código OTP no aparece en logs, trazas, métricas, analítica ni respuestas de error. Verificable con pruebas de no exposición (reglas §10.5).
8. Un reintento con la misma `Idempotency-Key` y el mismo cuerpo no envía un segundo código ni duplica el avance del paso.
9. El mock permite ejecutar automáticamente los escenarios de los criterios 3, 4, 5 y 6 sin acceso a un proveedor real.
10. El tiempo entre el ingreso del celular y la pantalla de cuenta lista se registra por evento, para medir la meta de 3 minutos (criterio 5 de la historia padre).

## Contratos afectados o protegidos

- `PUT /onboardings/current/steps/{stepId}`: paso de celular y paso de código. Los nombres de campo y los `stepId` son propuestas [P] que deben confirmarse antes de codificar.
- `errors[]` de `422 ValidationProblem`: se usa para código incorrecto, vencido y bloqueado.
- Envío de código y reenvío: no hay operación definida en el contrato. Debe resolverse la brecha 1 de [endpoints_onboarding.md](../../docs/endpoints_onboarding.md) antes de implementar.
- `docs/ONBOARDING-CONTRACT.md` queda protegido en esta spec.

## Riesgos, supuestos y preguntas abiertas

- **Seguridad (§3.4):** el alta de cuenta usa dos factores: OTP por SMS (posesión del celular) y PIN de 6 dígitos (conocimiento). Decisión del usuario; pendiente de validación formal con seguridad.
- **Riesgo SIM swap e interceptación de SMS:** el OTP por sí solo no protege operaciones de dinero. Por eso el límite de S/ 10 y el PIN de la otra spec son parte de la mitigación.
- **Parámetros pendientes:** número de intentos N, duración del bloqueo, vigencia del código y máximo de reenvíos. Los define seguridad. No se fijan en esta spec.
- **Reenvío y cambio de número:** ¿entran en este sprint? Sin ellos, un error de digitación obliga a reiniciar el flujo.
- **Formato del celular:** 9 dígitos, confirmados como alias del usuario. Que inicien en 9 sigue siendo supuesto a confirmar con producto.
- **Mock en entornos:** el mock no debe alcanzar producción (reglas §8.4). Debe quedar separado por entorno con credenciales distintas.
- **Pantalla 3 del prototipo:** el texto "Te quedan 2 intentos" no tiene respaldo en el contrato. No debe codificarse fijo.
