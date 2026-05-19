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
   * Se ejecuta una vez al inicio del build, antes de que se descubra o procese
   * ningún documento. Útil para inicializar servicios externos, validar configuración
   * o preparar recursos que el plugin necesitará durante el build.
   */
  beforeBuild?(context: PluginBeforeBuildContext): Promise<void> | void;

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
   * Se ejecuta antes de que un documento se convierta a PDF/EPUB.
   * Puede modificar el body markdown o los metadatos editoriales del documento.
   * Retorna el contexto modificado (sin mutar el original).
   */
  beforeExport?(context: PluginExportContext): Promise<PluginExportContext> | PluginExportContext;

  /**
   * Se ejecuta después de generar un archivo PDF o EPUB.
   * Puede post-procesar los bytes del archivo resultante (firma, compresión, etc.).
   * Retorna el resultado modificado (sin mutar el original).
   */
  afterExport?(context: PluginExportResult): Promise<PluginExportResult> | PluginExportResult;

  /**
   * Se ejecuta al término del build para generar archivos adicionales en dist/web.
   * Los archivos retornados se escriben antes de ejecutar afterBuild, de modo que
   * afterBuild recibe sus paths en `outputPaths`. Útil para sitemap.xml, feed.json,
   * índice de búsqueda, etc.
   */
  generateFiles?(context: PluginBuildContext): Promise<GeneratedFile[]> | GeneratedFile[];

  /**
   * Se ejecuta una vez al término del build, después de que todos los documentos
   * han sido escritos en dist/web (incluyendo los generados por generateFiles).
   * Útil para notificaciones, reportes, sincronización con servicios externos.
   */
  afterBuild?(context: PluginBuildContext): Promise<void> | void;
}

/** Contexto disponible para el hook beforeRender. */
export type PluginRenderContext = {
  /** Ruta absoluta al archivo markdown fuente. */
  readonly sourcePath: string;
  /** Variables que se pasarán a pandoc como metadatos. */
  readonly variables: Readonly<Record<string, string>>;
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
  readonly templateContext: Readonly<Record<string, unknown>>;
};

/** Contexto disponible para el hook afterCompose. */
export type PluginComposeResult = {
  /** Ruta relativa al archivo HTML de salida (relativa a dist/web). */
  readonly outputRelativePath: string;
  /** HTML final compuesto (página completa). */
  readonly html: string;
};

/** Contexto disponible para el hook beforeExport. */
export type PluginExportContext = {
  /** Ruta absoluta al archivo markdown fuente. */
  readonly sourcePath: string;
  /** Cuerpo markdown ensamblado (puede contener capítulos concatenados para libros). */
  readonly body: string;
  /** Metadatos editoriales del documento. */
  readonly metadata: Readonly<Record<string, unknown>>;
};

/** Resultado disponible para el hook afterExport. */
export type PluginExportResult = {
  /** Ruta absoluta al archivo markdown fuente. */
  readonly sourcePath: string;
  /** Formato del archivo generado. */
  readonly format: 'pdf' | 'epub';
  /** Bytes del archivo generado. */
  readonly data: Uint8Array;
};

/** Resumen ligero de un documento construido, disponible para plugins en generateFiles y afterBuild. */
export type PluginDocumentSummary = {
  /** Ruta relativa al archivo markdown fuente (ej. 'notas/mi-nota.md'). */
  readonly relativePath: string;
  /** Ruta relativa al archivo HTML de salida (ej. 'notas/mi-nota.html'). */
  readonly outputPath: string;
  /** Tipo de documento clasificado por el SSG (ej. 'file', 'author', 'event'). */
  readonly type: string;
  /** Frontmatter del documento fuente. */
  readonly frontmatter: Readonly<Record<string, unknown>>;
};

/** Contexto disponible para los hooks generateFiles y afterBuild. */
export type PluginBuildContext = {
  /** Directorio de salida absoluto (p. ej. /ruta/proyecto/dist/web). */
  readonly outputDir: string;
  /** Rutas relativas de todos los archivos generados en dist/web en este build. */
  readonly outputPaths: ReadonlyArray<string>;
  /** Configuración del sitio leída de _iteraciones.yaml. */
  readonly siteConfig: Readonly<Record<string, unknown>>;
  /** Resumen de todos los documentos construidos en este build. */
  readonly documents: ReadonlyArray<PluginDocumentSummary>;
};

/**
 * Archivo adicional que un plugin puede generar al final del build.
 * Se escribe en `outputDir/relativePath` junto al resto del sitio.
 */
export type GeneratedFile = {
  /**
   * Ruta relativa al directorio de salida (p. ej. 'sitemap.xml', 'feeds/rss.xml').
   * No puede ser absoluta ni contener componentes '..'.
   */
  relativePath: string;
  /** Contenido del archivo: string para texto (UTF-8) o ArrayBuffer para datos binarios. */
  content: string | ArrayBuffer;
};

/** Contexto disponible para el hook beforeBuild. */
export type PluginBeforeBuildContext = {
  /** Directorio raíz del proyecto (donde está _iteraciones.yaml). */
  readonly cwd: string;
  /** Directorio de salida absoluto (p. ej. /ruta/proyecto/dist/web). */
  readonly outputDir: string;
  /** Configuración del sitio leída de _iteraciones.yaml. */
  readonly siteConfig: Readonly<Record<string, unknown>>;
};
