import type { IPlugin, PluginBuildContext, PluginComposeContext, PluginComposeResult, PluginRenderContext, PluginRenderResult } from './types.js';

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

  async runAfterBuild(context: PluginBuildContext): Promise<void> {
    for (const plugin of this.plugins) {
      if (typeof plugin.afterBuild === 'function') {
        await plugin.afterBuild(context);
      }
    }
  }
}
