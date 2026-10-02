import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Given, Then, When } from '@cucumber/cucumber';
import { execPandoc } from '../../lib/pandoc-runner.js';

/**
 * #2545 (onda 1) — el grupo del AST en JSON.
 *
 * Son los únicos escenarios de la suite que comparan la ESTRUCTURA de pandoc en
 * vez de su salida. Por eso el esperado completo va en un fixture por caso y no
 * en una tabla: un AST de quince líneas dentro de una celda es ilegible, y aquí
 * además hace falta compararlo entero, no buscar una cadena.
 *
 * ## El esperado sale del literal original, nunca de la salida real
 *
 * Generar el fixture corriendo pandoc y guardando lo que salió sería circular:
 * el test compararía la salida contra sí misma y siempre pasaría. Los fixtures
 * los extrajo `extract-lua3` del literal del `it()`, que es lo que el autor
 * escribió.
 */

const FILTERS = join(import.meta.dir, '../../lib/resources/filters');
const FIXTURES = join(import.meta.dir, '../../../features/fixtures/lua-filters-ast');
const SEMANTIC_FILTERS = [
  join(FILTERS, 'semantic', 'string', '01-double-colon.lua'),
  join(FILTERS, 'semantic', 'ast', '02-double-colon-noindent.lua'),
];

/** Cuerpos de los escenarios con nombre: el markdown va explícito en el feature. */
interface AstFixture {
  markdown: string;
  expectedBlocks: unknown;
}

async function loadFixture(name: string): Promise<AstFixture> {
  const raw = await readFile(join(FIXTURES, `${name}.json`), 'utf8');
  return JSON.parse(raw) as AstFixture;
}

const BODIES = {
  semicolon: 'texto\n\n:;\n\ntexto',
  dosSeparadores: 'a\n\n::\n\nb\n\n::\n\nc',
  enLista: '- ::\n- texto',
  conEspacioFinal: ':: \n\ntexto',
};

interface Block {
  t?: string;
  c?: unknown;
}

interface AstWorld {
  /** Nombre del fixture pedido por el Given, para los mensajes de error. */
  caseName: string;
  markdown: string;
  blocks: Block[];
}

const world: AstWorld = { caseName: '', markdown: '', blocks: [] };

Given('el caso de AST {string}', async (name: string) => {
  world.caseName = name;
  const parsed = await loadFixture(name);
  world.markdown = parsed.markdown;
});

Given('un cuerpo con dos puntos seguidos de punto y coma', () => {
  world.caseName = 'semicolon';
  world.markdown = BODIES.semicolon;
});

Given('un cuerpo con dos separadores', () => {
  world.caseName = 'dosSeparadores';
  world.markdown = BODIES.dosSeparadores;
});

Given('un cuerpo con un separador como primer item de una lista', () => {
  world.caseName = 'enLista';
  world.markdown = BODIES.enLista;
});

Given('un cuerpo con un separador y un espacio al final', () => {
  world.caseName = 'conEspacioFinal';
  world.markdown = BODIES.conEspacioFinal;
});

When('lo convierto a JSON con los filtros semánticos', async () => {
  const stdout = await execPandoc({
    input: world.markdown,
    sourcePath: 'test.md',
    to: 'json',
    extraArgs: SEMANTIC_FILTERS.flatMap((f) => ['--lua-filter', f]),
  });
  const ast = JSON.parse(stdout) as { blocks?: Block[] };
  world.blocks = ast.blocks ?? [];
});

Then('el AST es el esperado', async () => {
  const { expectedBlocks } = await loadFixture(world.caseName);
  const got = JSON.stringify(world.blocks);
  const want = JSON.stringify(expectedBlocks);
  if (got !== want) {
    throw new Error(`[${world.caseName}] el AST no coincide.\n  esperado: ${want}\n  obtenido: ${got}`);
  }
});

Then('el único Div es un spacer con la clase noindent', () => {
  const divs = world.blocks.filter((b) => b.t === 'Div');
  const want = JSON.stringify({ t: 'Div', c: [['', ['spacer', 'noindent'], []], []] });
  const got = JSON.stringify(divs[0]);
  if (divs.length !== 1 || got !== want) {
    throw new Error(`esperaba un único Div spacer noindent y hubo ${divs.length}: ${got}`);
  }
});

Then('el único Div es un spacer sin clases extra', () => {
  const divs = world.blocks.filter((b) => b.t === 'Div');
  const want = JSON.stringify({ t: 'Div', c: [['', ['spacer'], []], []] });
  const got = JSON.stringify(divs[0]);
  if (divs.length !== 1 || got !== want) {
    throw new Error(`esperaba un único Div spacer sin más clases y hubo ${divs.length}: ${got}`);
  }
});

Then('hay dos Divs de tipo spacer', () => {
  const divs = world.blocks.filter((b) => b.t === 'Div');
  if (divs.length !== 2) throw new Error(`esperaba 2 Divs y hubo ${divs.length}`);
});

Then('la lista tiene un primer item que es un Div spacer', () => {
  const list = world.blocks[0];
  if (list?.t !== 'BulletList') throw new Error(`esperaba una BulletList y el primer bloque es ${String(list?.t)}`);
  // pandoc 3.x: `c` es la lista de items, y cada item es una lista de bloques.
  const item = (list.c as unknown[][])[0]?.[0] as Block | undefined;
  if (item?.t !== 'Div') throw new Error(`esperaba un Div como primer item y fue ${String(item?.t)}`);
  const classes = ((item.c as unknown[][])[0]?.[1] ?? []) as string[];
  if (!classes.includes('spacer')) throw new Error(`el Div no lleva la clase spacer: ${JSON.stringify(classes)}`);
});
