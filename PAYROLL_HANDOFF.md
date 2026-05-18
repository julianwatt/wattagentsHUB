# Payroll System — Handoff to Julian

**Branch:** `feature/payroll-system`
**Date:** 2026-05-17 (work executed 2026-05-17 → 2026-05-23 in 16 blocks)
**Status:** ready for manual validation.

> **Esta rama NO ha sido mergeada a `main`. Las migraciones NO han sido
> aplicadas en producción. El deployment de Vercel NO ha sido promovido a
> producción.** Todo lo que sigue requiere acción manual y consciente de
> Julian.

---

## 1. Estado de la rama

16 bloques ejecutados. 17 commits sobre `main`:

| # | Commit | Bloque |
|---|---|---|
| 01 | `6f09c18` | initial schema, RLS and types |
| 01b | `0cc96be` | es/en enum labels + trigger search_path hardening |
| 02 | `53ee7d4` | roster, user form integration, badge merge and rate management |
| 03 | `109262c` | plan mapping table, verify status and auto-reprocessing |
| 04 | `4297702` | file upload, parsing, sale status classification and winback detection |
| 05 | `b914ee0` | tier resolution, applicable rate function and pre-calc validation |
| 05b | `799c7f5` | fix: NULLS NOT DISTINCT in payroll_standard_rates unique index |
| 06 | `3bd41ed` | commission and override calculation with 3-level hierarchy and 3x validation |
| 07 | `192167f` | immutable snapshots, PDF generation and download flow |
| 08 | `11db351` | negative balances with carry-over and winback consolidation |
| 09 | `4db408a` | collections with installments and beneficiary credit |
| 10 | `db2c785` | company bonuses distribution and residuals management |
| 11 | `fb2de0d` | approval flow, publishing, 3x rule and re-publish logic |
| 12 | `bb250a8` | agent "Mis Pagos" view with current payfile, history and PDF download |
| 13 | `e3570c3` | manager views for direct and indirect teams with override privacy |
| 14 | `69b0105` | audit log full coverage and sales tracking view with search |
| 15 | `8b722f5` | centralized notification system with push, in-app and async dispatch |

**Build:** `npm run build` exitoso (sólo warning pre-existente de Next inferring workspace root).
**Type check:** `npx tsc --noEmit` limpio.
**Lints/TODOs/console.logs:** sin TODOs/FIXMEs ni console.log/console.debug en código de payroll. Sólo `console.warn`/`console.error` intencionales (push fallback, dispatcher recovery).

---

## 2. Cómo levantar un entorno de pruebas

> **No usar el proyecto de Supabase de producción.** Las migraciones se
> aplican a un Supabase branch o a un proyecto dedicado de pruebas.

### 2.1 Vercel preview
1. Importa la rama `feature/payroll-system` como **Preview Deployment** en Vercel (no Production).
2. Configura las env vars del `.env.example` apuntando al proyecto/branch de Supabase de pruebas, no a producción.
3. Genera VAPID keys nuevas (`npx web-push generate-vapid-keys`) — no reutilizar las de prod.
4. Vercel armará un URL `https://wattagents-hub-git-feature-payroll-system-<hash>.vercel.app`.

### 2.2 Supabase branch / proyecto de pruebas
1. Crea un branch de Supabase del proyecto principal **o** un proyecto totalmente nuevo. La rama de Supabase es la opción más simple y respeta el plan actual.
2. Aplica las migraciones del directorio `supabase/migrations/` en orden cronológico. Las migraciones específicas de payroll son:

   ```
   20260517_payroll_initial_schema.sql              (block 01)
   20260518_payroll_user_payroll_status.sql         (block 01b)
   20260519_payroll_plan_mappings_widen_term_and_seed.sql (block 03)
   20260520_payroll_uploads_block04.sql             (block 04)
   20260521_payroll_standard_rates.sql              (block 05)
   20260522_payfile_calc_extras.sql                 (block 06)
   20260523_payfile_pdfs_and_user_language.sql      (block 07)
   20260524_negative_balances_block08.sql           (block 08)
   20260525_collections_block09.sql                 (block 09)
   20260526_bonuses_residuals_block10.sql           (block 10)
   20260522_payroll_audit_search_indexes.sql        (block 14)
   20260523_payroll_notification_queue_block15.sql  (block 15)
   ```

   Todas las migraciones llevan bloque `ROLLBACK (manual)` al pie con el SQL inverso, comentado.

3. Verifica que `pg_trgm` esté habilitada (la migración de block 14 lo hace con `CREATE EXTENSION IF NOT EXISTS`).

