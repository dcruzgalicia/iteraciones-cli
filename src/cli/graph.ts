import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildDocumentGraph } from '../builder/graph-exporter.js';
import { classifyDocuments } from '../builder/pipeline/classify.js';
import { discover } from '../builder/pipeline/discover.js';
import { loadSiteConfig } from '../config/config-loader.js';

export type GraphCommandOptions = {
  output?: string;
};

export type GraphOutput = {
  generatedAt: string;
  documents: ReadonlyArray<{ relativePath: string; type: string; kind: string; title?: string }>;
  edges: ReadonlyArray<{ from: string; to: string; relation: string }>;
};

/**
 * Construye y emite el grafo de relaciones entre documentos sin ejecutar
 * el pipeline completo (no requiere pandoc ni render).
 *
 * Con `--output <ruta>` escribe el JSON al archivo indicado;
 * sin él escribe en stdout para permitir composición con otras herramientas.
 */
export async function runGraph(cwd: string, options: GraphCommandOptions = {}): Promise<void> {
  const config = await loadSiteConfig(cwd);
  const { docs: discovered } = await discover(cwd, { noCache: true });
  const classified = classifyDocuments(discovered, config.format?.html?.theme, cwd);
  const nonDrafts = classified.filter((doc) => !doc.frontmatter.draft);

  const { edges } = buildDocumentGraph(nonDrafts);

  const output: GraphOutput = {
    generatedAt: new Date().toISOString(),
    documents: nonDrafts.map((doc) => ({
      relativePath: doc.relativePath,
      type: doc.type ?? 'unknown',
      kind: doc.kind ?? 'page',
      ...(typeof doc.frontmatter.title === 'string' ? { title: doc.frontmatter.title } : {}),
    })),
    edges,
  };

  const json = JSON.stringify(output, null, 2);

  if (options.output) {
    const outputPath = resolve(cwd, options.output);
    await writeFile(outputPath, json, 'utf-8');
    process.stdout.write(`graph: ${nonDrafts.length} documentos, ${edges.length} aristas → "${options.output}"\n`);
  } else {
    process.stdout.write(json + '\n');
  }
}
