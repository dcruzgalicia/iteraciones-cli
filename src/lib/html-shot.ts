import { pathToFileURL } from 'node:url';
import { logWarning } from './logger.js';

const HTML_SHOT_WIDTH = 1440;

const HTML_SHOT_MAX_HEIGHT = 16384;

const HTML_SHOT_MIN_HEIGHT = 900;

const SIN_ANIMACIONES = `(() => {
  const estilo = document.createElement('style');
  estilo.textContent = '*,*::before,*::after{animation:none !important;transition:none !important}';
  document.head.appendChild(estilo);
  return true;
})()`;

export async function captureHtmlShot(htmlPath: string): Promise<{ png: Buffer; alto: number } | undefined> {
  let view: Bun.WebView;
  try {
    view = new Bun.WebView({ width: HTML_SHOT_WIDTH, height: HTML_SHOT_MIN_HEIGHT });
  } catch (err) {
    logWarning(`no hay navegador para capturar el HTML: ${(err as Error).message}`, 'snapshots');
    return undefined;
  }
  try {
    return await capturaUna(htmlPath, view);
  } catch (err) {
    logWarning(`no se pudo capturar "${htmlPath}": ${(err as Error).message}`, 'snapshots');
    return undefined;
  } finally {
    view.close();
  }
}

async function capturaUna(htmlPath: string, view: Bun.WebView): Promise<{ png: Buffer; alto: number } | undefined> {
  await view.resize(HTML_SHOT_WIDTH, HTML_SHOT_MIN_HEIGHT);
  await view.navigate(pathToFileURL(htmlPath).href);

  await view.evaluate(SIN_ANIMACIONES);

  await view.evaluate('document.fonts.ready');

  await view.evaluate('Promise.all(Array.from(document.images, (img) => img.decode().catch(() => {})))');

  await view.evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const alto = await view.evaluate<number>('document.documentElement.scrollHeight');

  const altoFinal = Math.min(Math.max(1, Math.ceil(alto)) + 40, HTML_SHOT_MAX_HEIGHT);
  await view.resize(HTML_SHOT_WIDTH, altoFinal);

  await view.evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const png = await view.screenshot({ encoding: 'buffer' });
  return { png, alto: altoFinal };
}
