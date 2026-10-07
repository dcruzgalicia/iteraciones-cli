import { mkdtemp, readdir, readFile, realpath, rm, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import { build } from '../../builder/orchestrator.js';
import { systemCommands } from '../helpers.js';

async function snapshot(dir: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else files.set(relative(dir, path), await readFile(path));
    }
  };
  await walk(dir);
  return files;
}

function mismaSalvo(before: Map<string, Buffer>, after: Map<string, Buffer>, soloDebeExistir: RegExp): string | null {
  const antes = [...before.keys()].sort();
  const ahora = [...after.keys()].sort();
  if (JSON.stringify(antes) !== JSON.stringify(ahora)) {
    return `dist cambió de archivos.\n  antes: ${JSON.stringify(antes)}\n  ahora: ${JSON.stringify(ahora)}`;
  }
  for (const [name, bytes] of before) {
    const got = after.get(name);
    if (got === undefined) return `${name} no se regeneró`;
    if (soloDebeExistir.test(name)) continue;
    if (!got.equals(bytes)) return `bytes distintos en ${name}`;
  }
  return null;
}

const CONFIG_TODOS = [
  'language: es-MX',
  'script: true',
  'format:',
  '  latex:',
  '    generate: true',
  '  html:',
  '    site:',
  '      title: T',
  '    generate: true',
  '  epub:',
  '    generate: true',
  '  markdown:',
  '    generate: true',
].join('\n');

const DOC = ['---', 'title: Documento', 'creator:', '  - Ana Ruiz', '---', '', '## Capítulo', '', 'Contenido.'].join('\n');

interface ShWorld {
  dir: string;
  slug: string;
  script: string;
  distBefore: Map<string, Buffer>;
  collectionsBefore: Map<string, Buffer>;
  exitCode: number;
  stderr: string;
  distPath: string;
  collectionsPath: string;
}

const world: ShWorld = {
  dir: '',
  slug: 'documento',
  script: '',
  distBefore: new Map(),
  collectionsBefore: new Map(),
  exitCode: 0,
  stderr: '',
  distPath: '',
  collectionsPath: '',
};

Before(async () => {
  world.dir = await mkdtemp(join('/tmp', 'iteraciones-gherkin-'));
  world.distPath = join(world.dir, 'dist', 'files');
  world.collectionsPath = join(world.dir, '.iteraciones', 'collections');
});

After(async () => {
  await rm(world.dir, { recursive: true, force: true });
});

async function writeConfig(config: string): Promise<void> {
  await Bun.write(join(world.dir, 'iteraciones.config.yaml'), `${config}\n`);
}

async function writePhoto(): Promise<void> {
  const proc = Bun.spawnSync(['magick', '-size', '2x2', 'xc:white', join(world.dir, 'foto.png')]);
  if (proc.exitCode !== 0) throw new Error('magick no pudo crear la foto de prueba');
}

function replay(): void {
  const proc = Bun.spawnSync(['bash', join(world.dir, 'build.sh')], { cwd: world.dir, stdout: 'pipe', stderr: 'pipe' });
  world.exitCode = proc.exitCode;
  world.stderr = new TextDecoder().decode(proc.stderr ?? new Uint8Array());
}

Given('un proyecto de prueba con la clave script activada', async () => {
  world.slug = 'documento';
  await writeConfig(CONFIG_TODOS);
  await Bun.write(join(world.dir, 'documento.md'), `${DOC}\n`);
});

Given('un proyecto con un documento y una colección que lo incluye', async () => {
  world.slug = 'documento';
  await writeConfig(CONFIG_TODOS);
  await Bun.write(join(world.dir, 'documento.md'), `${DOC}\n`);
  await Bun.write(
    join(world.dir, 'coleccion.md'),
    ['---', 'title: Antología', 'type: collection', 'files:', '  - documento.md', '---', '', 'Intro de la antología.'].join('\n'),
  );
});

