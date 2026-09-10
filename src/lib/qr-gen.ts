import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { prepareZXingModule, writeBarcode } from 'zxing-wasm/writer';

const WASM_PATH = new URL('../../node_modules/zxing-wasm/dist/writer/zxing_writer.wasm', import.meta.url);

prepareZXingModule({
  overrides: {
    wasmBinary: readFileSync(WASM_PATH).buffer as ArrayBuffer,
  },
});

const url = (await Bun.stdin.text()).trim();
if (!url) process.exit(1);

const hash = createHash('md5').update(url).digest('hex');
const svgPath = `/tmp/qr-${hash}.svg`;
const pngPath = `/tmp/qr-${hash}.png`;

const result = await writeBarcode(url, { format: 'QRCode', scale: 10 });
if (!result.svg) process.exit(1);

await Bun.write(svgPath, result.svg);

const proc = Bun.spawn(['magick', svgPath, '-density', '300', '-units', 'PixelsPerInch', pngPath]);
if ((await proc.exited) !== 0) process.exit(1);

process.stdout.write(pngPath);
