import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, join } from 'node:path';
import { logSuccess, logWarning } from '../lib/logger.js';

const require = createRequire(import.meta.url);

interface Paquete {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [clave: string]: unknown;
}

function versionSveltia(): string {
  const propio = require('../../package.json') as { dependencies?: Record<string, string> };
  return propio.dependencies?.['@sveltia/cms'] ?? '0.270.0';
}

function versionCli(): string {
  const propio = require('../../package.json') as { version?: string };
  return propio.version ?? '0.0.0';
}

function leerPaquete(crudo: string | null, cwd: string): Paquete | null {
  if (crudo === null) return { name: basename(cwd), private: true };
  try {
    return JSON.parse(crudo) as Paquete;
  } catch {
    return null;
  }
}

function asegurarScripts(paquete: Paquete, cambios: string[]): void {
  paquete.scripts ??= {};
  for (const [nombre, comando] of [
    ['build', 'iteraciones build'],
    ['dev', 'iteraciones preview'],
  ] as const) {
    if (paquete.scripts[nombre] === undefined) {
      paquete.scripts[nombre] = comando;
      cambios.push(`scripts.${nombre}`);
    }
  }
}

function asegurarCli(paquete: Paquete, cambios: string[]): void {
  const tarball = `file:vendor/iteraciones-cli-${versionCli()}.tgz`;
  const yaDeclarada = paquete.dependencies?.['iteraciones-cli'] !== undefined || paquete.devDependencies?.['iteraciones-cli'] !== undefined;
  if (yaDeclarada) return;
  paquete.dependencies ??= {};
  paquete.dependencies['iteraciones-cli'] = tarball;
  cambios.push('dependencies.iteraciones-cli');
}

function asegurarSveltia(paquete: Paquete, cambios: string[]): void {
  if (paquete.dependencies?.['@sveltia/cms'] !== undefined) {
    delete paquete.dependencies['@sveltia/cms'];
    cambios.push('dependencies.@sveltia/cms eliminado');
  }
  paquete.devDependencies ??= {};
  if (paquete.devDependencies['@sveltia/cms'] === undefined) {
    paquete.devDependencies['@sveltia/cms'] = versionSveltia();
    cambios.push('devDependencies.@sveltia/cms');
  }
}

export async function ensurePackage(cwd: string, options: { sveltia: boolean }, context: string): Promise<void> {
  const ruta = join(cwd, 'package.json');
  const crudo = await Bun.file(ruta)
    .text()
    .catch(() => null);
  const paquete = leerPaquete(crudo, cwd);
  if (paquete === null) {
    logWarning('package.json no es JSON válido; se dejó intacto', context);
    return;
  }

  const cambios: string[] = [];
  asegurarScripts(paquete, cambios);
  asegurarCli(paquete, cambios);
  if (options.sveltia) asegurarSveltia(paquete, cambios);

  if (crudo === null || cambios.length > 0) {
    await writeFile(ruta, `${JSON.stringify(paquete, null, 2)}\n`);
    logSuccess(cambios.length === 0 ? 'package.json creado' : `actualizado package.json (${cambios.join(', ')})`, context);
  } else {
    logSuccess('package.json sin cambios', context);
  }

  const tarball = `iteraciones-cli-${versionCli()}.tgz`;
  if (!existsSync(join(cwd, 'vendor', tarball))) {
    logWarning(`falta vendor/${tarball}; agrégalo antes de bun install`, context);
  }
}
