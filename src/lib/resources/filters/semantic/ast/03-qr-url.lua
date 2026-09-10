-- Genera código QR como imagen JPG 300dpi a partir de [url]{.qr width="Xcm"}.
-- Imagen generada en dist/qr/ del proyecto (content-addressed por hash MD5 de la URL).
-- Requiere: zxing-wasm (bun add zxing-wasm) y ImageMagick (magick).
-- Uso: pandoc --from markdown --to json --lua-filter semantic/ast/03-qr-url.lua

local QRCODE_SCRIPT = 'src/lib/qr-gen.ts'

function Span(span)
  local has_qr = false
  for _, c in ipairs(span.classes) do
    if c == 'qr' then
      has_qr = true
      break
    end
  end
  if not has_qr then return nil end

  local url = ''
  for _, inl in ipairs(span.content) do
    if inl.t == 'Str' then
      url = url .. inl.text
    elseif inl.t == 'Space' then
      url = url .. ' '
    end
  end
  if url == '' then return nil end

  local width = span.attributes.width or '3cm'

  local project_root = os.getenv('ITERACIONES_PROJECT_ROOT')
  if not project_root or project_root == '' then return nil end

  local outDir = project_root .. '/dist/qr'

  local handle = io.popen('echo ' .. url .. ' | bun run ' .. QRCODE_SCRIPT .. ' ' .. outDir)
  local pngPath = handle:read('*a')
  handle:close()
  pngPath = pngPath:gsub('%s+$', '')
  if pngPath == '' or not pngPath:match('%.png$') then return nil end

  local jpgPath = pngPath:gsub('%.png$', '.jpg')
  os.execute('magick "' .. pngPath .. '" -density 300 -units PixelsPerInch -quality 100 "' .. jpgPath .. '"')

  local img = pandoc.Image('', jpgPath)
  img.attr = pandoc.Attr('', {}, { { 'width', width } })
  return img
end
