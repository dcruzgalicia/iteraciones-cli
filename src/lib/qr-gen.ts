import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { prepareZXingModule, writeBarcode } from 'zxing-wasm/writer';

const WASM_PATH = new URL('../../node_modules/zxing-wasm/dist/writer/zxing_writer.wasm', import.meta.url);

async function main(): Promise<void> {
  const outDir = process.argv[2];
  if (!outDir) process.exit(1);

  const url = (await Bun.stdin.text()).trim();
  if (!url) process.exit(1);

  const hash = createHash('md5').update(url).digest('hex');
  const svgPath = `${outDir}/qr-${hash}.svg`;
  const pngPath = `${outDir}/qr-${hash}.png`;
  const jpgPath = `${outDir}/qr-${hash}.jpg`;

  if (existsSync(jpgPath)) {
    process.stdout.write(jpgPath);
    return;
  }

  mkdirSync(outDir, { recursive: true });

  prepareZXingModule({
    overrides: {
      wasmBinary: readFileSync(WASM_PATH).buffer as ArrayBuffer,
    },
  });

  const result = await writeBarcode(url, { format: 'QRCode', scale: 10, addQuietZones: false });
  if (!result.svg) process.exit(1);

  await Bun.write(svgPath, result.svg);

  const png = Bun.spawn(['magick', svgPath, '-density', '300', '-units', 'PixelsPerInch', pngPath]);
  if ((await png.exited) !== 0) process.exit(1);

  const jpg = Bun.spawn(['magick', pngPath, '-density', '300', '-units', 'PixelsPerInch', '-quality', '100', jpgPath]);
  if ((await jpg.exited) !== 0) process.exit(1);

  rmSync(pngPath, { force: true });
  rmSync(svgPath, { force: true });

  process.stdout.write(jpgPath);
}

await main();
