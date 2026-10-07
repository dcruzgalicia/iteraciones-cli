# Auditoría de sobre-ingeniería: regla permanente y hallazgos descartados

Este archivo es el destino de lo que no puede vivir en un issue cerrado.

Los índices de la auditoría fueron **#2511** (17 issues de `cleanup`/`refactor`, fases A–C)
y **#2532** (8 refactors puros + los hallazgos que la verificación descartó). Los dos están
cerrados porque **todos sus sub-issues ya están cerrados**: no queda trabajo que
rastrear. Lo que queda es lo que hay que *recordar*, y por eso vive acá.

---

## Regla permanente

> **Ninguna propuesta de borrar, colapsar o mover archivos bajo `src/lib/resources/`.**
> Si una futura auditoría los vuelve a encontrar idénticos, ya está respondida.

**Por qué.** El plan original proponer deduplicar `preamble-intervention/`, reducir
`preamble-collection/` y `preamble-creator/` a sus archivos divergentes, y colapsar las
tarjetas HTML idénticas a un `shared/`: ~2.700 líneas y −103 archivos.

**Rechazado por decisión del dueño.** Los directorios paralelos por type **no son
duplicación accidental: son puntos de extensión**. La copia completa por type es
deliberada; hoy `intervention`, `collection` y `creator` no divergen del base todavía, pero
van a divergir poco a poco. Un directorio completo por type da lugar a esa divergencia sin
tocar el loader ni el formato de los overrides.

`docs/frontmatter-reference.md` documenta el diseño: copia de las tarjetas por type en
`resources/html/<file|collection|creator>/`, sin ramas `$if(type)$` en las tarjetas, con
el skeleton y `styles.css` compartidos.

---

## La migración a Gherkin está cerrada: no hay segundo framework de tests

> **La suite es Gherkin (`bun run gherkin`, cucumber). No se abre `bun:test` otra vez,
> y no se reconstruye andamiaje de migración.**

La migración (`#2580`, 54 tramos) eliminó `src/__tests__/` entera, sus 89 casos vivos
— duplicados de features ya escritos o blancos sobre internos —, los 52
`describe(…, () => {})` vacíos que dejó detrás, y las tres herramientas que sólo existían
porque había dos runners: `check-tautologias`, `check-estaticos` y `check-steps`.

`check-steps` reimplementaba a mano un parser de Gherkin y un compilador de Cucumber
Expression que `@cucumber/gherkin` y `@cucumber/cucumber-expressions` ya traían
instalados; el parser oficial además sabe que `/` es alternancia, que era el tercer check
del script.

`cucumber-js --dry-run` sigue reportando los steps sin definir con `archivo:línea`, que
era el único de los cinco fallos que de verdad importaba. Si alguna vez hace falta como
puerta, la línea está en `docs/vocabulario-gherkin.md`.

**Lo que sí se conserva**, y es la decisión que fija el estilo de todo lo demás: una
variación de una opción es **una fila de `Ejemplos`, no un step nuevo**. La suite tiene
~1.100 steps; los que se agregaron al cubrir valores de opciones (`pageNumber` ×6,
`coverImage` ×2, `-nobibtex` ×2) son seis en total, no veinte.

### La documentación también es código, y eso se comprueba

`docs-config-integrity.test.ts` y `frontmatter-matrix.test.ts` se fueron con la
suite de `bun:test` sin que nada los reemplazara, y con ellos se perdió el aviso
de que el documento ya no describe el programa. `features/docs-paridad.feature`
lo recupera: compara el schema de zod contra `configuration.md`, `BuildOptions`
contra la tabla de `architecture.md`, `KNOWN_FRONTMATTER_FIELDS` contra
`frontmatter-reference.md`, y los comandos del README contra los de commander.

> **Un `Escenario` sin ningún paso de comprobación pasa en verde para siempre.**
> `features/docs-paridad.feature` incluye el detector, y por encontrarlo revealed
> que **123 escenarios** encadenaban la aserción con `Y` después de un `Cuando`:
> funcionalmente pasaban, pero todo el scenario leía como un `When` largo. Es el
> argumento de usar Gherkin Neutralizado por el dialecto, así que se corrigieron
> los 123 (`Y` → ` Entonces` en el primer paso de comprobación).

