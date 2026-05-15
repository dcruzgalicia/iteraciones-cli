/**
 * Contrato de plugins para iteraciones-cli.
 *
 * Todos los hooks son opcionales. Los hooks de transformación reciben el contexto
 * actual y deben retornar el contexto (posiblemente modificado) sin mutar el
 * objeto recibido. Usar spread o structuredClone para producir una copia modificada.
 */
export interface IPlugin {
  /** Nombre único del plugin, usado en mensajes de error y diagnóstico. */
  readonly name: string;

  /**
   * Se ejecuta antes de que pandoc convierta el markdown a HTML fragment.
   * Puede modificar las variables que se pasan a pandoc.
   */
  beforeRender?(context: PluginRenderContext): Promise<PluginRenderContext> | PluginRenderContext;

  /**
   * Se ejecuta después de que pandoc produce el HTML fragment.
   * Puede reescribir el fragmento HTML resultante.
   */
  afterRender?(context: PluginRenderResult): Promise<PluginRenderResult> | PluginRenderResult;

  /**
   * Se ejecuta antes de componer el HTML final (pandoc template + layout).
   * Puede agregar o modificar variables del contexto de template.
   */
  beforeCompose?(context: PluginComposeContext): Promise<PluginComposeContext> | PluginComposeContext;

  /**
   * Se ejecuta después de componer el HTML final.
   * Puede hacer postprocesado del HTML de salida.
   */
  afterCompose?(context: PluginComposeResult): Promise<PluginComposeResult> | PluginComposeResult;

  /**
   * Se ejecuta una vez al término del build, después de que todos los documentos
   * han sido escritos en dist/web.
   * Útil para generación de feeds, sitemaps, reportes, etc.
   */
  afterBuild?(context: PluginBuildContext): Promise<void> | void;
}

/** Contexto disponible para el hook beforeRender. */
export type PluginRenderContext = {
  /** Ruta absoluta al archivo markdown fuente. */
  readonly sourcePath: string;
  /** Variables que se pasarán a pandoc como metadatos. */
  readonly variables: Record<string, string>;
};

/** Contexto disponible para el hook afterRender. */
export type PluginRenderResult = {
  /** Ruta absoluta al archivo markdown fuente. */
  readonly sourcePath: string;
  /** HTML fragment producido por pandoc. */
  readonly html: string;
};

/** Contexto disponible para el hook beforeCompose. */
export type PluginComposeContext = {
  /** Ruta relativa al archivo HTML de salida (relativa a dist/web). */
  readonly outputRelativePath: string;
  /** Variables de contexto para el template y el layout. */
  readonly templateContext: Record<string, unknown>;
};

/** Contexto disponible para el hook afterCompose. */
export type PluginComposeResult = {
  /** Ruta relativa al archivo HTML de salida (relativa a dist/web). */
  readonly outputRelativePath: string;
  /** HTML final compuesto (página completa). */
  readonly html: string;
};

/** Contexto disponible para el hook afterBuild. */
export type PluginBuildContext = {
  /** Directorio de salida absoluto (p. ej. /ruta/proyecto/dist/web). */
  readonly outputDir: string;
  /** Rutas relativas de todos los archivos generados en dist/web en este build. */
  readonly outputPaths: ReadonlyArray<string>;
};
