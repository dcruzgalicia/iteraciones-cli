# El vocabulario Gherkin de iteraciones-cli

> #2544, fase 2 del plan maestro. Este documento es el contrato de las cinco
> ondas que vienen después: si el vocabulario cambia, cambia aquí primero.

## Por qué este documento decide el tamaño de la migración

Cucumber no tiene un concepto nativo de step definition reutilizable. Lo que
se decida aquí es lo que decide si acabamos con ~300 steps o con ~2.000.

- Un step por test → la prosa Gherkin es decorativa: mismo coste, cero
  claridad.
- Un vocabulario corto y genérico → los features se leen como documentación.

**El presupuesto: ~300 steps únicos para ~954 casos.** `bun run check-steps`
falla si el catálogo se pasa.

## El dato que decidió el diseño

Antes de proponer nada, medí la suite actual:

| Aserción | Frecuencia |
|---|---|
| `toContain` | **890** |
| `toBe` | 583 |
| `toEqual` | 113 |
| `toMatch` | 45 |

Y los sujetos de `toContain`, que es donde está el 60% del peso:

```
179  expect(output).toContain
 99  expect(tex).toContain
 58  expect(html).toContain
 35  expect(maketitle).toContain
 14  expect(stdout).toContain
 13  expect(script).toContain
```

**O sea: la aserción dominante es "este texto contiene esta cosa".** Un diseño
con un step por valor posible no podría bajarse de 890 steps. De ahí sale la
regla que gobierna todo el catálogo:

> **El sujeto de una aserción es una ruta o un valor nombrado, nunca una
> expresión de TypeScript.**

Cuando `expect(output).toContain('x')` se convierte en
`Entonces la salida contiene "x"`, un solo step cubre los 179 casos. Cuando el
sujeto es un path, `Entonces el archivo "dist/files/x.tex" contiene "y"` cubre
los 99 de `tex` y los 58 de `html` con dos steps.

Si un test necesita `expect(objeto.foo.bar[3].baz).toBe(42)`, el asunto no es
el filesystem: es un **outcome semántico del dominio**, y eso sí merece un step
propio (`Entonces las líneas con dos puntos sueltas son [3]`). La frontera es
exactamente esa: **el kit cubre el mecanismo, el dominio cubre el significado.**

## Las seis decisiones del issue

### 1. Granularidad: aserciones, no filtros

`Entonces el código de salida es 0` (afirmación) escala; `Entonces el build
termina correctamente` (filtro) no — porque un filtro no puede fallar de forma
informativa y obliga a un step nuevo por cada modo de fallo.

Regla: **el step dice qué es verdad, no cómo se comprueba.**

### 2. Datos tabulares

- **Varias líneas de entrada** → docstring (""" """). Es lo que usan los 10
  scenarios de `vocabulario-del-cuerpo.feature`.