Given('un proyecto con una imagen y un documento que la referencia', async () => {
  world.slug = 'manuscrito';
  await writeConfig(
    [
      'language: es-MX',
      'script: true',
      'format:',
      '  html:',
      '    site:',
      '      title: T',
      '    generate: true',
      '  markdown:',
      '    generate: true',
    ].join('\n'),
  );
  await writePhoto();
  await Bun.write(join(world.dir, 'manuscrito.md'), ['---', 'title: Manuscrito', '---', '', '![foto](foto.png)', '', 'Contenido.'].join('\n'));
});

Given('un proyecto con una imagen y un documento que la referencia en LaTeX', async () => {
  world.slug = 'ensayo';
  await writeConfig(['language: es-MX', 'script: true', 'format:', '  latex:', '    generate: true'].join('\n'));
  await writePhoto();
  await Bun.write(
    join(world.dir, 'ensayo.md'),
    ['---', 'title: Ensayo', '---', '', '# Capítulo', '', '![foto](foto.png)', '', 'Contenido.'].join('\n'),
  );
});

Given('un proyecto con un documento y formato PDF', async () => {
  world.slug = 'cuidar-se';
  await writeConfig(['language: es-MX', 'script: true', 'format:', '  pdf:', '    generate: true'].join('\n'));
  await Bun.write(
    join(world.dir, 'manuscrito.md'),
    ['---', 'title: Cuidar-se', 'date: 2026-01-01', '---', '', '# Capítulo', '', 'Contenido.'].join('\n'),
  );
});

async function writeCompleteProject(override?: { clave: string; valor: string }): Promise<void> {
  world.slug = 'documento';

  const pdf = ['    generate: true', '    coverImage: true'];
  if (override !== undefined) {
    const i = pdf.findIndex((l) => l.trimStart().startsWith(`${override.clave}:`));
    const linea = `    ${override.clave}: ${override.valor}`;
    if (i === -1) pdf.push(linea);
    else pdf[i] = linea;
  }
  await writeConfig(
    [
      'language: es-MX',
      'script: true',
      'format:',
      '  latex:',
      '    generate: true',
      '  pdf:',
      ...pdf,
      '  html:',
      '    site:',
      '      title: T',
      '    generate: true',
      '  epub:',
      '    generate: true',
      '  markdown:',
      '    generate: true',
    ].join('\n'),
  );
  await writePhoto();
  await Bun.write(
    join(world.dir, 'documento.md'),
    ['---', 'title: Manuscrito', 'creator:', '  - Ana Ruiz', '---', '', '# Capítulo', '', '![foto](foto.png)', '', 'Contenido.'].join('\n'),
  );
  await Bun.write(
    join(world.dir, 'coleccion.md'),
    ['---', 'title: Antología', 'type: collection', 'files:', '  - documento.md', '---', '', 'Intro de la antología.'].join('\n'),
  );

  await Bun.write(join(world.dir, 'creadora.md'), ['---', 'name: Ana Ruiz', 'type: creator', '---', '', 'Bio de la creadora.'].join('\n'));
}

Given('un proyecto con todos los formatos, una colección y una creadora', async () => {
  await writeCompleteProject();
});

Given('un proyecto con todos los formatos y {word}: {word}', async (clave: string, valor: string) => {
  await writeCompleteProject({ clave, valor });
});

When('compilo el proyecto y leo el build.sh', async () => {
  await build(world.dir);
  world.script = await Bun.file(join(world.dir, 'build.sh')).text();
});

When('compilo el proyecto desde cero', async () => {
  await build(world.dir, { full: true });
  world.script = await Bun.file(join(world.dir, 'build.sh')).text();
});

When('guardo una copia de dist', async () => {
  world.distBefore = await snapshot(world.distPath);
});

When('guardo una copia de dist y de las entradas de las colecciones', async () => {
  world.distBefore = await snapshot(world.distPath);
  world.collectionsBefore = await snapshot(world.collectionsPath);
});

When('borro dist', async () => {
  await rm(world.distPath, { recursive: true, force: true });
});

When('borro las entradas materializadas', async () => {
  await rm(world.collectionsPath, { recursive: true, force: true });
});

