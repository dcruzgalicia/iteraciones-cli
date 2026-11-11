import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Given, Then } from '@cucumber/cucumber';
import { jsonSalida, world } from './cli-world.steps.js';

interface AccessibilityJson {
  checked?: number;
  issues?: { file?: string; kind?: string; message?: string }[];
}

function accesibilidad(): AccessibilityJson {
  const valor = jsonSalida().accessibility;
  if (typeof valor !== 'object' || valor === null) {
    throw new Error(`el JSON no declara "accessibility": ${world.stdout}`);
  }
  return valor as AccessibilityJson;
}

Given('el HTML construido {string} tiene este contenido', (relativa: string, contenido: string) => {
  const destino = join(world.root, relativa);
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, contenido, 'utf8');
});

Then('el JSON de accesibilidad declara {int} archivos revisados', (cantidad: number) => {
  const revisados = accesibilidad().checked;
  if (revisados !== cantidad) {
    throw new Error(`esperaba ${cantidad} archivos revisados y hubo ${String(revisados)}: ${world.stdout}`);
  }
});

Then('el JSON de accesibilidad declara la incidencia {string}', (tipo: string) => {
  const incidencias = accesibilidad().issues ?? [];
  if (!incidencias.some((incidencia) => incidencia.kind === tipo)) {
    const vistos = incidencias.map((incidencia) => incidencia.kind ?? '(sin tipo)').join(', ');
    throw new Error(`no hay incidencia de tipo ${JSON.stringify(tipo)}. Vistos: ${vistos}`);
  }
});

Then('el JSON de accesibilidad incluye el archivo {string}', (archivo: string) => {
  const incidencias = accesibilidad().issues ?? [];
  if (!incidencias.some((incidencia) => incidencia.file === archivo)) {
    throw new Error(`ninguna incidencia viene del archivo ${JSON.stringify(archivo)}`);
  }
});

Then('el JSON de accesibilidad no declara incidencias', () => {
  const incidencias = accesibilidad().issues ?? [];
  if (incidencias.length > 0) {
    throw new Error(`el JSON declara ${incidencias.length} incidencias y no debería: ${world.stdout}`);
  }
});
