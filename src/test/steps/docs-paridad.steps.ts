import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Then } from '@cucumber/cucumber';
import { AstBuilder, GherkinClassicTokenMatcher, Parser } from '@cucumber/gherkin';
import { parse as parseYaml } from 'yaml';
import { KNOWN_FRONTMATTER_FIELDS } from '../../builder/project-validator.js';
import { buildProgram } from '../../cli/parser.js';
import { SiteConfigSchema } from '../../config/config-schema.js';
import { CAPABILITIES, SKIP_REASONS, TAG_PREFIX } from '../gating/capabilities.js';

/**
 * La documentación es código: este feature la ata a las tres fuentes de verdad
 * que ya existen — el schema de zod, el programa de commander y las listas de
 * `project-validator` — para que «documentado» y «existe» no puedan separarse.
 *
 * ## Por qué el sujeto es el texto
 *
 * No hay `Cuando`: el objeto bajo prueba es un documento. Es la misma clase que
 * el feature `builder-isolation.feature`, que ya lee `src/` como texto. Lo que
 * aquí evita es un tipo de pudre silencioso: agregar `titlehead` al schema y no
 * documentarlo no rompe nada hasta que un autor copia un ejemplo y falla.
 *
 * ## Por qué se comparan conjuntos y no se reescriben
 *
 * Ningún paso edita un documento. Todos fallan con la diferencia listada, que es
 * lo que hace falta para arreglarlo: el mensaje dice qué clave sobra y cuál
 * falta, en los dos sentidos.
 */

const RAIZ = join(import.meta.dir, '..', '..', '..');

function documento(nombre: string): string {
  return readFileSync(join(RAIZ, nombre), 'utf8');
}

/**
 * Las claves de primer nivel que el schema acepta, leídas del código.
 *
 * Se lee el texto y no `SiteConfigSchema` porque el schema termina en
 * `.strict().transform(...)`: es un `ZodPipe`, no un objeto plano, y sus claves
 * llegan por tres `...spread` de objetos declarados arriba. El texto es la
 * misma fuente y no hay que pelearse con la API.
 */
function clavesDelSchema(): Set<string> {
  const fuente = documento('src/config/config-schema.ts');
  const claves = new Set<string>();

  const objeto = (nombre: string): string => {
    const m = new RegExp(`const ${nombre} = \\{([\\s\\S]*?)\\n\\};`).exec(fuente);
    return m?.[1] ?? '';
  };
  for (const [inicio, fin] of [
    ['export const SiteConfigSchema = z', '  .strict()'],
    ['const FormatSchema = z', '  .strict()'],
  ] as const) {
    const desde = fuente.indexOf(inicio);
    const hasta = desde === -1 ? -1 : fuente.indexOf(fin, desde);
    const cuerpo = desde === -1 || hasta === -1 ? '' : fuente.slice(desde, hasta);
    for (const m of cuerpo.matchAll(/^\s{4}(\w+):/gm)) claves.add(m[1] ?? '');
  }
  // Los tres objetos que el schema esparce en primer nivel.
  for (const nombre of ['DublinCoreFieldsSchema', 'TitlePageFieldsSchema', 'ImageFieldsSchema']) {
    for (const m of objeto(nombre).matchAll(/^\s{2}(\w+):/gm)) claves.add(m[1] ?? '');
  }
  return claves;
}

/** Los comandos que el programa de commander expone de verdad. */
function comandosDelCli(): Set<string> {
  return new Set(buildProgram().commands.map((c) => c.name()));
}

function diferencia(mio: Set<string>, suyo: Set<string>): string {
  const sobra = [...mio].filter((x) => !suyo.has(x)).sort();
  const falta = [...suyo].filter((x) => !mio.has(x)).sort();
  const partes: string[] = [];
  if (sobra.length > 0) partes.push(`de más: ${sobra.join(', ')}`);
  if (falta.length > 0) partes.push(`sin documentar: ${falta.join(', ')}`);
  return partes.join(' · ');
}

function exigirIguales(mio: Set<string>, suyo: Set<string>, que: string): void {
  const d = diferencia(mio, suyo);
  if (d !== '') throw new Error(`la ${que} no coincide con el código (${d})`);
}

// ── Then ────────────────────────────────────────────────────────────────────

Then('todo bloque de configuración documentado es una configuración válida', () => {
  const fuente = documento('docs/configuration.md');
  let n = 0;
  for (const m of fuente.matchAll(/```ya?ml\n([\s\S]*?)```/g)) {
    n += 1;
    let datos: unknown;
    try {
      datos = parseYaml(m[1] ?? '');
    } catch (err) {
      throw new Error(`el bloque yaml #${n} de docs/configuration.md ni siquiera parsea: ${String(err)}`);
    }
    if (datos === null || typeof datos !== 'object' || Array.isArray(datos)) continue;
    const r = SiteConfigSchema.safeParse(datos);
    if (!r.success) {
      const issues = r.error.issues.map((i) => `${i.path.join('.') || '(raíz)'}: ${i.message}`).join('; ');
      throw new Error(`el bloque yaml #${n} de docs/configuration.md no valida — ${issues}`);
    }
  }
});

Then('todo campo del schema está documentado', () => {
  const documentado = documento('docs/configuration.md') + documento('README.md');
  const sinDocumentar = [...clavesDelSchema()].filter((k) => !documentado.includes(k)).sort();
  if (sinDocumentar.length > 0) {
    throw new Error(`claves del schema que no aparecen en docs/configuration.md ni en README.md: ${sinDocumentar.join(', ')}`);
  }
});