When('reejecuto build.sh con bash', () => {
  replay();
});

Then('el script existe y es ejecutable', async () => {
  const path = join(world.dir, 'build.sh');
  if (!(await Bun.file(path).exists())) throw new Error('el build no escribió build.sh en la raíz');
  if ((await stat(path)).mode % 512 === 0) throw new Error('build.sh no es ejecutable');
});

type Chequeo = (ctx: Contexto) => void | Promise<void>;

interface Contexto {
  script: string;

  root: string;
  distPath: string;

  slug: string;
  dir: string;
  falla: (motivo: string) => never;
}

const SECCIONES_FORMATO = [
  '# === Recursos: plantillas, colecciones y assets (iteraciones) ===',
  '# === Salidas de iteraciones (post-proceso y markdown) ===',
  '# === Pandoc: LaTeX ===',
  '# === Pandoc: HTML ===',
  '# === Pandoc: EPUB ===',
];

const CHEQUEOS: Record<string, Chequeo> = {
  cabecera: ({ script, root, falla }) => {
    if (!script.startsWith('#!/bin/bash\nset -e\ncd ')) falla('la cabecera no es la esperada');

    if (!script.includes(`cd ${root}`)) falla(`no hace cd a la raíz canónica ${root}`);
  },
  directorios: ({ script, falla }) => {
    if (!script.includes('# === Preparación (directorios) ===')) falla('falta la sección de preparación');
    if (!/^mkdir -p \S/m.test(script)) falla('no hay ningún mkdir -p');
    if (script.includes('iteraciones prepare')) falla('no debe invocar iteraciones prepare (#2456)');
  },
  secciones: ({ script, falla }) => {
    for (const seccion of SECCIONES_FORMATO) {
      if (!script.includes(seccion)) falla(`falta la sección ${seccion}`);
    }
  },
  primitivas: ({ script, falla }) => {
    const prohibidas = systemCommands(script).filter((c) => c !== 'cd');
    if (prohibidas.length > 0) falla(`usa primitivas prohibidas: ${JSON.stringify(prohibidas)}`);
  },
  salidas: ({ script, falla }) => {
    if (!script.includes('.iteraciones/script/in-')) falla('falta la materialización de la entrada');
    if (!/> *[^\n]*dist\/files\/[^\n]*\.tex\b/.test(script)) falla('no hay redirect a dist/files/*.tex');
    if (/> *[^\n]*dist\/files\/[^\n]*\.html\b/.test(script)) falla('el HTML no puede salir de un redirect: minify siempre lo cambia');
    if (!/^\s*iteraciones post html .* -o \S+dist\/files\/\S+\.html\b/m.test(script)) falla('falta `iteraciones post html … -o dist/files/….html`');
  },
  markdown: ({ script, falla }) => {
    if (/> *[^\n]*dist\/files\/[^\n]*\.md\b/.test(script)) falla('no debe escribir el markdown con un redirect de pandoc');
    if (!/^\s*iteraciones markdown \S+ -o \S+dist\/files\/\S+\.md$/m.test(script)) falla('falta `iteraciones markdown … -o dist/files/….md`');
  },
  'subcomandos prohibidos': ({ script, falla }) => {
    if (/\biteraciones\s+(build|new|init|clean|validate|doctor)\b/.test(script)) falla('no debe invocar build/new/init/clean/validate/doctor');
    if (!/^\s*iteraciones (template|post|prepare|assets|markdown) /m.test(script)) falla('falta al menos un subcomando permitido');
    if (script.includes('iteraciones merge')) falla('no debe invocar iteraciones merge');
  },
  sección: ({ script, falla }) => {
    if (script.includes('# === Recursos: imágenes (ImageMagick) ===')) {
      if (!script.includes('magick ')) falla('declara imágenes pero no invoca magick');
      return;
    }
    if (script.includes('# === PDF (latexmk) ===')) {
      if (!/latexmk [^\n]*-jobname=/.test(script)) falla('declara PDF pero no compila con latexmk nombrando el job');
      return;
    }
    falla('no declara ni la sección de imágenes ni la de PDF');
  },
  invocación: ({ script, falla }) => {
    if (!script.includes('magick ')) falla('no invoca ImageMagick');
  },
  'copia única': async ({ distPath, slug, falla }) => {
    if (!(await Bun.file(join(distPath, 'assets', 'images', `${slug}-foto.jpg`)).exists())) {
      falla(`la imagen procesada no está en assets/images como ${slug}-foto.jpg`);
    }
    if (await Bun.file(join(distPath, `${slug}-foto.jpg`)).exists()) {
      falla('la imagen procesada no debe quedarse en la raíz de dist (#2450)');
    }
  },
  'raíz de dist': async ({ distPath, slug, falla }) => {
    if (await Bun.file(join(distPath, `${slug}-foto.jpg`)).exists()) falla('la imagen no debe quedarse en la raíz');
  },
  'post-proceso': ({ script, falla }) => {
    if (!/^\s*iteraciones post latex --post \S+\.iteraciones\/post\/ensayo\.json -o \S+ensayo\.tex/m.test(script)) {
      falla('no encadena el post-proceso LaTeX con el manifiesto');
    }
  },
  'entrada del post-proceso': ({ script, falla }) => {
    if (!/< \.iteraciones\/script\/out-\d+\.tex/.test(script)) falla('no lee la salida cruda de pandoc como entrada del post-proceso');
  },
  intermedio: ({ script, falla }) => {
    if (!script.includes('.iteraciones/script/out-')) falla('no escribe la salida cruda de pandoc en un intermedio');
  },
  compilación: ({ script, falla }) => {
    if (!/latexmk [^\n]*-jobname=/.test(script)) falla('no compila con latexmk nombrando el job');
  },
  slots: ({ script, falla }) => {
    if (!/^\s*iteraciones prepare .*--xmp \S*slot-0$/m.test(script)) falla('falta `iteraciones prepare … --xmp slot-0`');
    if (!/^\s*iteraciones pdf collect \S*slot-0 -o \S*dist\/files\/cuidar-se\.pdf$/m.test(script)) falla('falta `iteraciones pdf collect slot-0 …`');
  },
  'cinco fases': ({ script, falla }) => {
    for (const sub of ['prepare', 'assets', 'markdown', 'pdf collect']) {
      if (!script.includes(`iteraciones ${sub} `)) falla(`no invoca \`iteraciones ${sub}\``);
    }
    if (!/^mkdir -p \S/m.test(script)) falla('no prepara directorios con mkdir');
    if (!/^mv \S*\.cover-\S+/m.test(script)) falla('no mueve la portada con mv');
  },
};