### 2.3 Sembrar datos de prueba

Sugerido para escenarios A–I:

- 1 **CEO** + 1 **Admin** + 3 **Sr Managers** + 6 **Jr Managers** (2 bajo cada Sr) + 18 **agentes** (3 bajo cada Jr)
- Cada agente con 1–2 JE badges en `payroll_roster` (algunos con `valid_until` para probar histórico)
- 2–3 agentes con `roster_custom_rates` (D2D tier 0–4 + RETAIL)
- Mapeos iniciales en `plan_mappings` para los planes más comunes de tu catálogo JE (COMMISSION D2D, COMMISSION RETAIL, RCE_ADDER_D2D, RCE_ADDER_RETAIL, RESIDUAL_D2D, GREEN_BONUS)

Si quieres, te paso un script `seed_payroll_test.sql` cuando me pidas el bloque siguiente — no lo incluí en esta entrega porque depende de tu catálogo real de planes.

---

## 3. Credenciales de prueba

Todos los usuarios actuales del proyecto base tienen password **`Saratoga1`** (tú rotaste hashes en DB). Sembrar nuevos usuarios respeta ese mismo password si los creas con `createUser(...)` desde `src/lib/users.ts` pasándolo manualmente, o reutiliza los usuarios existentes asignándoles roles `agent` / `jr_manager` / `sr_manager` desde `/manage/users`.

Roles recomendados para la prueba:

| Rol | Username sugerido | Acceso |
|---|---|---|
| Admin | `julian` (tu cuenta) | `/payroll`, `/manage/users`, `/notifications` |
| CEO | `ceo_test` | `/payroll`, `/notifications` (aprobación) |
| Sr Manager | `sr1`, `sr2`, `sr3` | `/my-pay`, `/team` |
| Jr Manager | `jr1`..`jr6` | `/my-pay`, `/team` |
| Agente | `ag1`..`ag18` | `/my-pay`, `/activity` |

---

## 4. Archivos de prueba

- **Archivo principal de prueba** (JE Excel): el sample que usamos para block 04 vive en tu carpeta local de Claude (`27155_Watts_Distributors_LLC_US_Weekly_1524_FlatFee_May102026.xlsx`). Reutilízalo o genera variantes con:
  - 1 fila con `je_badge` que no existe en `payroll_roster` (badge huérfano → alerta admin).
  - 1 fila con `plan_name` que no existe en `plan_mappings` (status `VERIFY` → alerta admin).
  - 1 fila con `Total` negativo (chargeback).
  - 1 fila con plan tipo `RCE_ADDER_D2D` (genera entrada en `company_bonuses`).
  - 1 fila con plan tipo `RESIDUAL_D2D` (genera entrada en `residuals`).
  - 1 contrato que aparezca primero como `CHARGEBACK` y luego como `PAYABLE` (winback automático).

- **Archivo secundario de bonos** (sólo necesario si pruebas la vista de bonos masivos): cualquier xlsx con columnas `description`, `total_amount`, `bonus_type`. Pendiente de un sample real, puedes crear un payable manual desde la UI en lugar de subir un archivo.

---

## 5. Escenarios end-to-end (A → I)

> Después de cada escenario, abre `/payroll → Audit Log` y verifica que la
> acción quedó registrada con actor + descripción humanizada.

### A — Ciclo completo de nómina (CEO + Admin)
1. **Admin:** `/payroll → Pendientes → Subir archivo`. Selecciona el .xlsx principal con `pay_week=YYYY-MM-DD`.
2. Esperar a que `processing_status` pase a `PROCESSED` o `PARTIAL`. Si quedó `PARTIAL`, abre el archivo en la UI y revisa los row errors.
3. **VERIFY:** ve a `/payroll → Plan Mapping`, crea el mapeo del plan que faltaba (`plan_name → plan_type/tier/term`). Al guardar, el sistema reprocesa las filas VERIFY automáticamente.
4. **Badge huérfano:** ve a `/payroll → Roster`, busca el badge en la sección "Alertas" y asígnalo a un usuario.
5. **Bonos:** ve a `/payroll → Bonos` y crea un company bonus manual (o sube xlsx secundario). Pulsa "Distribuir" y reparte entre 3 agentes con montos custom.
6. **Collection:** ve a `/payroll → Collections`. Crea una con beneficiario CEO, 3 parcialidades, semana inicio = la semana del payfile.
7. **Calcular:** vuelve a `/payroll → Pendientes` y pulsa "Calcular semana". Esperarás algunos segundos (PDFs no se generan aún).
8. **Editar line items:** entra a un payfile.
   - Edita un monto por `< 3× JE` → debería pasar sin alerta.
   - Edita otro `> 3× JE` → debería marcar `requires_ceo_approval` y bloquear el publish gate.
