import { exec } from './run.js';

// ponytail: una versión por herramienta, memoizada para no spawnar en cada documento. El hash
// usa el resultado; si una herramienta no está, la cadena vacía ya cambia el hash respecto a la
// vez que sí estaba, que es justo el caso que nosIMPORTABA (instalar `minify` debe invalidar).
const memo = new Map<string, string>();

async function probe(bin: string, args: string[]): Promise<string> {
  const cached = memo.get(bin);
  if (cached !== undefined) return cached;
  let version: string;
  try {
    const result = await exec(bin, args, { timeoutMs: 10_000 });
    // pdftoppm y minify escriben su versión a stderr; el resto a stdout.
    const first = (result.stdout.trim() || result.stderr.trim()).split('\n')[0]?.trim() ?? '';
    version = result.exitCode === 0 || result.exitCode === 1 ? first : '';
  } catch {
    version = '';
  }
  memo.set(bin, version);
  return version;
}

export function toolVersionMagick(): Promise<string> {
  return probe('magick', ['-version']);
}

export function toolVersionPdfToPpm(): Promise<string> {
  return probe('pdftoppm', ['-v']);
}

export function toolVersionLatexmk(): Promise<string> {
  return probe('latexmk', ['-v']);
}

export function toolVersionMinify(): Promise<string> {
  return probe('minify', ['--version']);
}

export function resetToolVersionCache(): void {
  memo.clear();
}
