-- Genera código QR como imagen JPG 300dpi a partir de [url]{.qr width="Xcm"}.
-- Imagen generada en .iteraciones/processed-images/ del proyecto (content-addressed por hash MD5).
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

  local outDir = project_root .. '/.iteraciones/processed-images'

  -- #2457: la URL va por stdin con pandoc.pipe, sin shell y sin quoting. Con
  -- `io.popen('echo ' .. url .. ' | …')` un `&` en la URL partía la línea y el
  -- QR desaparecía en silencio. El script cachea por URL y devuelve el .jpg ya
  -- hecho (si la caché está, sin tocar wasm ni magick).
  local ok, out = pcall(pandoc.pipe, 'bun', { 'run', QRCODE_SCRIPT, outDir }, url)
  if not ok or type(out) ~= 'string' then return nil end
  local jpgPath = out:gsub('%s+$', '')
  if jpgPath == '' or not jpgPath:match('%.jpg$') then return nil end

  local img = pandoc.Image('', jpgPath)
  img.attr = pandoc.Attr('', {}, { { 'width', width } })
  return img
end
