import { dirname, isAbsolute, resolve } from 'node:path';
import type { SiteConfig } from '../config/config-schema.js';
import { formatHumanDate } from '../lib/date.js';
import { BuildError } from '../lib/errors.js';
import { logWarning } from '../lib/logger.js';
import { runPandoc } from '../lib/pandoc-runner.js';
import { parseAuthors } from './discover.js';
import type { LuaFilterGroup } from './filter-resolver.js';
import { MBOX_HELPERS_FILTER } from './filter-resolver.js';
import { MD_READER, metadataValue } from './html-composer.js';
import { babelOptionsForLang, pageNumberCommandFor } from './latex-preamble.js';
import type { BuildDocument } from './types.js';

/**
 * Fecha de la portada del PDF: con show-date, la formateada del frontmatter (o
 * la creación del archivo); sin show-date, '' neutraliza el date del frontmatter
 * (la portada no muestra fecha). undefined = no hay nada que pasar.
 */
async function pdfDate(fm: Record<string, unknown>, siteConfig: SiteConfig, doc: BuildDocument): Promise<string | undefined> {
  const rawDate = typeof fm.date === 'string' && fm.date.trim() ? fm.date.trim() : undefined;
  if (siteConfig.format?.pdf?.showDate === true) {
    if (rawDate) return formatHumanDate(rawDate);
    try {
      const fileStat = await Bun.file(doc.filePath).stat();
      // birthtime puede ser 0/epoch o NaN en filesystems que no lo soportan
      // (algunos Linux, NFS): en ese caso se usa mtime como último recurso y
      // se advierte para que el usuario sepa que la fecha es de modificación.
      const birthMs = fileStat.birthtimeMs;
      const noBirthtime = !Number.isFinite(birthMs) || birthMs <= 0;
      const btime = noBirthtime ? fileStat.mtime : fileStat.birthtime;
      if (btime) {
        const y = btime.getFullYear();
        const m = String(btime.getMonth() + 1).padStart(2, '0');
        const d = String(btime.getDate()).padStart(2, '0');
        if (noBirthtime) {
          logWarning(`"${doc.filePath}" sin fecha de creación (birthtime); se usó la fecha de modificación`, 'latex');
        }
        return formatHumanDate(`${y}-${m}-${d}`);
      }
    } catch {
      // Si no se puede leer el archivo, no agregar fecha
    }
    return undefined;
  }
  // Sin show-date: el frontmatter no debe mostrar fecha en la portada
  if (rawDate || fm.date !== undefined) return '';
  return undefined;
}

/**
 * Genera el cuerpo LaTeX completo (.tex final: preámbulo + cuerpo) desde el
 * markdown original en una sola invocación de pandoc, con el template
 * efectivo compuesto por el CLI. El filtro internal/flags calcula los flags
 * del preámbulo (TOC, espaciado, \noindent) y agrega \printbibliography.
 *
 * Contrato de metadatos: el frontmatter del documento (fm) es la fuente y la
 * config aporta defaults (lang, show-date); aquí se derivan los valores
 * efectivos (título, autores, fecha de portada). El subtitle NO se deriva
 * aquí: fluye del frontmatter a la metadata y el filtro latex/10-titlepages
 * lo serializa (multilínea con |).
 */
export async function markdownToLatex(
  content: string,
  doc: BuildDocument,
  filters: LuaFilterGroup,
  bibFiles: string[],
  templatePath: string,
  fm: Record<string, unknown>,
  siteConfig: SiteConfig,
  /** false si 11-bibliography está desactivado: flags.lua no inyecta \\printbibliography. */
  biblatexAvailable = true,
  /** Registro de langs advertidos del build (babelOptionsForLang): una vez por build, no por proceso. */
  warnedLangs: Set<string>,
): Promise<string> {
  const title = typeof fm.title === 'string' && fm.title.trim() ? fm.title : 'Sin título';
  const author = parseAuthors(fm.author);

  const extraArgs = ['--template', templatePath, '--top-level-division', 'section', '--shift-heading-level-by=2'];
  // El fragmento babel del template efectivo se resuelve por el lang de la
  // configuración (el frontmatter lang no altera babel en el PDF: contrato
  // documentado en configuration.md).
  extraArgs.push(`--metadata=babel-lang:${babelOptionsForLang(siteConfig.lang, warnedLangs)}`);
  extraArgs.push(`--metadata=biblatex-available:${biblatexAvailable}`);
  // Comando del número de página (posición configurada): flags.lua lo inserta
  // después del primer bloque cuando el body empieza con un title/list-opener
  // (la numeración empieza con el contenido); con un párrafo normal, el
  // template lo emite antes del body.
  const pageCommand = pageNumberCommandFor(siteConfig.format?.pdf?.pageNumber ?? 'header-right');
  if (pageCommand) {
    extraArgs.push(`--metadata=page-number-command:${pageCommand}`);
  }
  for (const filter of [...filters.semantic, ...filters.user, ...filters.flags, ...filters.latex]) {
    extraArgs.push('--lua-filter', filter);
  }
  if (bibFiles.length > 0) {
    extraArgs.push('--biblatex');
    for (const bib of bibFiles) {
      extraArgs.push('--bibliography', bib);
    }
  }
  extraArgs.push(`--metadata=title:${metadataValue(title)}`);
  // title-image, publishers-image y endpapers: imágenes de la portada, del
  // logo del editor y de las guardas (solo LaTeX/PDF) que sustituyen o
  // decoran elementos del documento. Ruta relativa al directorio del
  // documento (o absoluta); se valida que exista para fallar con un mensaje
  // claro en vez del críptico de latexmk. El filter 10-titlepages las pasa
  // como RawInline latex (sin escapes: un guion bajo se rompería como \_ con
  // el writer).
  for (const field of ['title-image', 'publishers-image', 'endpapers']) {
    const value = typeof fm[field] === 'string' && fm[field].trim() ? fm[field].trim() : undefined;
    if (value) {
      const imagePath = isAbsolute(value) ? value : resolve(dirname(doc.filePath), value);
      if (!(await Bun.file(imagePath).exists())) {
        throw new BuildError(`${field} no encontrado: "${imagePath}" (resuelto desde "${value}")`);
      }
      extraArgs.push(`--metadata=${field}:${imagePath}`);
    }
  }
  // El subtitle NO se pasa por --metadata: el override aplanaría los \n con
  // metadataValue y el filtro latex/10-titlepages no vería el valor multilínea
  // (frontmatter con |). El filtro lo serializa desde la metadata del
  // documento: el template $if(subtitle)$ emite el RawInline latex sin
  // re-escape. En HTML el compositor sí lo aplana (render.ts).
  for (const a of author) {
    extraArgs.push(`--metadata=author:${metadataValue(a)}`);
  }
  const date = await pdfDate(fm, siteConfig, doc);
  if (date !== undefined) extraArgs.push(`--metadata=date:${metadataValue(date)}`);

  return runPandoc({
    input: content,
    sourcePath: doc.filePath,
    from: MD_READER,
    to: 'latex',
    extraArgs,
    // Ruta absoluta del helper compartido de mbox: los filters 06/07 la usan
    // con dofile (el require relativo a PANDOC_SCRIPT_FILE falla si el
    // proyecto sobrescribe 06/07).
    env: { ITERACIONES_MBOX_HELPERS: MBOX_HELPERS_FILTER },
  });
}
