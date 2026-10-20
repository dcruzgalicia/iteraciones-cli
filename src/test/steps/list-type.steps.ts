import { Given, Then, When } from '@cucumber/cucumber';
import { parse as parseYaml } from 'yaml';
import { validateFrontmatterFields } from '../../builder/project-validator.js';
import { escribirEnProyecto, world } from './cli-world.steps.ts';

When('valido el frontmatter de una lista:', (fm: string) => {
  world.issuesFrontmatter = validateFrontmatterFields(parseYaml(fm));
});

Then('algún error de frontmatter menciona {string}', (texto: string) => {
  const errores = (world.issuesFrontmatter as { severity: string; message: string }[]).filter((i) => i.severity === 'error');
  if (!errores.some((i) => i.message.includes(texto))) {
    throw new Error(`ningún error menciona ${JSON.stringify(texto)}: ${JSON.stringify(errores.map((e) => e.message))}`);
  }
});

Then('ningún error de frontmatter menciona {string}', (texto: string) => {
  const errores = (world.issuesFrontmatter as { severity: string; message: string }[]).filter((i) => i.severity === 'error');
  const menciona = errores.filter((i) => i.message.includes(texto));
  if (menciona.length > 0) throw new Error(`algún error menciona ${JSON.stringify(texto)}: ${menciona[0]?.message}`);
});

Then('los miembros de {string} son {string}', (ruta: string, esperados: string) => {
  const entrada = (world.indice as Map<string, { files?: string[] }>).get(ruta);
  if (!entrada) throw new Error(`el índice no tiene ${ruta}`);
  const leidos = (entrada.files ?? []).join(', ');
  if (leidos !== esperados) {
    throw new Error(`los miembros de ${ruta} son ${JSON.stringify(leidos)} y deberían ser ${JSON.stringify(esperados)}`);
  }
});

Given('una lista con {int} textos', (cuantos: number) => {
  for (let i = 1; i <= cuantos; i++) {
    escribirEnProyecto(`texto-${i}.md`, `---\ntitle: Texto ${i}\n---\n\nTarjeta ${i}.\n`);
  }
  escribirEnProyecto('lista.md', '---\ntitle: Todos los textos\ntype: list\n---\n');
});

Given('el proyecto produce html, markdown y epub', () => {
  escribirEnProyecto(
    'iteraciones.config.yaml',
    'language: es-MX\nformat:\n  html:\n    generate: true\n  markdown:\n    generate: true\n  epub:\n    generate: true\n',
  );
});
