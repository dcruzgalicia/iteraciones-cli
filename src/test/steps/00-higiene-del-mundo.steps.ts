import { mock } from 'bun:test';
import { After, AfterAll, BeforeAll } from '@cucumber/cucumber';

/**
 * #2543 — higiene del mundo. Este archivo lo importan TODOS los features.
 *
 * ## Por qué existe
 *
 * `bun test` aísla cada `it()` y restaura los mocks solo. **cucumber no.** El
 * mundo es un objeto compartido y los scenarios se ejecutan en el mismo
 * proceso, uno detrás de otro. Verificado en el spike, no supuesto:
 *
 * ```
 * Escenario A:  spyOn(process, 'cwd').mockReturnValue('/espurio')   // sin restaurar
 * Escenario B:  process.cwd()  →  '/espurio'                        // FUGA
 * ```
 *
 * Con 128 `spyOn` en la suite actual, migrar sin este `After` corrompería
 * escenarios en silencio y el fallo aparecería en el test equivocado — que es
 * la forma más cara de depurar. Con este hook, los 14 scenarios de la sonda
 * pasan.
 *
 * ## Mapeo de hooks (pregunta 3 del issue)
 *
 * | bun:test        | cucumber   | cuándo                |
 * |-----------------|------------|-----------------------|
 * | `beforeAll`     | `BeforeAll`| una vez por corrida   |
 * | `beforeEach`    | `Before`   | antes de cada scenario|
 * | `afterEach`     | `After`    | después de cada uno    |
 * | `afterAll`      | `AfterAll` | una vez al terminar   |
 *
 * `beforeEach` + estado por caso no es 1:1 con `beforeAll`: el estado por caso
 * va en un objeto de mundo que `Before` reinicia. Es lo que hacen los steps de
 * este repo (ver `VocabularioWorld`). `withTempDir` se traduce a `Before` que
 * crea el temporal y `After` que lo borra — cucumber no tiene try/finally por
 * escenario.
 *
 * ## Por qué `mock.restore()` y no `mock.clearAllMocks()`
 *
 * `clearAllMocks` vacía las llamadas pero **deja el espía puesto**: el método
 * sigue siendo el stub. Sólo `restore()` devuelve el original.
 */

After(() => {
  mock.restore();
});

/**
 * ## Por qué se silencia la salida del CLI
 *
 * El CLI es un orquestador: escribe en la terminal mientras compila. Los
 * scenarios que lo llaman **de verdad** —`build()`, `runBuild()`— escriben sus
 * `✔ Documentos encontrados`, `⚠ [config]`, `✖ [visual]` en el stdout y el
 * stderr reales de la corrida, mezclados con lo que cucumber va reportando. Con
 * 1043 escenarios eso son cientos de líneas que no son el resultado de nada.
 *
 * Cambiar el formatter de cucumber no lo arregla: medido, `progress` y `summary`
 * dan 380 y 379 líneas sobre el mismo subconjunto, porque los puntos de cucumber
 * son una línea de 80 caracteres y el ruido real es el del CLI. Por eso el
 * silencio va aquí, en el hook, y no en el formatter.
 *
 * ## Por qué no se pierde nada
 *
 * - Los scenarios que **comprueban** la salida usan su propio espía
 *   (`capture()` en `cli-world.steps.ts`), que acumula en el world. Espiar
 *   encima de un `write` que ya no hace nada sigue acumulando igual.
 * - El informe de omitidos del gating se imprime en `process.once('exit')`, que
 *   corre **después** de `AfterAll`: para entonces los streams ya están
 *   restaurados y el informe sale.
 * - Los escenarios que fallan los reporta cucumber al final, no el CLI.
 *
 * `ITERACIONES_VERBOSE=1` desactiva el silencio, para depurar un scenario suelto.
 */
const stdoutReal = process.stdout.write.bind(process.stdout);
const stderrReal = process.stderr.write.bind(process.stderr);

const silencioso = (): boolean => process.env.ITERACIONES_VERBOSE !== '1';

BeforeAll(() => {
  if (!silencioso()) return;
  process.stdout.write = (): boolean => true;
  process.stderr.write = (): boolean => true;
});

AfterAll(() => {
  process.stdout.write = stdoutReal;
  process.stderr.write = stderrReal;
});