Then('el script cumple este contrato:', async (tabla: { hashes: () => Record<string, string>[] }) => {
  const script = world.script;
  const ctx: Contexto = {
    script,
    root: await realpath(world.dir),
    distPath: world.distPath,
    slug: world.slug,
    dir: world.dir,
    falla: (motivo: string) => {
      throw new Error(`contrato "${motivo}"\n${script.slice(0, 400)}`);
    },
  };
  for (const fila of tabla.hashes()) {
    const que = fila.qué ?? '';
    const chequeo = CHEQUEOS[que];
    if (chequeo === undefined) {
      throw new Error(`fila de contrato sin verificar: "${que}". Añádela a CHEQUEOS en build-sh.steps.ts`);
    }
    await chequeo(ctx);
  }
});

Then('el manifiesto de post-proceso tiene una entrada', async () => {
  const raw = await readFile(join(world.dir, '.iteraciones', 'post', 'ensayo.json'), 'utf8');
  const manifest = JSON.parse(raw) as { distribution?: Record<string, string> };

  const n = Object.keys(manifest.distribution ?? {}).length;
  if (n !== 1) throw new Error(`esperaba 1 entrada en el manifiesto y hay ${n}`);
});

Then('el archivo de dist existe', async () => {
  const nombre = world.slug === 'ensayo' ? 'ensayo.tex' : world.slug === 'cuidar-se' ? 'cuidar-se.pdf' : `${world.slug}.html`;
  if (!(await Bun.file(join(world.distPath, nombre)).exists())) throw new Error(`no se generó ${nombre} en dist`);
});

