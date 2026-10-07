import { mkdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { Given, Then, When } from '@cucumber/cucumber';
import ignore from 'ignore';
import { discover } from '../../builder/discover.js';
import { listMarkdownDocuments } from '../../builder/discover-files.js';
import { isIgnoredByRules, isInsideIgnoredDir, loadGitignoreRules, parseGitignore } from '../../builder/gitignore.js';
import { escribirEnProyecto, world } from './cli-world.steps.ts';

Given('que el .gitignore dice:', (reglas: string) => {
  world.reglasTexto = reglas.replace(/<br>/g, '\n');
  world.reglasGitignore = parseGitignore(world.reglasTexto);
});

Then('el archivo {string} {string} por las reglas', (ruta: string, resultado: string) => {
  const ignorado = isIgnoredByRules(ruta, world.reglasGitignore);

  const esperado = !resultado.startsWith('no');
  if (ignorado !== esperado) {
    throw new Error(`${ruta} ${ignorado ? 'queda' : 'no queda'} ignorado y el escenario dice "${resultado}"`);
  }
});

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

Then('el matcher del proyecto ignora {string}', async (ruta: string) => {
  const matcher = await loadGitignoreRules(world.root);
  if (!isIgnoredByRules(ruta, matcher)) {
    throw new Error(`${ruta} debería quedar ignorado por el .gitignore del proyecto`);
  }
});

const DIVERGENCIAS_CONOCIDAS: Record<string, string> = {
  'dir/': 'la librería ignore no hace stat: no distingue un directorio de un archivo',

  '../': 'no se soportan reglas heredadas de ancestros',
};

When('comparo las reglas de iteraciones con git check-ignore', async () => {
  if (!isAbsolute(world.root)) {
    throw new Error(`el proyecto no tiene raíz temporal (world.root=${JSON.stringify(world.root)}); falta el Given de la raíz del proyecto`);
  }
  await Bun.write(join(world.root, '.gitignore'), `${world.reglasTexto}\n`);

  Bun.spawnSync(['git', 'init', '-q'], { cwd: world.root });

  const rutas = world.rutasGitignore;
  const matcher = await loadGitignoreRules(world.root);

  const diferencias: string[] = [];
  for (const ruta of rutas) {
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

Given('que los archivos a consultar son:', (rutas: string) => {
  world.rutasGitignore = rutas
    .split('\n')
    .map((r) => r.trim())
    .filter((r) => r !== '' && !r.startsWith('#'));
});

Then('las únicas diferencias son las documentadas', () => {});
