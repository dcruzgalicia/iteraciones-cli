import { isAbsolute, join, normalize, relative } from 'node:path';
import type {
  GeneratedFile,
  IPlugin,
  PluginBeforeBuildContext,
  PluginBuildContext,
  PluginClassifiedDocument,
  PluginComposeContext,
  PluginComposeResult,
  PluginExportContext,
  PluginExportResult,
  PluginRenderContext,
  PluginRenderResult,
  PluginSourceDocument,
} from './types.js';

/**
 * Registro de plugins. Ejecuta los hooks de cada plugin registrado en orden
 * de inserción. Los hooks de transformación (beforeRender, afterRender,
 * beforeCompose, afterCompose) reciben el contexto y deben retornar el contexto
 * (posiblemente modificado). El hook afterBuild es de notificación y no retorna
 * contexto.
 */
export class PluginRegistry {
  private readonly plugins: IPlugin[] = [];

  register(plugin: IPlugin): void {
    this.plugins.push(plugin);
  }

  get size(): number {
    return this.plugins.length;
  }

  async runBeforeBuild(context: PluginBeforeBuildContext): Promise<void> {
    for (const plugin of this.plugins) {
      if (typeof plugin.beforeBuild === 'function') {
        await plugin.beforeBuild(context);
      }
    }
  }

  async runOnDocumentDiscovered(context: PluginSourceDocument): Promise<PluginSourceDocument | null> {
    let ctx = context;
    for (const plugin of this.plugins) {
      if (typeof plugin.onDocumentDiscovered === 'function') {
        const result = await plugin.onDocumentDiscovered(ctx);
        if (result === null) return null;
        if (result !== undefined) {
          if (typeof result !== 'object') {
            throw new Error(`[plugin:${plugin.name}] onDocumentDiscovered debe retornar un objeto, null o void; recibido: ${typeof result}`);
          }
          ctx = result;
        }
      }
    }
    return ctx;
  }

  async runOnDocumentClassified(context: PluginClassifiedDocument): Promise<PluginClassifiedDocument | null> {
    let ctx = context;
    for (const plugin of this.plugins) {
      if (typeof plugin.onDocumentClassified === 'function') {
        const result = await plugin.onDocumentClassified(ctx);
        if (result === null) return null;
        if (result !== undefined) {
          if (typeof result !== 'object') {
            throw new Error(`[plugin:${plugin.name}] onDocumentClassified debe retornar un objeto, null o void; recibido: ${typeof result}`);
          }
          ctx = result;
        }
      }
    }
    return ctx;
  }

  async runBeforeRender(context: PluginRenderContext): Promise<PluginRenderContext> {
    let ctx = context;
    for (const plugin of this.plugins) {
      if (typeof plugin.beforeRender === 'function') {
        const result = await plugin.beforeRender(ctx);
        if (result == null) throw new Error(`[plugin:${plugin.name}] beforeRender debe retornar el contexto; recibido: ${String(result)}`);
        ctx = result;
      }
    }
    return ctx;
  }

  async runAfterRender(context: PluginRenderResult): Promise<PluginRenderResult> {
    let ctx = context;
    for (const plugin of this.plugins) {
      if (typeof plugin.afterRender === 'function') {
        const result = await plugin.afterRender(ctx);
        if (result == null) throw new Error(`[plugin:${plugin.name}] afterRender debe retornar el contexto; recibido: ${String(result)}`);
        ctx = result;
      }
    }
    return ctx;
  }

  async runBeforeCompose(context: PluginComposeContext): Promise<PluginComposeContext> {
    let ctx = context;
    for (const plugin of this.plugins) {
      if (typeof plugin.beforeCompose === 'function') {
        const result = await plugin.beforeCompose(ctx);
        if (result == null) throw new Error(`[plugin:${plugin.name}] beforeCompose debe retornar el contexto; recibido: ${String(result)}`);
        ctx = result;
      }
    }
    return ctx;
  }

  async runAfterCompose(context: PluginComposeResult): Promise<PluginComposeResult> {
    let ctx = context;
    for (const plugin of this.plugins) {
      if (typeof plugin.afterCompose === 'function') {
        const result = await plugin.afterCompose(ctx);
        if (result == null) throw new Error(`[plugin:${plugin.name}] afterCompose debe retornar el contexto; recibido: ${String(result)}`);
        ctx = result;
      }
    }
    return ctx;
  }

  async runBeforeExport(context: PluginExportContext): Promise<PluginExportContext> {
    let ctx = context;
    for (const plugin of this.plugins) {
      if (typeof plugin.beforeExport === 'function') {
        const result = await plugin.beforeExport(ctx);
        if (result == null) throw new Error(`[plugin:${plugin.name}] beforeExport debe retornar el contexto; recibido: ${String(result)}`);
        ctx = result;
      }
    }
    return ctx;
  }

  async runAfterExport(context: PluginExportResult): Promise<PluginExportResult> {
    let ctx = context;
    for (const plugin of this.plugins) {
      if (typeof plugin.afterExport === 'function') {
        const result = await plugin.afterExport(ctx);
        if (result == null) throw new Error(`[plugin:${plugin.name}] afterExport debe retornar el contexto; recibido: ${String(result)}`);
        ctx = result;
      }
    }
    return ctx;
  }

  async runGenerateFiles(context: PluginBuildContext): Promise<GeneratedFile[]> {
    const files: GeneratedFile[] = [];
    for (const plugin of this.plugins) {
      if (typeof plugin.generateFiles === 'function') {
        const result = await plugin.generateFiles(context);
        if (!Array.isArray(result)) {
          throw new Error(`[plugin:${plugin.name}] generateFiles debe retornar un array; recibido: ${String(result)}`);
        }
        for (const file of result) {
          const rel = file.relativePath;
          if (!rel || isAbsolute(rel)) {
            throw new Error(`[plugin:${plugin.name}] generateFiles: ruta inválida "${rel}" — debe ser relativa`);
          }
          const resolved = join(context.outputDir, normalize(rel));
          if (relative(context.outputDir, resolved).startsWith('..')) {
            throw new Error(`[plugin:${plugin.name}] generateFiles: ruta inválida "${rel}" — el archivo debe estar dentro de outputDir`);
          }
          files.push(file);
        }
      }
    }
    return files;
  }

  async runAfterBuild(context: PluginBuildContext): Promise<void> {
    for (const plugin of this.plugins) {
      if (typeof plugin.afterBuild === 'function') {
        await plugin.afterBuild(context);
      }
    }
  }
}