Then('el archivo de dist contiene la ruta de la imagen procesada', async () => {
  const tex = await readFile(join(world.distPath, 'ensayo.tex'), 'utf8');
  if (!tex.includes('assets/images/ensayo-foto.jpg')) {
    throw new Error('el .tex de dist no referencia la imagen procesada desde assets/images');
  }
});

Then('la imagen procesada no se queda en la raíz de dist', async () => {
  if (await Bun.file(join(world.distPath, `${world.slug}-foto.jpg`)).exists()) {
    throw new Error('la imagen procesada no debe quedarse en la raíz de dist');
  }
});

Then('el archivo de dist pesa más de {int} bytes', async (minimo: number) => {
  const bytes = (await readFile(join(world.distPath, 'cuidar-se.pdf'))).byteLength;
  if (bytes <= minimo) throw new Error(`el PDF pesa ${bytes} bytes y debía pesar más de ${minimo}`);
});

Then('el código de salida es 0', () => {
  if (world.exitCode !== 0) throw new Error(`bash build.sh salió con ${world.exitCode}\n${world.stderr}`);
});

Then('dist se reconstruye idéntico salvo los EPUB', async () => {
  const problema = mismaSalvo(world.distBefore, await snapshot(world.distPath), /\.epub$/);
  if (problema !== null) throw new Error(problema);
});

Then('dist se reconstruye idéntico sin excepciones', async () => {
  const problema = mismaSalvo(world.distBefore, await snapshot(world.distPath), /$^/);
  if (problema !== null) throw new Error(problema);
});

Then('dist se reconstruye idéntico salvo PDF y EPUB', async () => {
  const problema = mismaSalvo(world.distBefore, await snapshot(world.distPath), /\.(pdf|epub)$/);
  if (problema !== null) throw new Error(problema);
});

Then('las entradas de las colecciones se reconstruyen idénticas', async () => {
  const despues = await snapshot(world.collectionsPath);
  const antes = [...world.collectionsBefore.keys()].sort();
  const ahora = [...despues.keys()].sort();
  if (JSON.stringify(antes) !== JSON.stringify(ahora)) {
    throw new Error(`las entradas cambiaron.\n  antes: ${JSON.stringify(antes)}\n  ahora: ${JSON.stringify(ahora)}`);
  }
  for (const [name, bytes] of world.collectionsBefore) {
    if (despues.get(name)?.equals(bytes) !== true) throw new Error(`entrada distinta en ${name}`);
  }
});

Then('dist tiene el archivo {string}', async (relativa: string) => {
  const path = join(world.distPath, relativa);
  if (!(await Bun.file(path).exists())) throw new Error(`dist no tiene ${relativa} (sí hay: ${(await snapshot(world.distPath)).size} archivos)`);
});

const distTiene = async (relativa: string, esperado: boolean): Promise<void> => {
  const existe = await Bun.file(join(world.distPath, relativa)).exists();
  if (existe !== esperado) throw new Error(`dist ${existe ? 'sí' : 'no'} tiene ${relativa} y el escenario dice lo contrario`);
};

Then('dist sí tiene el archivo {string}', async (relativa: string) => {
  await distTiene(relativa, true);
});

Then('dist no tiene el archivo {string}', async (relativa: string) => {
  await distTiene(relativa, false);
});

Then('el archivo {string} de dist contiene {string}', async (relativa: string, texto: string) => {
  const contenido = await readFile(join(world.distPath, relativa), 'utf8');
  if (!contenido.includes(texto)) throw new Error(`${relativa} no contiene ${JSON.stringify(texto)}`);
});

Then('el archivo {string} de dist pesa más de {int} bytes', async (relativa: string, minimo: number) => {
  const bytes = (await readFile(join(world.distPath, relativa))).byteLength;
  if (bytes <= minimo) throw new Error(`${relativa} pesa ${bytes} bytes y debía pesar más de ${minimo}`);
});
