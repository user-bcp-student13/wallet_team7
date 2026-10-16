# Límite de S/ 10 sin verificación de DNI en el onboarding

## Fuente

- Historia padre: [Registro y activación del MVP de wallet](./user-onboarding-mvp-completion.sp.md) (criterio 3).
- Épica: [MVP de wallet en Perú](../epic/peru-wallet-mvp.sp.md) (límites alineados a cumplimiento; límites de proveedor pueden estar por debajo del máximo regulatorio).
- Decisión del Product Owner:
  - El límite por transferencia en este MVP es de S/ 10.
  - El máximo es de 5 transferencias por día.
  - El onboarding inicial y las transferencias de hasta S/ 10 no solicitan DNI.
  - Los límites superiores y la verificación de DNI para ellos se desarrollan en un sprint siguiente.
- Reglas aplicables: [reglas-security.md](../../reglas/reglas-security.md) §3.5, §4.6, §7.1, §7.2, §9.1.
- Pantalla de referencia actual: pantalla 5 de [endpoints_onboarding.md](../../docs/endpoints_onboarding.md) y del [prototipo](../../docs/prototipo-onboarding-celular.html). Muestran un límite de PEN 300 y un banner "Verifica tu DNI" que quedan desactualizados con esta decisión.

## Contexto actual

- La pantalla 5 del prototipo muestra un límite diario de PEN 300 y un banner para verificar DNI. Ambos son ejemplos sin fuente.
- El contrato no devuelve límites ni tiene un paso de DNI (brecha 6 de [endpoints_onboarding.md](../../docs/endpoints_onboarding.md)).

## Problema confirmado

El diseño actual muestra un límite y un requisito de DNI que no corresponden al alcance decidido para el MVP. Sin corregirlo, la app presentaría al usuario reglas que el negocio no aplicará.

## Comportamiento a preservar

- El flujo de pagos de bajo monto sigue disponible después de la activación (criterio 3 de la historia padre).
- Los pasos de celular, OTP y PIN no cambian por esta spec. Ver las specs de [OTP](./user-onboarding-otp-phone-verification.sp.md) y de [PIN](./user-onboarding-generated-pin.sp.md).
- Los límites se aplican en servidor, nunca solo en la app (reglas §3.5).

## Alcance

- Límite de S/ 10 por transferencia y de 5 transferencias por día, aplicados por el servidor a las transferencias de bajo monto del MVP.
- Transferencias de hasta S/ 10 sin solicitud de DNI.
- Onboarding sin paso de DNI.
- Pantalla "Cuenta lista" sin banner de DNI. Muestra el límite por transferencia (S/ 10) y el máximo diario (5) que devuelve el servidor.
- Rechazo de transferencias superiores a S/ 10, y de la sexta transferencia del día, con mensaje accionable que no solicita DNI ni promete aumentos.

## Fuera de alcance

- Verificación de DNI y cualquier límite superior a S/ 10 (siguiente sprint).
- Validación de DNI contra un servicio externo.
- Límites por usuario o por perfil.
- Comisiones, cargos o tarifas.
- Cambios en `docs/ONBOARDING-CONTRACT.md`. Esta spec no modifica el contrato.

## Criterios de aceptación

1. El flujo de onboarding no contiene ningún paso de DNI. Verificable revisando la lista de pasos que devuelve el servidor.
2. La pantalla "Cuenta lista" no muestra banner de DNI ni el valor "PEN 300". Muestra el límite por transferencia (S/ 10) y el máximo diario (5 transferencias) que devuelve el servidor.
3. Una transferencia de S/ 10.00 se completa sin solicitar DNI, siempre que el usuario no haya superado 5 transferencias en el día.
4. Una transferencia de S/ 10.01 se rechaza. La respuesta incluye un mensaje accionable de límite superado y no solicita DNI.
5. El límite por transferencia (S/ 10) y el máximo diario (5 transferencias) son parámetros de configuración del servidor. No están fijos en la app ni en código de cliente. Verificable revisando la configuración por entorno.
6. Pruebas automáticas cubren: 10.00 aceptado, 10.01 rechazado, la quinta transferencia del día aceptada, la sexta rechazada con mensaje accionable que no solicita DNI ni promete aumentos, y montos no válidos (cero, negativos, con más de dos decimales) rechazados con `422`.
7. El rechazo por monto o por cantidad diaria se registra como evento sin datos personales (reglas §7.3).
8. La respuesta de rechazo no refleja el monto ni otros datos ingresados por el usuario (reglas §4.5).
9. La incorporación futura de un paso de DNI no requiere cambiar la estructura de pasos ni de respuestas existente (verificable revisando que el contrato solo añade pasos, no los reemplaza).

## Contratos afectados o protegidos

- `Onboarding`: el contrato no tiene campos de límite por transferencia ni de máximo diario. Si la app debe mostrarlos, hay que decidir dónde se exponen (campo nuevo en `Onboarding` o en la respuesta de la wallet). Queda pendiente.
- `PUT /onboardings/current/steps/{stepId}`: sin paso de DNI. No cambia en esta spec.
- `docs/ONBOARDING-CONTRACT.md` queda protegido en esta spec.

## Riesgos, supuestos y preguntas abiertas

- **Monto máximo diario (derivado):** 5 transferencias de S/ 10 dan un total de S/ 50 por día. Es una consecuencia de las dos reglas, no una decisión separada. Confirmar con producto que ese total es el esperado.
- **Día de conteo:** falta definir la zona horaria (Perú) y el momento en que se reinicia el conteo de 5 transferencias. Confirmar con producto.
- **Cumplimiento:** falta confirmar con compliance que S/ 10 sin DNI cumple la normativa aplicable a una wallet en Perú. No se asume.
- **Límite del proveedor:** la épica indica que el límite de un proveedor puede estar por debajo del máximo regulatorio. Si el proveedor real tiene un límite menor a S/ 10, debe prevalecer el más bajo.
- **Cuentas sin DNI:** sin DNI, la identidad depende de celular, OTP y PIN. Este riesgo queda mitigado por el límite bajo, pero no eliminado. Ver riesgos de las otras dos specs.
- **Rechazo o solicitud pendiente:** supuesto de que una transferencia superior a S/ 10 se rechaza. Confirmar que no debe quedar en espera.
- **Banner de DNI en el prototipo:** la pantalla 5 del prototipo y la brecha 6 de [endpoints_onboarding.md](../../docs/endpoints_onboarding.md) deben corregirse antes de codificar.
