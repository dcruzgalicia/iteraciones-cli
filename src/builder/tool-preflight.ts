import type { SiteConfig } from '../config/config-schema.js';
import { BuildError } from '../lib/errors.js';
import { detectMagick } from './image-processor.js';
import { resolveBibOptions } from './state-bib.js';

export async function assertBuildTools(cwd: string, siteConfig: SiteConfig, opciones: { necesitaPoppler?: boolean } = {}): Promise<void> {
  const faltan: string[] = [];

  if (Bun.which('pandoc') === null) {
    faltan.push('pandoc — https://pandoc.org/installing.html');
  }
  if (!(await detectMagick())) {
    faltan.push('ImageMagick (magick) — brew install imagemagick');
  }

  if (siteConfig.format?.pdf?.generate === true) {
    if (Bun.which('latexmk') === null || Bun.which('pdflatex') === null) {
      faltan.push('LaTeX (latexmk y pdflatex) — instala MacTeX o TeX Live');
    }

    const { bibFiles } = await resolveBibOptions(cwd, siteConfig);
    if (bibFiles.length > 0 && Bun.which('biber') === null) {
      faltan.push('biber — necesario para la bibliografía');
    }

    if (opciones.necesitaPoppler === true && Bun.which('pdftoppm') === null) {
      faltan.push('poppler (pdftoppm) — necesario para las portadas del PDF');
    }
  }

  if (faltan.length > 0) {
    throw new BuildError(`faltan herramientas obligatorias:\n  - ${faltan.join('\n  - ')}`);
  }
}
