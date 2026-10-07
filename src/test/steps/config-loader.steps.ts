import { spyOn } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Given, Then, When } from '@cucumber/cucumber';
import { loadSiteConfig, loadSiteConfigIfPresent, loadSiteConfigWithPresence } from '../../config/config-loader.js';
import {
  DEFAULT_EPUB_FORMAT,
  DEFAULT_HTML_FORMAT,
  DEFAULT_MARKDOWN_FORMAT,
  DEFAULT_PDF_FORMAT,
  DEFAULT_SITE_CONFIG,
} from '../../config/site-config.js';
import { tempRoot, world } from './cli-world.steps.ts';

function raizConfig(): string {
  world.root = tempRoot('iteraciones-cli-config-');
  return world.root;
}

function escribeConfig(contenido: string): void {
  mkdirSync(world.root, { recursive: true });
  writeFileSync(join(world.root, 'iteraciones.config.yaml'), contenido, 'utf8');
}

function en(objeto: unknown, ruta: string): unknown {
  return ruta.split('.').reduce<unknown>((valor, clave) => (valor as Record<string, unknown>)?.[clave], objeto);
}

Given('que el proyecto no tiene archivo de configuración', () => {
  raizConfig();
});

Given('que el archivo de configuración es:', (yaml: string) => {
  raizConfig();
  escribeConfig(yaml);
});

When('cargo la configuración del proyecto', async () => {
  const espia = spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    world.config = await loadSiteConfig(world.root);
    world.errorConfig = '';
  } catch (e) {
    world.config = null;
    world.errorConfig = (e as Error).message;
  } finally {
    world.stderr = espia.mock.calls.map((c) => String(c[0])).join('');
    espia.mockRestore();
  }
});

When('cargo la configuración si existe', async () => {
  world.configOpcional = await loadSiteConfigIfPresent(world.root);
  world.config = world.configOpcional;
});

When('cargo la configuración con el conjunto de presencia', async () => {
  try {
    const { config, presentKeys } = await loadSiteConfigWithPresence(world.root);
    world.config = config;
    world.presentes = presentKeys;
    world.errorConfig = '';
  } catch (e) {
    world.config = null;
    world.presentes = new Set<string>();
    world.errorConfig = (e as Error).message;
  }
});

Then('la carga no falla', () => {
  if (world.errorConfig) throw new Error(`la carga falló: ${world.errorConfig}`);
});

Then('la carga falla diciendo que:', (motivo: string) => {
  if (!world.errorConfig) throw new Error('la carga no falló y debía');

  const esperado = motivo.trim();
  if (!world.errorConfig.includes(esperado)) {
    throw new Error(`el error no dice ${JSON.stringify(esperado)}. Dijo: ${world.errorConfig}`);
  }
});

Then('la carga falla con {string}', (motivo: string) => {
  if (!world.errorConfig) throw new Error('la carga no falló y debía');
  if (!world.errorConfig.includes(motivo)) {
    throw new Error(`el error no dice ${JSON.stringify(motivo)}. Dijo: ${world.errorConfig}`);
  }
});

Then('no hay archivo de configuración', () => {
  if (world.configOpcional !== null) {
    throw new Error(`sin archivo de configuración esto debería ser null y fue ${JSON.stringify(world.configOpcional)}`);
  }
});

Then('la configuración tiene {string} con el valor {string}', (ruta: string, valor: string) => {
  const leido = en(world.config, ruta);
  const comoLista = Array.isArray(leido) ? leido.join(', ') : undefined;
  if (String(leido) !== valor && comoLista !== valor) {
    throw new Error(`${ruta} vale ${JSON.stringify(leido)} y el archivo dice ${JSON.stringify(valor)}`);
  }
});

Then('la configuración deja {string} sin materializar', (ruta: string) => {
  const leido = en(world.config, ruta);
  if (leido !== undefined) {
    throw new Error(`${ruta} se materializó a ${JSON.stringify(leido)} y debía quedar sin definir`);
  }
});

Then('la configuración avisa que {string}', (motivo: string) => {
  if (!world.stderr.includes(motivo)) {
    throw new Error(`el loader no avisó ${JSON.stringify(motivo)}. stderr: ${JSON.stringify(world.stderr)}`);
  }
});

Then('la carga no avisa nada', () => {
  if (world.stderr.includes('⚠')) {
    throw new Error(`una configuración válida produjo un aviso: ${JSON.stringify(world.stderr)}`);
  }
});

Then('la clave {string} está en el conjunto de presencia', (ruta: string) => {
  if (!world.presentes.has(ruta)) {
    throw new Error(`${ruta} no está en el conjunto de presencia: ${JSON.stringify([...world.presentes])}`);
  }
});

Then('la clave {string} NO está en el conjunto de presencia', (ruta: string) => {
  if (world.presentes.has(ruta)) {
    throw new Error(`${ruta} sí está en el conjunto de presencia y no debía`);
  }
});

Then('el conjunto de presencia está vacío', () => {
  if (world.presentes.size !== 0) {
    throw new Error(`esperaba cero claves presentes y hay ${JSON.stringify([...world.presentes])}`);
  }
});

Then('la configuración coincide con los defaults del esquema', () => {
  const c = world.config as Record<string, unknown>;
  const compara = (ruta: string, esperado: unknown) => {
    const leido = en(c, ruta);
    if (JSON.stringify(leido) !== JSON.stringify(esperado)) {
      throw new Error(`${ruta} vale ${JSON.stringify(leido)} y el default es ${JSON.stringify(esperado)}`);
    }
  };
  compara('language', DEFAULT_SITE_CONFIG.language);
  compara('toc', DEFAULT_SITE_CONFIG.toc);
  compara('format.latex', DEFAULT_SITE_CONFIG.format.latex);
  compara('format.html', DEFAULT_HTML_FORMAT);
  compara('format.pdf.generate', DEFAULT_PDF_FORMAT.generate);
  compara('format.epub', DEFAULT_EPUB_FORMAT);
  compara('format.markdown', DEFAULT_MARKDOWN_FORMAT);
});

Then('la configuración de {string} es la misma que la de {string}', (a: string, b: string) => {
  const una = world.configs[a] as Record<string, unknown> | undefined;
  const otra = world.configs[b] as Record<string, unknown> | undefined;
  if (!una || !otra) throw new Error(`faltan configs: ${JSON.stringify(Object.keys(world.configs))}`);
  for (const ruta of ['format.latex', 'format.html.generate', 'format.pdf.disabledPreambleFilters']) {
    const x = JSON.stringify(en(una, ruta));
    const y = JSON.stringify(en(otra, ruta));
    if (x !== y) {
      throw new Error(`${ruta} vale ${x} en ${a} y ${y} en ${b}: las vías de carga no dan lo mismo`);
    }
  }
});

When('guardo la configuración como {string}', (nombre: string) => {
  world.configs[nombre] = world.config;
});