9. **Enviar a CEO:** pulsa "Enviar a aprobación CEO". El payfile pasa a `PENDING_APPROVAL`. El CEO recibe push + bell.
10. **CEO:** entra a `/payroll → Aprobación`. Aprueba los items >3× individualmente con la acción "Aprobar 3×". Edita un monto cualquiera (CEO no genera flag). Pulsa "Aprobar y publicar".
11. **Publicación:** verifica que el sistema generó `payfile_versions` v1 con PDF en Storage. Cada agente recibe push y ve su payfile en `/my-pay`.

### B — Republicación pequeña (<$500)
1. Reabre un payfile publicado (`/payroll → Publicadas → Reabrir`).
2. Edita un line item por <$500 sobre el total.
3. Pulsa "Republicar". Debería bypassear al CEO y publicar v2 directo.
4. El dueño recibe push "Tu payfile fue actualizado".
5. Admin/CEO ven v1 y v2 en histórico; el dueño sólo ve la última.

### C — Republicación grande (>$500)
1. Reabre, edita por >$500. Pulsa "Republicar" → error: excede umbral.
2. Pulsa "Enviar a aprobación CEO". CEO recibe notif tipo `payroll_large_change_republish`.
3. CEO aprueba → v2 publicado.

### D — Rechazo del CEO
1. Admin envía a aprobación.
2. CEO va a `/payroll → Aprobación` y pulsa "Rechazar" con notas obligatorias.
3. Payfile vuelve a `DRAFT`. Admin recibe inbox alert `payroll_week_rejected_by_ceo` con notas visibles.
4. Admin corrige y reenvía.

### E — Vistas de agente y manager
1. Login agente → `/my-pay`. Verifica categorías (COMMISSION, OVERRIDE, COMPANY_BONUS, NEGATIVE_BALANCE_COLLECTION, COLLECTION, MANUAL_ADJUSTMENT). Pulsa "Descargar PDF".
2. Login Jr Manager → `/my-pay → Mi Equipo`. Selecciona semana, abre payfile de un agente bajo su mando. Confirma que **no ve overrides de managers que no son él ni de su downline**.
3. Login Sr Manager → `/my-pay → Mi Equipo` con vista jerárquica + flat. Abre payfile de un Jr Manager bajo su mando; verifica privacidad.

### F — Saldos negativos y winback
1. Edita un payfile para que el total quede negativo (chargebacks > comisiones). Calcula y publica.
2. Sistema crea `negative_balance` con `auto_generated_for_payfile_id`. El total del payfile queda forzado a $0.
3. Siguiente semana, calcula payfile del mismo agente — el saldo se cobra parcial o completo (orden FIFO por `origin_week`).
4. Ciclo PAYABLE → CHARGEBACK → PAYABLE para el mismo `contract_id`. La segunda fila PAYABLE entra como `WINBACK` con flag visual ↺ en Rastreo.

### G — Collections con parcialidades
1. Crea collection 5 parcialidades. Calcula payfiles consecutivos del deudor — el sistema cobra 1 parcialidad por semana hasta agotar.
2. Después de 3 parcialidades cobradas, pulsa "Cancelar collection" (con motivo).
3. Verifica que las 2 parcialidades restantes no se aplican en payfiles futuros.

### H — Fusión de agentes
1. En `/payroll → Roster`, crea dos usuarios `agent` con badges JE distintos (misma persona física).
2. Pulsa el botón "Fusionar". En el modal, marca uno como **source** y otro como **destination**. Pulsa "Vista previa".
3. Confirma el preview (badges a mover, ventas futuras a re-apuntar). Escribe `FUSIONAR` y ejecuta.
4. Verifica:
   - Source queda inactivo con nota de fusión en el nombre.
   - Badges del source están ahora bajo destination.
   - Ventas con `pay_week` (= ya publicadas) siguen apuntando al source.
   - Ventas sin `pay_week` (futuras) apuntan al destination.
   - Audit log tiene `roster_merge` con preview completo.

### I — Audit log y rastreo
1. **Audit Log** (`/payroll → Audit Log`): filtra por actor, por entity_type, por rango de fechas. Expande una fila — ve el JSON diff old/new. Pulsa "Exportar CSV".
2. **Rastreo** (`/payroll → Rastreo`): busca por contract_id parcial, por customer_name parcial, por badge. Abre una venta — drawer con datos JE + procesamiento + line items + cadena de winback + audit entries relacionados. Pulsa "Exportar CSV".

