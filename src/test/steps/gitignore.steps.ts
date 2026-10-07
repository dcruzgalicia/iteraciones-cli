import { mkdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { Given, Then, When } from '@cucumber/cucumber';
import ignore from 'ignore';
import { discover } from '../../builder/discover.js';
import { listMarkdownDocuments } from '../../builder/discover-files.js';
import { isIgnoredByRules, isInsideIgnoredDir, loadGitignoreRules, parseGitignore } from '../../builder/gitignore.js';
import { escribirEnProyecto, world } from './cli-world.steps.ts';

/**
 * #2580 (onda 2) — las reglas de `.gitignore` que decide qué se compila.
 *
 * Son las reglas de git, no unas propias: si el proyecto ya trae un
 * `.gitignore`, el autor espera que el build lo entienda igual que git. Por eso
 * los wildcards, la negación y el anclaje se comportan como en git.
 */

Given('que el .gitignore dice:', (reglas: string) => {
  world.reglasTexto = reglas.replace(/<br>/g, '\n');
  world.reglasGitignore = parseGitignore(world.reglasTexto);
});

Then('el archivo {string} {string} por las reglas', (ruta: string, resultado: string) => {
  const ignorado = isIgnoredByRules(ruta, world.reglasGitignore);
  // `startsWith` y no `includes`: "ignorado" contiene "no", así que
  // `includes('no')` daba falso positivo en "queda ignorado".
  const esperado = !resultado.startsWith('no');
  if (ignorado !== esperado) {
    throw new Error(`${ruta} ${ignorado ? 'queda' : 'no queda'} ignorado y el escenario dice "${resultado}"`);
  }
});

/** El caso "sin reglas" usa un matcher vacío, no uno con reglas vacías. */
Then('el archivo {string} no queda ignorado por las reglas', (ruta: string) => {
  if (isIgnoredByRules(ruta, ignore())) {
    throw new Error(`${ruta} no debería quedar ignorado sin reglas`);
  }
});

Then('la ruta {string} está dentro de un directorio ignorado', (ruta: string) => {
  if (!isInsideIgnoredDir(ruta)) {
    throw new Error(`${ruta} debería estar dentro de un directorio ignorado`);
  }
});

Then('la ruta {string} no está dentro de un directorio ignorado', (ruta: string) => {
  if (isInsideIgnoredDir(ruta)) {
    throw new Error(`${ruta} no debería estar dentro de un directorio ignorado`);
  }
});

/** El descubrimiento respeta las reglas y devuelve rutas relativas ordenadas. */
Given('que el proyecto tiene los archivos:', (tabla: string) => {
  for (const linea of tabla.split('\n')) {
    const limpia = linea.trim();
    if (limpia) escribirEnProyecto(limpia, `# ${limpia}\n`);
  }
});

Given('que el proyecto tiene directorios:', (lista: string) => {
  for (const d of lista.split('\n')) {
    const limpia = d.trim();
    if (limpia) mkdirSync(join(world.root, limpia), { recursive: true });
  }
});

Given('que el proyecto escribe {string}', (contenido: string) => {
  escribirEnProyecto('.gitignore', contenido.replace(/<br>/g, '\n'));
});

When('descubro los documentos del proyecto', async () => {
  world.rutasDescubiertas = (await listMarkdownDocuments(world.root)).sort();
});

When('descubro con el pipeline completo', async () => {
  world.rutasDescubiertas = [...(await discover(world.root, { prevState: null })).relativePaths].sort();
});

Then('los documentos descubiertos son {string}', (esperadas: string) => {
  const leidas = (world.rutasDescubiertas as string[]).join(', ');
  if (leidas !== esperadas) {
    throw new Error(`son ${JSON.stringify(leidas)} y deberían ser ${JSON.stringify(esperadas)}`);
  }
});

/** El matcher sale de las reglas del proyecto, no de las del escenario. */
Then('el matcher del proyecto ignora {string}', async (ruta: string) => {
  const matcher = await loadGitignoreRules(world.root);
  if (!isIgnoredByRules(ruta, matcher)) {
    throw new Error(`${ruta} debería quedar ignorado por el .gitignore del proyecto`);
  }
});

/**
 * Paridad con el git de verdad.
 *
 * `isIgnoredByRules` es, según `docs/architecture.md`, el único mecanismo de
 * exclusión de contenido del proyecto: si se aparta de git, un documento deja
 * de compilarse o se compila sin querer, y ninguna otra suite lo nota.
 *
 * Por eso la comparación es con `git check-ignore` y no con una lista de
 * expectativas escrita a mano —escribirla sería reescribir git. Lo que sí está
 * escrito a mano es `DIVERGENCIAS_CONOCIDAS`: lo que git y la librería `ignore`
 * resuelven distinto y que nadie va a arreglar, porque son límites declarados en
 * el mismo documento. Una divergencia **nueva** falla; una conocida pasa.
 *
 * ponytail: un caso por comportamiento, no exhaustivo. Lo que no se prueba aquí
 * es lo que git tampoco distingue (archivos contra directorios sin stat), y eso
 * lo dice el propio `git check-ignore` con su salida.
 */
const DIVERGENCIAS_CONOCIDAS: Record<string, string> = {
  // `dir/` ignora el directorio como segmento final; la librería `ignore` no
  // hace stat y no puede saber que `dir` es un directorio. Declarado en
  // architecture.md: sólo discovery, que verifica `.md` existentes, lo evita.
  'dir/': 'la librería ignore no hace stat: no distingue un directorio de un archivo',
  // Sin reglas heredadas: el matcher sólo lee el `.gitignore` de la raíz, que
  // es lo que la librería `ignore` soporta sin walk al ancestro. Declarado en el
  // mismo documento.
  '../': 'no se soportan reglas heredadas de ancestros',
};

When('comparo las reglas de iteraciones con git check-ignore', async () => {
  // Guarda: este paso ESCRIBE un archivo, y con `world.root` vacío
  // `join('', '.gitignore')` es la ruta relativa — es decir, el `.gitignore`
  // del propio repositorio. Pasó dos veces antes de que esta guarda existiera.
  if (!isAbsolute(world.root)) {
    throw new Error(`el proyecto no tiene raíz temporal (world.root=${JSON.stringify(world.root)}); falta el Given de la raíz del proyecto`);
  }
  await Bun.write(join(world.root, '.gitignore'), `${world.reglasTexto}\n`);
  // git necesita un repositorio para tener algo que decidir.
  Bun.spawnSync(['git', 'init', '-q'], { cwd: world.root });

  const rutas = world.rutasGitignore;
  const matcher = await loadGitignoreRules(world.root);

  const diferencias: string[] = [];
  for (const ruta of rutas) {
    // `-q`: sale 0 si la ignora, 1 si no. Sin `-q` haría match contra el patrón.
    const proc = Bun.spawnSync(['git', 'check-ignore', '-q', '--no-index', ruta], { cwd: world.root });
    const porGit = proc.exitCode === 0;
    const porIteraciones = isIgnoredByRules(ruta, matcher);
    if (porGit === porIteraciones) continue;

    const linea = `${ruta} → git: ${porGit ? 'ignora' : 'no ignora'}, iteraciones: ${porIteraciones ? 'ignora' : 'no ignora'}`;
    if (Object.keys(DIVERGENCIAS_CONOCIDAS).some((patron) => ruta.includes(patron))) continue;
    diferencias.push(linea);
  }
  if (diferencias.length > 0) {
    throw new Error(
      `iteraciones se aparta de git en ${diferencias.length} caso(s) sin documentar:\n  ${diferencias.join('\n  ')}\n` +
        'Si es un límite real, decláralo en DIVERGENCIAS_CONOCIDAS y en docs/architecture.md.',
    );
  }
});

/** Las rutas que la comparación de paridad consulta a los dos motores. */
Given('que los archivos a consultar son:', (rutas: string) => {
  world.rutasGitignore = rutas
    .split('\n')
    .map((r) => r.trim())
    .filter((r) => r !== '' && !r.startsWith('#'));
});

/** La comparación terminó sin diferencias nuevas. */
Then('las únicas diferencias son las documentadas', () => {
  // El `When` ya lanza si encuentra alguna; este `Then` existe para que el
  // escenario se lea como los demás y para dejar el punto de comprobación a la
  // vista. No hay estado que mirar: la lista de diferencias está en el paso.
});
