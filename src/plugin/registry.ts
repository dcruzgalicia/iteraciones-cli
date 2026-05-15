import type { IPlugin, PluginBuildContext, PluginComposeContext, PluginComposeResult, PluginRenderContext, PluginRenderResult } from './types.js';

/**
 * Registro de plugins. Ejecuta los hooks de cada plugin registrado en orden
 * de inserción, siguiendo el contrato de retorno explícito: cada hook recibe
 * el contexto y retorna el contexto (posiblemente modificado).
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
      if (plugin.beforeRender) {
        ctx = await plugin.beforeRender(ctx);
      }
    }
    return ctx;
  }

  async runAfterRender(context: PluginRenderResult): Promise<PluginRenderResult> {
    let ctx = context;
    for (const plugin of this.plugins) {
      if (plugin.afterRender) {
        ctx = await plugin.afterRender(ctx);
      }
    }
    return ctx;
  }

  async runBeforeCompose(context: PluginComposeContext): Promise<PluginComposeContext> {
    let ctx = context;
    for (const plugin of this.plugins) {
      if (plugin.beforeCompose) {
        ctx = await plugin.beforeCompose(ctx);
      }
    }
    return ctx;
  }

  async runAfterCompose(context: PluginComposeResult): Promise<PluginComposeResult> {
    let ctx = context;
    for (const plugin of this.plugins) {
      if (plugin.afterCompose) {
        ctx = await plugin.afterCompose(ctx);
      }
    }
    return ctx;
  }

  async runAfterBuild(context: PluginBuildContext): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.afterBuild) {
        await plugin.afterBuild(context);
      }
    }
  }
}