---

## 6. Bugs conocidos / advertencias

Ninguno bloqueante. Notas menores que vale la pena tener en mente:

- **Worker de notificaciones manual.** `/api/payroll/notifications/process` no tiene cron configurado todavía. Mientras tanto, el push se queda en la cola hasta que un admin/CEO invoque el endpoint o se configure un Vercel Cron. Decisión deliberada para no acoplar deploy a infra de scheduling.
- **`payfile_change_notifications` queda como tabla legacy.** Block 11 la usaba como inbox de payfile-published; block 15 movió la responsabilidad a `user_notifications` + `payroll_notification_queue`. La tabla sigue existiendo (drop manual cuando ya no necesites el histórico).
- **Build warning pre-existente** sobre Next.js inferring workspace root. No relacionado con payroll. Se puede silenciar fijando `turbopack.root` en `next.config.ts`.
- **Realtime supabase** sigue activa para `admin_notifications`, `user_notifications`, `payfile_change_notifications`, `je_badge_alerts`. Verifica que la rama de Supabase tenga el publication `supabase_realtime` sincronizada — las migraciones de block 01 + assignments la pueblan.
- **Sample xlsx de bonos.** Los escenarios A–I usan el archivo principal de block 04. Si quieres probar el flujo de archivo secundario de bonos como tipo `BONUS`, primero genera un xlsx real con esa estructura — no incluí sample.

---

## 7. Decisiones pendientes para Julian

1. **Cuándo crear el PR a `main`.** Cuando termines de validar los escenarios A–I + carga + seguridad.
2. **Cuándo aplicar migraciones en producción.** Sólo después de mergear el PR y antes del primer deploy a prod. Aplícalas en bloque siguiendo el orden cronológico de los timestamps. Todas tienen `ROLLBACK` documentado.
3. **Cómo planear el rollout.**
   - **Opción A — Big bang:** merge + apply prod migrations + promote Vercel + procesar primera semana real. Riesgo alto, recuperación = rollback de migraciones + redeploy a commit anterior.
   - **Opción B — Shadow run:** mantener payroll desactivado en nav para todos excepto admin/CEO (`MY_PAY_NAV` y `PAYROLL_NAV` ya están gated por rol). Subir archivo real en paralelo al manual durante 1–2 semanas, comparar resultados, luego desbloquear para agentes/managers. **Recomendado.**
4. **Comunicación con operaciones:** capacitar al admin operativo en el flujo semanal (ver sección 8 abajo) antes de abrir a agentes. Idealmente con 1 sesión guiada subiendo un archivo real en preview.
5. **Push notifications en prod:** generar VAPID keys nuevas en prod (no reutilizar las de preview). Asegurar que el service worker (`public/sw.js`) está cacheado correctamente en cada device antes de publicar el primer payfile real.
6. **Eliminar la rama:** sólo después del primer ciclo completo en prod sin incidencias.

---

## 8. Documentación de operación (manual del admin)

### 8.1 Flujo semanal estándar

Cada lunes (o el día que cierras semana JE):

1. **Subir archivo JE.** `/payroll → Pendientes → Subir archivo`. Selecciona el xlsx semanal y la `pay_week`. Espera el verde.
2. **Resolver VERIFY.** `/payroll → Plan Mapping`. Cualquier plan nuevo aparecerá con badge rojo. Asigna `plan_type`/`tier`/`term` y guarda. El sistema reprocesa las ventas automáticamente.
3. **Resolver badges huérfanos.** `/payroll → Roster → Alertas`. Asigna cada badge JE no registrado al usuario correspondiente. El sistema back-fillea las ventas que estaban en limbo.
4. **Revisar Bonos.** `/payroll → Bonos`. Confirma los company bonuses auto-creados por RCE adders. Si hay bonos manuales (por desempeño, concursos, etc.), agrégalos con "Nuevo bono" y pulsa "Distribuir".
5. **Crear Collections.** `/payroll → Collections`. Si la operación o RH te pasaron descuentos (préstamos personales, anticipos), captúralos con beneficiario CEO (o vacío para "empresa").
6. **Calcular semana.** `/payroll → Pendientes → Calcular`. Esperar 30–60s.
7. **Revisar Aprobación.** `/payroll → Aprobación`. Verifica totales por persona. Si necesitas ajustar un line item, hazlo aquí — si superas 3× del JE original, el sistema marcará "Requiere CEO" y bloqueará el publish.
8. **Enviar a CEO.** Pulsa "Marcar lista para CEO". El CEO recibe push + bell.
9. **Esperar aprobación.** Si el CEO rechaza, recibirás bell con notas — corrige y reenvía.
10. **Verificar publicación.** Cuando el CEO apruebe, el sistema genera snapshots + PDFs + push a cada agente. Cuenta en `/payroll → Publicadas` debe coincidir con el número de personas que cobran esa semana.