- **Varias columnas de variantes** → `Esquema del escenario` + `Ejemplos`.
  Nunca una expression: `Entonces las líneas son [3]` matchea con codicia y
  genera snippets basura (trampa 2 del #2543).
- **Tabla de datos dentro de un step** → keyword `|`. Se comparan los objetos
  ya parseados, campo a campo; el orden de las filas cuenta.
- Los datos estructurados viajan **como string entrecomillado** y se parsean
  en el step (`JSON.parse`), para que los espacios del .feature no importen.

### 3. Levels bajo vs alto: un step por comportamiento

Un step por `expect` daría 2.870 steps. La línea:

> **Un step = una cosa que un lector entendería como un paso del mundo.**

Cinco `expect` sobre el mismo artefacto son un comportamiento ("el `.sh`
reproduce la salida"), no cinco.

### 4. Nombres: minúsculas, sin punto, en español

```
✓ "las líneas con dos puntos sueltas son [3]"
✗ "Las líneas con dos puntos sueltas son [3]."
✗ "las lineas con dos puntos sueltas son [3]"     ← sin tildes
```

- tercera persona, presente de indicativo: "compilo", no "compila" ni "compilando"
- sin punto final
- sin "debería" ni "se espera que": el Gherkin afirma, no especula
- el texto del step va en español porque es Gherkin; **el binding
  (`Given(`, `Then(`) va en inglés** porque es API de cucumber, no Gherkin

### 5. Reparto por ficheros

Un solo fichero de 3.000 líneas es inmanejable. El reparto es **por fase del
ciclo**, no por feature:

| Fichero | Qué contiene | Presupuesto |
|---|---|---|
| `00-higiene-del-mundo.steps.ts` | `After` + `mock.restore()`. Lo importan todos | ~10 líneas |
| `toolkit.steps.ts` | Kit de aserciones sobre ficheros, salida y valores | ~25 steps |
| `proyecto.steps.ts` | `Dado` un proyecto/documento/config | ~15 steps |
| `build.steps.ts` | `Cuando` compilo / reejecuto | ~15 steps |
| `cli.steps.ts` | `Cuando` corro el CLI, código de salida, stderr | ~15 steps |
| `<dominio>.steps.ts` | Un outcome semántico por dominio | ~200 steps |

Regla de pertenencia: **un outcome semántico va con su dominio; el mecanismo
va al toolkit.** Si un step necesita saber de qué dominio viene, es del
toolkit.

### 6. `helpers.ts` no se duplica

`withTempDir` e `initTestProject` se envuelven, no se copian:

| Helper existente | Se convierte en |
|---|---|
| `initTestProject(dir)` | `Dado un proyecto de prueba` |
| `withTempDir(fn)` | `Before` crea el temporal, `After` lo borra (cucumber no da try/finally por scenario) |
| `SKIP_REASONS` / `registerSkip` | tags — es el trabajo de #2549 |

## El catálogo

### A. Arrangement

```gherkin
Dado un proyecto de prueba
Dado un proyecto de prueba con esta configuración:
  """
  language: es-MX
  script: true
  """
Dado un documento llamado "<nombre>" con este contenido:
  """
  ---
  title: Documento
  ---
  """
Dado el cuerpo:
  """
  texto
  """
```

`Dado un proyecto de prueba` envuelve `initTestProject`. El `Antes` de
`00-higiene-del-mundo.steps.ts` crea el temporal una vez por escenario.

### B. Act

```gherkin
Cuando compilo el proyecto
Cuando compilo el documento "<ruta>"
Cuando reejecuto build.sh con bash
Cuando corro el CLI con "<args>"
Cuando escaneo el proyecto
```

### C. Kit: ficheros y salida

```gherkin
Entonces el archivo "<ruta>" existe
Entonces el archivo "<ruta>" no existe
Entonces el archivo "<ruta>" contiene "<texto>"
Entonces el archivo "<ruta>" no contiene "<texto>"
Entonces el archivo "<ruta>" coincide con el patrón "<regex>"
Entonces el archivo "<ruta>" está vacío
Entonces la salida contiene "<texto>"
Entonces la salida no contiene "<texto>"
Entonces el código de salida es <n>
Entonces stderr está vacío
Entonces los archivos en "<ruta>" son:
  | nombre |
  | a.tex  |
  | b.html |
```

Nueve steps cubren las ~1.400 aserciones de `toContain`/`toBe` sobre ficheros
y salida. Ese es el 90% del presupuesto de casos con el 9% de los steps.

### D. Kit: valores y espías

```gherkin
Entonces el valor "<clave>" es <json>
Entonces el valor "<clave>" contiene <json>
Entonces "<función>" fue llamada <n> veces
Entonces "<función>" fue llamada con:
  | arg | valor |
  | dir | "/tmp" |
```

Las claves las depositan los steps de `Act`; no hay expression de TypeScript
en el .feature.

### E. Outcomes semánticos

Uno por dominio, y son los únicos que llevan el significado del negocio:

```gherkin
Entonces las líneas con dos puntos sueltas son [3]
Entonces build.sh no usa comandos del sistema prohibidos
Entonces la colección "artículos" tiene 3 documentos
Entonces el índice del PDF enlaza con las 12 secciones
```

## Cómo se ve una migración hecha con este catálogo

Los 10 scenarios de `body-vocabulary.test.ts` quedaron así:

```gherkin
Escenario: Una línea con un solo dos puntos se reporta
  Dado un cuerpo:
    """
    texto

    :

    texto
    """
  Entonces las líneas reportadas son "[3]"

Escenario: Varios dos puntos sueltos se reportan todos
  Dado un cuerpo:
    ...
  Entonces las líneas reportadas son "[1, 5, 7]"
```

**2 steps definidos a mano para 10 scenarios.** El criterio del issue es <10
steps con >3 scenarios. Cumple con holgura, y es el patrón a repetir: un
`Dado` genérico (el cuerpo) + un `Entonces` del dominio + docstrings para los
datos.

## El check mecánico

`bun run check-steps` (`tools/check-steps.ts`), en `pre-commit` vía
lint-staged. Falla si:

| Fallo | Por qué importa |
|---|---|
| Un step se usa y no existe | Es la **trampa 1 del #2543**: cucumber lo reporta como `undefined` **sin error**, el suite queda verde y no comprueba nada |
| Un step se define y no se usa | Vocabulario que se diseña y nadie ejerce. El presupuesto de 300 se evapora |
| Hay keywords inglesas en un `.feature` | El dialecto es `es`; `Feature:`/`Given:` es un descuido |
| Un feature con ≥3 scenarios necesita >10 steps | El criterio de aceptación del issue, comprobado mecánicamente |
| El catálogo pasa de 400 steps | El presupuesto del issue |

Verificado en las dos direcciones: detecta los cuatro fallos y pasa limpio
sobre el estado actual (`37 invocaciones · 17 definidos · 0 sin definir · 0
huérfanos`).

**ponytail:** parsea Gherkin con regex, no con `@cucumber/gherkin` (que ya
está en `node_modules`). El parser real daría etiquetado de columnas y
tracking fino de `Y`/`E`; la regex cubre lo que este repo usa hoy. Si un
`.feature` futuro usa algo que la regex no entiende, el check avisa en vez de
mentir — y en ese momento se cambia por el parser de verdad.
