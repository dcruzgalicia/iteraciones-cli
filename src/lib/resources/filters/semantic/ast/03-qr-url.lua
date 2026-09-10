-- Genera código QR como imagen JPG 300dpi a partir de [url]{.qr width="Xcm"}.
-- Imagen generada en dist/qr/ del proyecto (content-addressed por hash MD5 de la URL).
-- Requiere: zxing-wasm (bun add zxing-wasm) y ImageMagick (magick).
-- Uso: pandoc --from markdown --to json --lua-filter semantic/ast/03-qr-url.lua

local function script_path()
  local info = debug.getinfo(1, 'S')
  local path = info.source:match('^@(.*)')
  if not path then return nil end
  return path:match('^(.*)/')
end

local FILTER_DIR = script_path()
local QRCODE_SCRIPT = FILTER_DIR and (FILTER_DIR .. '/../../../../qr-gen.ts') or nil

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

  local outDir = project_root .. '/dist/files'

  local handle = io.popen('echo ' .. url .. ' | bun run ' .. QRCODE_SCRIPT .. ' ' .. outDir)
  local pngPath = handle:read('*a')
  handle:close()
  pngPath = pngPath:gsub('%s+$', '')
  if pngPath == '' or not pngPath:match('%.png$') then return nil end

  local jpgPath = pngPath:gsub('%.png$', '.jpg')
  os.execute('magick "' .. pngPath .. '" -density 300 -units PixelsPerInch -quality 100 "' .. jpgPath .. '"')
  os.execute('rm -f "' .. pngPath .. '" "' .. pngPath:gsub('%.png$', '.svg') .. '"')

  local jpgName = jpgPath:match('([^/]+)$')
  local img = pandoc.Image('', jpgName)
  img.attr = pandoc.Attr('', {}, { { 'width', width } })
  return img
end