### 8.2 Resolución de problemas comunes

| Síntoma | Causa | Cómo arreglarlo |
|---|---|---|
| Fila en VERIFY que no puedo mapear porque no entiendo el plan | Plan JE nuevo, sin equivalencia interna | Pregunta al equipo JE/Ventas qué representa antes de mapear. No mapees al azar — afecta comisiones de varios agentes. |
| Falta agente en roster, pero recuerdo que existía | Usuario inactivo o sin badge JE registrado | `/manage/users` → busca y reactiva. Luego `/payroll → Roster → Agregar badge`. |
| Necesito ajustar un monto que el sistema calculó mal | Tarifa custom faltante, mapping incorrecto, etc. | **Antes** de editar manualmente: revisa si la causa raíz es un mapping o una tarifa. Edita el line item sólo si es excepción puntual. Pon nota explicativa. |
| CEO rechazó la semana | Hay problema con los números | Lee las notas del rechazo en `/payroll → Aprobación`. Corrige, reenvía. |
| Push no llega a un agente | Subscripción expirada o no permitida | El agente debe abrir `/my-pay` y aceptar el push opt-in banner. La cola reintenta hasta 3 veces antes de marcar `failed`. |

### 8.3 Casos especiales

- **Bono con distribución manual:** `/payroll → Bonos → Nuevo bono`. Pulsa "Distribuir" e indica receptor + monto por cada agente. La suma puede ser menor al total (lo restante queda como `remaining_for_company`).
- **Agente con saldo negativo que regresa:** cuando reactivas un usuario inactivo con saldo pendiente, recibes alerta admin `payroll_balance_reactivated`. El saldo se aplicará automáticamente en su próximo payfile (parcial o completo, FIFO por `origin_week`).
- **Collection con beneficiario CEO:** crea la collection normal y selecciona "CEO" como beneficiario. El sistema agregará un line item positivo al payfile del CEO por cada parcialidad cobrada.
- **Fusión de agentes:** sólo cuando dos usuarios representan a la misma persona física (ej: agente cambió de razón social JE). Usa el botón "Fusionar" en Roster, escribe `FUSIONAR` y ejecuta. Payfiles pasados del source quedan intactos — históricamente fueron él.

### 8.4 Glosario

- **Payfile:** documento de pago semanal por persona. Atraviesa estados DRAFT → PENDING_APPROVAL → APPROVED → PUBLISHED.
- **Line item:** una fila dentro del payfile (comisión, override, bono, cobro de saldo negativo, collection, ajuste manual).
- **Override:** comisión que un manager recibe sobre las ventas de su downline.
- **VERIFY:** estado de una venta cuyo plan no está mapeado todavía. No paga hasta que el admin resuelva el mapeo.
- **Winback:** venta PAYABLE de un contrato que previamente había sido CHARGEBACK. Sistema lo detecta automáticamente y marca con ↺.
- **Saldo negativo:** deuda que el agente tiene con la empresa por chargebacks que superaron sus comisiones de esa semana. Se cobra automáticamente FIFO en payfiles futuros.
- **Tier:** nivel de comisión (0–4 en D2D). Se asigna por venta según `plan_mapping.tier` o `roster_custom_rates`.
- **3× rule:** límite de seguridad — un line item editado a más de 3× el JE original requiere aprobación CEO individual antes de poder publicar el payfile.
- **Republicación:** nueva versión de un payfile ya publicado. Si el delta es ≤ $500, admin republica directo; si excede, debe pasar de nuevo por CEO.

---

## 9. Bajo control exclusivo de Julian

- Validación cruzada de cálculos contra nóminas históricas reales.
- Crear el PR `feature/payroll-system → main`.
- Merge a main.
- Aplicar migraciones en el Supabase de producción.
- Promover deployment Vercel a producción.
- Sembrar mapeos iniciales en producción.
- Procesar la primera nómina real.
- Comunicación con el equipo + capacitación al admin operativo.
- Decisión de eliminar la rama una vez estabilizado.