### Dos reglas que salieron de la reescritura

1. **El `.sh` no sustituye la lógica de la CLI.** Que `bash build.sh` salga con 0 y deje el
   mismo `dist` prueba que el build es *reproducible*; no prueba que los pasos sean
   *correctos* — un replay fiel de un pandoc mal armado también sale idéntico. Por eso
   `features/build-completo.feature` mira lo que el build deja en `dist`, no el script.
2. **El paso 0 también es un paso.** `iteraciones prepare` —la fase que crea los
   directorios y deja la plantilla XMP en el slot— no tenía feature propio hasta
   `features/cli-prepare.feature`: se cubría el `mkdir` de dentro del build, no el
   subcomando que el autor corre a mano cuando depura un PDF.

---

## Hallazgos descartados tras verificación

La segunda auditoría confirmó que varios candidatos a refactor **no lo son**. Se anotan
para que una tercera no los vuelva a proponer.

| Candidato | Por qué se descartó |
|---|---|
| `EMPTY_PROJECT_WARNING_CODES` (2 claves, mismo valor, sin reader aparente) | **Falso.** `cli/progress.ts:138` lo lee en producción. |
| `posixify` en 11 lugares | **Contado mal.** Son 4; el resto son variantes de otra cosa. |
| Bajar `slugify` por 2 call sites | **Cambia slugs.** Ejecutado: `Straße` → `strasse` vs `stra-e`, `Æther` → `aether` vs `-ther`. `Ørsted`, `Đorđe`, `Łódź` y `Þingvellir` divergen todos: el NFD no descompone Æ/Ø/Đ/Ł/Þ. Como los slugs van a nombres de archivo y URLs, es un cambio de salida, **no un refactor**. **Mantener la dependencia.** |
| `walkFiles` → `Bun.Glob` en `visual-diff` | **Pierde dotfiles.** Ejecutado: `Bun.Glob('**/*.pdf')` no matchea `.hidden.pdf` ni `.dotdir/c.pdf`; el `readdir` recursivo sí. Regresión silenciosa. |
| `accent-palettes.ts` → `var(--color-…)` desde `theme.css` | **Cambia el hash del CSS.** `build-assets.ts:109` hashea `JSON.stringify(ACCENT_PALETTES[accent])`. Cambiar la fuente del palette cambia `computeCssHash` e **invalida el estado de todos los builds**. Necesita migración de `schemaVersion`. |
| `paths.ts` → `node:path.resolve` | Es un **fix de bug**, no un refactor: la implementación actual da `rel/c.md` con cwd relativo. `resolve()` lo arregla, pero cambia comportamiento y necesita sus propios tests. |
| `isInsideIgnoredDir` (`IGNORED_DIRS`) | Cubre `node_modules/.git/dist/.iteraciones` **aunque no exista `.gitignore`**. Sin él, `discover` camina esos árboles. |
| Quitar `KNOWN_ERROR_PREFIXES` | No dispara hoy (los callers ya pasan texto traducido), pero es un strip de prefijos en la superficie de errores del usuario. Borde. |
| Consolidar los 2 motores YAML (sigue vigente) | 6 sitios usan `Bun.YAML.parse` con `catch → ''` (**fallo silencioso**). Enrutarlos por `parseYamlWithPosition` hace que **arrojen**. Mejora, pero cambia la superficie de error. |
| `pngSize` → `Bun.Image` | Existe (verificado en Bun 1.4.2) pero **lanza ante un PNG corrupto**; leer 8 bytes del header no lanza. |
| `collection-fragment.ts` → pedirle el texto a pandoc | Parser distinto, salida distinta. Los 182 loc de CommonMark son **el spec implícito**. |
| Borrar `preamble-intervention/`, colapsar las tarjetas HTML, reducir `preamble-collection/` | **Fuera de alcance por decisión del dueño.** Ver la regla de arriba. `preamble-intervention` es 31/31 byte-idéntico a `preamble` **hoy**, y ésa es justo la razón por la que va a poder divergir sin fricción. |

---

## Nota sobre la migración a Gherkin

La migración vive aparte, en **#2580** (control único de 841 casos en 54 tramos). Este
archivo no la cubre y no debe confundirse con ella.