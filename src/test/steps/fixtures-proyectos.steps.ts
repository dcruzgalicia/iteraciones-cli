import { cpSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Given, Then } from '@cucumber/cucumber';
import { tempRoot, world } from './cli-world.steps.js';

const FIXTURES = join(import.meta.dir, '../fixtures/projects');

Given('que copio la fixture de proyecto {string} a la raíz del proyecto', (nombre: string) => {
  const origen = join(FIXTURES, nombre);
  world.root = tempRoot(`iteraciones-fixture-${nombre}-`);
  cpSync(origen, world.root, { recursive: true });
});

Then('la fixture generó el archivo {string}', (relativa: string) => {
  if (!existsSync(join(world.root, relativa))) {
    throw new Error(`la fixture no generó ${JSON.stringify(relativa)}`);
  }
});

Then('la fixture generó {int} archivos en {string}', (cantidad: number, relativa: string) => {
  const dir = join(world.root, relativa);
  const archivos = readdirSync(dir, { withFileTypes: true }).filter((entrada) => entrada.isFile());
  if (archivos.length !== cantidad) {
    throw new Error(
      `esperaba ${cantidad} archivos en ${JSON.stringify(relativa)} y hubo ${archivos.length}: ${archivos.map((a) => a.name).join(', ')}`,
    );
  }
});

Then('los PDF de la fixture pesan más de {int} bytes', (minimo: number) => {
  const dir = join(world.root, 'dist', 'files');
  const pdfs = readdirSync(dir).filter((archivo) => archivo.endsWith('.pdf'));
  if (pdfs.length === 0) throw new Error('la fixture no generó ningún PDF');
  for (const pdf of pdfs) {
    const bytes = statSync(join(dir, pdf)).size;
    if (bytes <= minimo) throw new Error(`${pdf} pesa ${bytes} bytes y debía pesar más de ${minimo}`);
  }
});
