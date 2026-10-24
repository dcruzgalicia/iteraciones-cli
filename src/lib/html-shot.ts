import { pathToFileURL } from 'node:url';
import { logWarning } from './logger.js';

/** Ancho de la captura en píxeles CSS: 2 columnas del masonry (lg:1024, 2xl:1536). */
export const HTML_SHOT_WIDTH = 1440;

/** El alto máximo que acepta el navegador. */
export const HTML_SHOT_MAX_HEIGHT = 16384;

const HTML_SHOT_MIN_HEIGHT = 900;

/**
 * Captura las páginas del sitio con el navegador que trae Bun.
 *
 * La vista se mide por su alto real y se redimensiona a ese alto antes de
 * capturar, así la imagen sale entera y no recortada. Si el navegador no está
 * disponible, la captura se salta con un aviso: los snapshots del PDF siguen
 * valiendo.
 */
const SIN_ANIMACIONES = `(() => {
  const estilo = document.createElement('style');
  estilo.textContent = '*,*::before,*::after{animation:none !important;transition:none !important}';
  document.head.appendChild(estilo);
  return true;
})()`;

export class HtmlShotter {
  // Cada captura estrena vista: reutilizarla deja estado (zoom, fuentes,
  // scroll) que cambia el antialiasing de una página a otra.
  async capture(htmlPath: string): Promise<{ png: Buffer; alto: number } | undefined> {
    let view: Bun.WebView;
    try {
      view = new Bun.WebView({ width: HTML_SHOT_WIDTH, height: HTML_SHOT_MIN_HEIGHT });
    } catch (err) {
      logWarning(`no hay navegador para capturar el HTML: ${(err as Error).message}`, 'snapshots');
      return undefined;
    }
    try {
      return await this.capturaUna(htmlPath, view);
    } catch (err) {
      logWarning(`no se pudo capturar "${htmlPath}": ${(err as Error).message}`, 'snapshots');
      return undefined;
    } finally {
      view.close();
    }
  }

  private async capturaUna(htmlPath: string, view: Bun.WebView): Promise<{ png: Buffer; alto: number } | undefined> {
    // La vista conserva el alto de la captura anterior: a otro alto, la
    // página se maqueta distinto. Se vuelve al alto base antes de medir.
    await view.resize(HTML_SHOT_WIDTH, HTML_SHOT_MIN_HEIGHT);
    await view.navigate(pathToFileURL(htmlPath).href);
    // Las animaciones dependen del frame en que caiga la captura: sin ellas,
    // la misma página sale siempre igual.
    await view.evaluate(SIN_ANIMACIONES);
    // Las tipografías se resuelven después del primer pintado: esperar a que
    // estén listas evita medir con la tipografía de reserva.
    await view.evaluate('document.fonts.ready');
    // Las imágenes (portadas, por ejemplo) también llegan tarde: si no están
    // cargadas al medir, el texto de abajo se desplaza entre una captura y otra.
    await view.evaluate(
      'Promise.all(Array.from(document.images, (img) => img.complete ? true : new Promise((resolve) => { img.addEventListener("load", resolve, { once: true }); img.addEventListener("error", resolve, { once: true }); })))',
    );
    // El texto se pinta en segundo plano: sin estos dos frames, la captura
    // puede salir a medio pintar y cambiar de un render a otro.
    await view.evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const alto = await view.evaluate<number>('document.documentElement.scrollHeight');
    // Un margen de más: si la vista queda justa, aparece la barra de
    // desplazamiento, el contenido se estrecha y el texto se desplaza.
    const altoFinal = Math.min(Math.max(1, Math.ceil(alto)) + 40, HTML_SHOT_MAX_HEIGHT);
    await view.resize(HTML_SHOT_WIDTH, altoFinal);
    const png = await view.screenshot({ encoding: 'buffer' });
    return { png, alto: altoFinal };
  }

  close(): void {
    // Cada captura cierra su propia vista; no queda nada que liberar.
  }
}
