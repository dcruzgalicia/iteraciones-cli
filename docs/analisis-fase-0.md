# Fase 0 — Estabilización: análisis arquitectónico

> Fecha: 17 de mayo de 2026  
> Versión analizada: `main` (tras merge de PR #195)

---

## 1. Evaluación del bloque actual

**Madurez: MVP funcional con 5 bugs confirmados y 2 riesgos estructurales.**

El código fuente revela exactamente lo que el ROADMAP diagnostica, pero con matices importantes:

**Lo que está bien:**
- `src/template/` es el módulo más limpio del proyecto: lexer → parser → AST → renderAst es una cadena funcional y correcta. Las funciones son puras (sin I/O), con responsabilidades claras. `renderFor` maneja correctamente tanto objetos planos como primitivos. `isTruthy` es coherente. Este módulo es testeable de inmediato.
- `mapWithConcurrency` en `src/output/concurrency.ts` ya existe y está bien implementada (workers paralelos con preservación de orden).
- La arquitectura del pipeline tiene lógica de separación razonable (`discover → classify → render → compose → write`).
- El `CacheManager` con scopes `render`/`compose` y la invalidación con `prune()` al final del build es una decisión correcta.

**Lo que está mal (bugs confirmados en el código real):**

### Bug 0.1 — `hash()` sin separador

```typescript
// src/cache/hasher.ts — actual
for (const value of values) {
  hasher.update(value);  // sin separador entre values
}
// hash("ab", "c") === hash("a", "bc") — COLISIÓN REAL
```

### Bug 0.2 — `IGNORED_DIRS` triplicado

Confirmado en 3 ubicaciones con definición idéntica:
- `discover.ts:5` — `const IGNORED_DIRS = new Set([...])`
- `validate.ts:7` — `const IGNORED_DIRS = new Set([...])`
- `document-loader.ts:17` — `const IGNORED_DIRS = new Set([...])` (dentro de función)

Un cuarto directorio que se deba ignorar requiere 3 cambios sincronizados. Ya ocurrió con `.iteraciones`.

### Bug 0.3 — `SourceDocument` duplicado (issue #19)

`document-loader.ts` define e implementa `SourceDocument`. El comentario en el código dice `// stub: SourceDocument se mueve a src/builder/types.ts en el issue #19`. Esta deuda está documentada pero activa.

### Bug 0.4 — `makeRelativeContext` sin guard de profundidad

```typescript
// orchestrator.ts — sin límite de recursión
function makeRelativeContext(value: unknown, prefix: string): unknown {
  // ...
  if (Array.isArray(value)) return value.map((item) => makeRelativeContext(item, prefix));
  if (typeof value === 'object')
    return Object.fromEntries(Object.entries(...).map(([k, v]) => [k, makeRelativeContext(v, prefix)]));
}
```

Un plugin que inyecte un objeto circular en el `TemplateContext` produce stack overflow silencioso en producción. Los contextos son `Readonly<...>` pero eso no impide que un plugin retorne un objeto con referencia circular (el guard de `Readonly` es en tiempo de compilación, no de runtime).

### Bug 0.5 — `copyLogo` silencioso con `.catch(() => undefined)`

```typescript
await cp(src, dest).catch(() => undefined);
```

Un logo mal configurado (`logo: /ruta/inexistente.svg`) falla silenciosamente. El usuario ve un `<img>` roto sin ninguna advertencia en el build. Además: **no hay validación de path traversal** — `logo: ../../etc/passwd` copiaría el archivo a `outputDir` sin error.

### Bug 0.7 — `writeDocuments` usa `Promise.all` ignorando `ctx.concurrency`

```typescript
return Promise.all(docs.map(async (doc) => { ... writeFile(...) }));
```

Para 300+ documentos, lanza 300+ promesas de I/O simultáneas. `mapWithConcurrency` ya existe en `src/output/concurrency.ts` pero no se usa aquí.

---

## 2. Objetivo ideal de la Fase 0

La Fase 0 no cambia la arquitectura — la estabiliza. El objetivo es que el código existente haga exactamente lo que promete, sin bugs ocultos ni riesgos de regresión al añadir funcionalidad.

**El sistema estabilizado debería:**
- Garantizar que dos claves de caché distintas nunca colisionen
- Tener una única fuente de verdad para las constantes del proyecto
- Fallar ruidosamente ante configuraciones incorrectas (logo inexistente, etc.)
- Ser completamente testeable en `src/template/` antes de añadir un solo feature
- Limitar el I/O de escritura al mismo nivel de concurrencia que el resto del pipeline
- Eliminar el `SourceDocument` huérfano que complica el grafo de tipos

**Lo que NO debe hacer la Fase 0:**
- Cambiar el contrato público de ninguna función exportada
- Introducir abstracciones nuevas
- Añadir dependencias
- Tocar el orquestador más allá del guard de profundidad y el `mapWithConcurrency`

---

## 3. Roadmap por tareas

### Tarea 0.1 — Fix del hash sin separador *(urgencia: alta)*

**Cambio mínimo y correcto:**

```typescript
export function hash(...values: string[]): string {
  const hasher = new Bun.CryptoHasher('sha256');
  for (const value of values) {
    hasher.update(value);
    hasher.update('\0');  // separador nulo — jamás aparece en paths o markdown
  }
  return hasher.digest('hex');
}
```

**Impacto:** Invalida toda la caché existente en proyectos en uso. Las entradas antiguas quedan huérfanas en `.iteraciones/cache/` y se limpian con el próximo `prune()`. Documentar en CHANGELOG.

**Por qué `\0`:** Los valores que recibe `hash()` son rutas de archivo, markdown, versiones del CLI (ej. `"1.2.3"`) y JSON de plugins. El byte nulo nunca aparece en ninguno de ellos — es el separador más robusto posible.

### Tarea 0.2 — Unificar `IGNORED_DIRS` *(urgencia: media)*

```typescript
// src/constants.ts
export const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', '.iteraciones']);
```

Los tres archivos importan desde `'../constants.js'` (o `'../../constants.js'` según profundidad). El cambio es mecánico. La unificación previene la divergencia futura entre scanners.

### Tarea 0.3 — Eliminar `SourceDocument` duplicado *(urgencia: baja)*

```typescript
// src/loader/document-loader.ts
export type { SourceDocument } from '../builder/types.js';
// mantener loadDocuments() — es usada por el orquestador
```

Verificar con grep que nada importa `SourceDocument` desde `document-loader.ts` directamente antes del cambio.

### Tarea 0.4 — Guard de profundidad en `makeRelativeContext` *(urgencia: media)*

```typescript
function makeRelativeContext(value: unknown, prefix: string, depth = 0): unknown {
  if (depth > 20) throw new Error('makeRelativeContext: profundidad máxima excedida (posible objeto circular)');
  // ...
  if (Array.isArray(value)) return value.map((item) => makeRelativeContext(item, prefix, depth + 1));
  if (typeof value === 'object')
    return Object.fromEntries(Object.entries(...).map(([k, v]) => [k, makeRelativeContext(v, prefix, depth + 1)]));
}
```

El límite de 20 cubre cualquier contexto legítimo (el más profundo en producción tiene ~6 niveles). Usar `throw` en lugar de silenciar para que los plugins mal escritos fallen ruidosamente.

### Tarea 0.5 — `copyLogo` ruidoso con validación *(urgencia: alta — seguridad)*

```typescript
async function copyLogo(outputDir: string, cwd: string, siteConfig: SiteConfig): Promise<void> {
  const logo = siteConfig.logo?.trim();
  if (!logo) return;

  // Guardia de seguridad: rechazar rutas que escapen del cwd
  if (logo.includes('..') || logo.startsWith('/')) {
    process.stderr.write(`[assets] logo: ruta inválida "${logo}" — debe ser relativa al proyecto\n`);
    process.exitCode = 1;
    return;
  }

  const src = join(cwd, logo);
  const dest = join(outputDir, logo);
  await mkdir(dirname(dest), { recursive: true });
  await cp(src, dest).catch((err: NodeJS.ErrnoException) => {
    process.stderr.write(`[assets] No se pudo copiar el logo "${logo}": ${err.message}\n`);
    // No abortar el build — el sitio funciona sin logo
  });
}
```

### Tarea 0.6 — Test suite de `src/template/` *(urgencia: crítica estratégica)*

El motor de templates tiene exactamente las propiedades ideales para empezar: sin I/O, sin dependencias externas, funciones puras.

**Estructura de tests propuesta:**

```
src/template/__tests__/
  lexer.test.ts          — tokenización de cada tipo de token
  parser.test.ts         — parsing de if/else, for/sep, anidamiento
  renderer.test.ts       — renderAst completo: variables, condicionales, loops
  context.test.ts        — resolveValue (rutas dotted), coerceToString, isTruthy
  integration.test.ts    — templates completos con contexto real (como los de prod)
```

**Casos críticos a cubrir:**

```typescript
// Colisión de scope en $for$: el item no debe contaminar el scope padre tras el loop
// Anidamiento: $if(a)$$for(b)$$if(c)$$x$$endif$$endfor$$endif$
// Separador sin cuerpo: $for(x)$$sep$$endfor$
// Variable dotted en contexto anidado: $author.name$
// ESCAPE: $$variable$$ no interpola
// Condición con array vacío es falsy
// $for$ sobre primitivo único (toIterable retorna [value])
```

Meta: >80% de cobertura verificable con `bun test --coverage`.

### Tarea 0.7 — `writeDocuments` con `mapWithConcurrency` *(urgencia: media)*

```typescript
import { mapWithConcurrency } from '../../output/concurrency.js';

export async function writeDocuments(docs: BuildDocument[], ctx: BuildContext): Promise<BuildDocument[]> {
  return mapWithConcurrency(docs, ctx.concurrency, async (doc) => {
    if (doc.outputHtml === undefined) {
      throw new Error(`writeDocuments: outputHtml no definido en "${doc.relativePath}"`);
    }
    const outputPath = resolveOutputPath(doc.relativePath, ctx.outputDir);
    await writeFile(outputPath, doc.outputHtml);
    return { ...doc, outputPath };
  });
}
```

**Impacto real:** en un sitio de 300 documentos, `Promise.all` abre 300 file descriptors simultáneos. En macOS el límite por defecto es 256 (`ulimit -n`). El build puede fallar con `EMFILE` (too many open files) en sitios grandes.

---

## 4. Problemas críticos por severidad

| # | Problema | Severidad | Urgencia | Dificultad | Impacto arq. |
|---|---|---|---|---|---|
| 0.5 | `copyLogo` path traversal | **Alta** (seguridad) | Alta | Baja | Bajo |
| 0.1 | Hash sin separador (colisiones) | Alta | Alta | Muy baja | Medio |
| 0.7 | `Promise.all` en writeDocuments (`EMFILE`) | Media-Alta | Media | Muy baja | Bajo |
| 0.4 | `makeRelativeContext` sin guard | Media | Media | Baja | Medio |
| 0.6 | Ausencia de tests | Media | Alta (estratégica) | Media | Muy alto |
| 0.2 | `IGNORED_DIRS` triplicado | Baja | Baja | Muy baja | Bajo |
| 0.3 | `SourceDocument` duplicado | Baja | Baja | Baja | Bajo |

> **El más peligroso a largo plazo no es el hash (es raro que colisione en práctica) sino la ausencia de tests.** Cada refactoring en la Fase 1 del ROADMAP requiere confianza en que el motor de templates sigue funcionando. Sin tests, la Fase 1 es de hecho imposible de ejecutar con seguridad.

---

## 5. Evolución técnica

**Lo que vale la pena sofisticar en Fase 0:**

- `hash()`: el separador `\0` es suficiente. No añadir más complejidad.
- Tests del motor de templates: invertir tiempo real aquí — son la base de todo.
- `mapWithConcurrency`: ya existe, solo hay que usarla donde falta.

**Lo que debe mantenerse simple:**

- `IGNORED_DIRS`: un `Set` en `constants.ts` es exactamente la complejidad correcta. No convertirlo en configuración dinámica todavía.
- `makeRelativeContext`: el guard de profundidad es suficiente por ahora. La refactorización profunda del orquestador pertenece a la Fase 1.
- `copyLogo`: agregar el warning y la validación básica. No sobreingenierizar el manejo de assets hasta la Fase 3.

**Lo que NO vale la pena hacer en Fase 0:**

- Reemplazar `Bun.CryptoHasher` por `node:crypto` (no aporta nada, rompe la consistencia)
- Abstraer el pipeline de `buildAssets` (es una Fase 3 completa por sí misma)
- Diseñar el sistema de tests de integración (Fase 1)

---

## 6. Comparación con otros sistemas

| Aspecto | iteraciones-cli | Hugo | Eleventy | Astro |
|---|---|---|---|---|
| **Hash de caché** | SHA-256 manual sin sep. | fnv1a con separadores | MD5 del contenido | Vite hash |
| **Tests del motor** | ❌ Ausente | Tests de integración | Tests unitarios + integ. | Vitest completo |
| **I/O de escritura** | Promise.all sin límite | Worker pool Go | Streams | Vite paralelo |
| **Ignored dirs** | Triplicado | Constante central | Config `.eleventyignore` | gitignore-aware |

**Lecciones aplicables:**
- Hugo usa un `fnv1a` concatenado con un byte separador fijo desde v0.1 — este problema lo resolvieron en el primer mes.
- Eleventy tiene tests unitarios del motor de templates Nunjucks desde antes de la v1.0 — es el motivo por el que pudieron refactorizar el motor completo en v2.0 sin regressions.
- mdBook tiene una lista de directorios ignorados en `config.rs` como constante de módulo, importada en todos los scanners.

---

## 7. Features futuras relevantes a la Fase 0

**Fundamentales (bloquean todo lo demás):**
- Test suite de `src/template/` — sin esto, la Fase 1 es inestable
- Hash con separadores — sin esto, la caché es semánticamente incorrecta

**Diferenciadoras (habilitan la Fase 1 con confianza):**
- Tests de integración mínimos del pipeline (fixture `index.md` → `index.html` correcto)
- `iteraciones validate` con detección de items inexistentes en collections

**Visionarias (no pertenecen a Fase 0):**
- Caché de CSS de Tailwind basada en hash de templates
- Build incremental real en `serve` mode

---

## 8. Riesgos a largo plazo

**El riesgo más grave no está en el código de la Fase 0, sino en la secuencia:**

Si se salta la Fase 0 y se empieza directamente con la Fase 1 (refactoring del orquestador), el resultado es casi seguramente una regresión que tarda días en detectar porque no hay tests. El orquestador tiene ~380 líneas con 9 tipos de documentos procesados en orden específico. Tocarlo sin cobertura de tests es un riesgo real de destruir el pipeline.

**El hash sin separador** es técnicamente un bug activo, pero en la práctica la colisión requiere que dos documentos distintos produzcan exactamente el mismo hash concatenado — raro pero posible si un usuario tiene nombres de archivo y versiones del CLI que se concatenan igual.

**`EMFILE` en `writeDocuments`** es el bug más probable de manifestarse en producción con sitios de más de 200 documentos en macOS con `ulimit -n 256`.

---

## 9. Backlog técnico accionable

```
Milestone 0 — Estabilización

[ ] fix(cache): añadir separador \0 en hash()            — 30min — RIESGO: invalida caché
[ ] fix(assets): validar y advertir logo inexistente      — 1h    — RIESGO: seguridad path
[ ] fix(write): usar mapWithConcurrency en writeDocuments — 30min — RIESGO: EMFILE
[ ] fix(orchestrator): guard de profundidad en makeRelativeContext — 1h
[ ] chore: crear src/constants.ts con IGNORED_DIRS        — 30min
[ ] chore: eliminar SourceDocument de document-loader.ts  — 1h
[ ] test: lexer.test.ts                                   — 2h
[ ] test: parser.test.ts                                  — 2h
[ ] test: renderer.test.ts (incluye for/if/sep/escape)    — 3h
[ ] test: context.test.ts (resolveValue, coerceToString, isTruthy) — 1h
[ ] test: integration.test.ts (template completo → HTML)  — 2h
```

**Orden recomendado:** 0.5 (seguridad) → 0.1 (correctness) → 0.7 (estabilidad I/O) → 0.6 (tests) → 0.4, 0.2, 0.3 (deuda baja).

**Estimación total:** ~14 horas de trabajo enfocado.

---

## 10. Evaluación final

**¿Qué tan sólida puede volverse la Fase 0?** Alta. Todos los cambios son quirúrgicos y reversibles. Ninguno requiere rediseñar una interfaz. El mayor costo es el tiempo de los tests.

**¿Qué tan crítica es para el proyecto?** Es la más crítica de todas las fases, precisamente porque es la más aburrida. La Fase 1 (refactoring del orquestador) sin la Fase 0 completada es una apuesta que normalmente se pierde.

**¿Qué tan difícil es madurarla?** La Fase 0 completa es ~2-3 días de trabajo enfocado. El código está bien estructurado — los problemas son de omisión, no de diseño incorrecto.

**Ventaja estratégica real:** La test suite de `src/template/` habilita el claim futuro de "motor de templates estable". Si iteraciones-cli quiere ser seriamente considerado como herramienta editorial, la ausencia de tests es el argumento más fácil para descartarlo. Con cobertura >80% en el motor, el proyecto puede evolucionar con confianza hacia la Fase 1 y la exportación editorial.
