import { Given, Then, When } from '@cucumber/cucumber';
import { assembleExportDocument } from '../../builder/export.js';
import type { BuildDocument } from '../../builder/types.js';
import { formatHumanDate } from '../../lib/date.js';
import { plural } from '../../lib/plural.js';
import { world } from './cli-world.steps.ts';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

Given('la fecha del documento es {string}', (fecha: string) => {
  world.fechaDoc = fecha;
});

When('la formateo para el lector', () => {
  world.fechaLegible = formatHumanDate(world.fechaDoc as string) as string | undefined;
});

When('la formateo sin fecha', () => {
  world.fechaLegible = formatHumanDate(undefined) as string | undefined;
});

Then('la fecha legible es {string}', (esperada: string) => {
  const leida = world.fechaLegible;
  if (leida !== esperada) {
    throw new Error(`es ${JSON.stringify(leida)} y debería ser ${JSON.stringify(esperada)}`);
  }
});

Then('la fecha legible no existe', () => {
  if (world.fechaLegible !== undefined) {
    throw new Error(`sin fecha no debería haber fecha legible y hay ${JSON.stringify(world.fechaLegible)}`);
  }
});

Then('la fecha conserva su propio día', () => {
  const dia = String(world.fechaDoc);
  const esperado = `${Number(dia.slice(8))} de ${MESES[Number(dia.slice(5, 7)) - 1]} de ${dia.slice(0, 4)}`;
  if (world.fechaLegible !== esperado) {
    throw new Error(`la fecha ${dia} salió como ${JSON.stringify(world.fechaLegible)} y debía decir "${esperado}"`);
  }
});

When('escribo {int} {string}', (cantidad: number, palabra: string) => {
  world.pluralResultado = plural(cantidad, palabra);
});

When('escribo {int} {string} en plural {string}', (cantidad: number, palabra: string, pluralPalabra: string) => {
  world.pluralResultado = plural(cantidad, palabra, pluralPalabra);
});

Then('se lee {string}', (esperado: string) => {
  if (world.pluralResultado !== esperado) {
    throw new Error(`se lee ${JSON.stringify(world.pluralResultado)} y debería leerse ${JSON.stringify(esperado)}`);
  }
});

Given('el documento tiene título, fecha y dos autores', () => {
  world.documentoExport = {
    filePath: '/proyecto/test.md',
    relativePath: 'test.md',
    frontmatter: { title: 'Título', date: '2026-08-08', creator: ['Ana', 'Luis'] },
  } as unknown as BuildDocument;
});

When('lo ensamblo para {string} con {string} de bibliografía y {string} de CSL', async (idioma: string, bib: string, csl: string) => {
  world.export = assembleExportDocument(world.documentoExport as BuildDocument, idioma, bib || undefined, csl || undefined);
});

Then('los metadatos llevan la fecha legible y su ISO', () => {
  const m = (world.export as { metadata: Record<string, unknown> }).metadata;
  if (m.date !== '8 de agosto de 2026') throw new Error(`la fecha legible es ${JSON.stringify(m.date)}`);
  if (m.dateIso !== '2026-08-08') throw new Error(`la ISO es ${JSON.stringify(m.dateIso)}`);
});

Then('los metadatos llevan {string} como CSL', (csl: string) => {
  const leido = (world.export as { metadata: Record<string, unknown> }).metadata.csl;
  if (leido !== csl) throw new Error(`el CSL es ${JSON.stringify(leido)} y debería ser ${JSON.stringify(csl)}`);
});

Then('los metadatos no definen CSL', () => {
  const m = (world.export as { metadata: Record<string, unknown> }).metadata;
  if (m.csl !== undefined) throw new Error(`el CSL es ${JSON.stringify(m.csl)} y no debería haberlo`);
});

Then('los metadatos llevan {string} como bibliografía', (bib: string) => {
  const leido = (world.export as { metadata: Record<string, unknown> }).metadata.bibliography;
  if (leido !== bib) throw new Error(`la bibliografía es ${JSON.stringify(leido)} y debería ser ${JSON.stringify(bib)}`);
});

Then('los metadatos no definen bibliografía', () => {
  const m = (world.export as { metadata: Record<string, unknown> }).metadata;
  if (m.bibliography !== undefined) throw new Error(`la bibliografía es ${JSON.stringify(m.bibliography)}`);
});