Then('todo comando documentado existe en el CLI', () => {
  const codigo = comandosDelCli();
  const mentioned = new Set<string>();
  for (const doc of ['README.md', 'docs/quickstart.md']) {
    for (const m of documento(doc).matchAll(/\biteraciones ([a-z][a-z-]+)/g)) {
      if (m[1] !== undefined) mentioned.add(m[1]);
    }
  }
  const fantasma = [...mentioned].filter((c) => !codigo.has(c)).sort();
  if (fantasma.length > 0) throw new Error(`documentados pero no existen: ${fantasma.join(', ')}`);
});

Then('las opciones de build documentadas son exactamente BuildOptions', () => {
  const cuerpo = /export interface BuildOptions \{([\s\S]*?)\n\}/.exec(documento('src/builder/orchestrator.ts'))?.[1] ?? '';
  const codigo = new Set([...cuerpo.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1] ?? ''));

  const tabla = /Opciones \(`BuildOptions`\):\n\n((?:\|[^\n]*\n)+)/.exec(documento('docs/architecture.md'))?.[1];
  if (tabla === undefined) throw new Error('no encontré la tabla de opciones de build() en docs/architecture.md');
  const filas = new Set([...tabla.matchAll(/^\|\s*`(\w+)`\s*\|/gm)].map((m) => m[1] ?? ''));

  exigirIguales(codigo, filas, 'tabla de opciones de build');
});

Then('todo campo de frontmatter documentado existe en KNOWN_FRONTMATTER_FIELDS', () => {
  const referencia = documento('docs/frontmatter-reference.md');
  const sinDocumentar = KNOWN_FRONTMATTER_FIELDS.filter((campo) => !referencia.includes(campo)).sort();
  if (sinDocumentar.length > 0) {
    throw new Error(`campos que valida el proyecto y no están en docs/frontmatter-reference.md: ${sinDocumentar.join(', ')}`);
  }
});

Then('cada capability del gating tiene su etiqueta y su razón', () => {
  for (const capability of CAPABILITIES) {
    const tag = `${TAG_PREFIX}${capability}`;
    const usos = readdirSync(join(RAIZ, 'features')).filter((f) => f.endsWith('.feature'));
    const aparece = usos.some((f) => readFileSync(join(RAIZ, 'features', f), 'utf8').includes(tag));
    if (!aparece) throw new Error(`la capability "${capability}" (${tag}) no la usa ningún feature: nadie la cubre`);
    if (SKIP_REASONS[capability] === undefined) throw new Error(`la capability "${capability}" no tiene motivo de omisión`);
  }
});

Then('ningún @requires- del repo mapea a una capability inexistente', () => {
  const conocidas = new Set<string>(CAPABILITIES.map((c) => `${TAG_PREFIX}${c}`));
  for (const f of readdirSync(join(RAIZ, 'features'))) {
    if (!f.endsWith('.feature')) continue;
    for (const m of readFileSync(join(RAIZ, 'features', f), 'utf8').matchAll(/@requires-([\w-]+)/g)) {
      const tag = `${TAG_PREFIX}${m[1]}`;
      if (!conocidas.has(tag)) throw new Error(`${f}: el tag ${tag} no mapea a ninguna capability del gating`);
    }
  }
});

Then('la lista de capabilities y las de omitidos no se contradicen', () => {
  for (const motivo of Object.keys(SKIP_REASONS)) {
    if (!(CAPABILITIES as readonly string[]).includes(motivo)) {
      throw new Error(`SKIP_REASONS declara "${motivo}" y no hay capability con ese nombre`);
    }
  }
});

/**
 * Un `Escenario` sin ningún paso de comprobación no comprueba nada: pasa en
 * verde para siempre. Es el equivalente Gherkin de `check-tautologias`.
 *
 * El parsing lo hace `@cucumber/gherkin`, que ya está instalado como dependencia
 * de `@cucumber/cucumber`: docstrings, tablas y scenarios anidados en `Regla de
 * negocio` salen del AST, no de expresiones regulares propias.
 *
 * Lo único que hay que resolver a mano es la herencia de `Y`/`E`, que el parser
 * deja tal cual: muchos features encadenan la aserción con `Y` después de un
 * `Cuando` (`Cuando exporto…` / `Y el markdown declara:`), así que un `Entonces`
 * que venga con `keywordType: 'Conjunction'` cuenta como comprobación.
 */
function escenariosSinComprobar(fuente: string): string[] {
  const doc = new Parser(new AstBuilder(() => ''), new GherkinClassicTokenMatcher('es')).parse(fuente);
  const sinComprobar: string[] = [];

  for (const hijo of doc.feature?.children ?? []) {
    const scenarios = hijo.scenario ? [hijo.scenario] : (hijo.rule?.children ?? []).flatMap((c) => (c.scenario ? [c.scenario] : []));
    for (const scenario of scenarios) {
      const comprueba = scenario.steps.some((paso) => paso.keywordType !== 'Conjunction' && paso.keyword.trim().startsWith('Entonces'));
      if (!comprueba) sinComprobar.push(scenario.name ?? '');
    }
  }
  return sinComprobar;
}

Then('ningún escenario se queda sin comprobar', () => {
  const sinComprobar: string[] = [];
  for (const archivo of readdirSync(join(RAIZ, 'features'))) {
    if (!archivo.endsWith('.feature')) continue;
    const fuente = readFileSync(join(RAIZ, 'features', archivo), 'utf8');
    for (const nombre of escenariosSinComprobar(fuente)) {
      sinComprobar.push(`${archivo}: ${nombre}`);
    }
  }
  if (sinComprobar.length > 0) {
    throw new Error(`estos escenarios no tienen ninguna comprobación (${sinComprobar.length}):\n  ${sinComprobar.join('\n  ')}`);
  }
});
