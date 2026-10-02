import { mock } from 'bun:test';
import { After } from '@cucumber/cucumber';

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
