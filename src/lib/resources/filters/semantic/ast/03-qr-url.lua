local function script_path()
  local info = debug.getinfo(1, 'S')
  local path = info.source:match('^@(.*)')
  if not path then return nil end
  return path:match('^(.*)/')
end

local FILTER_DIR = script_path()
local QRCODE_SCRIPT = FILTER_DIR and (FILTER_DIR .. '/../../../../qr-gen.ts') or nil

function Div(div)
  local qr_value = div.attributes.qr
  if qr_value == nil then return nil end

  local para = nil
  for _, b in ipairs(div.content) do
    if b.t == 'Para' then para = b; break end
  end
  if not para then return nil end

  local url = ''
  for _, inl in ipairs(para.content) do
    if inl.t == 'Str' then
      url = url .. inl.text
    elseif inl.t == 'Space' then
      url = url .. ' '
    end
  end
  if url == '' then return nil end

  local width = nil
  if qr_value == '' then
    width = '3cm'
  elseif qr_value:match('^[%d.]+[a-z]+$') then
    width = qr_value
  end

  local project_root = os.getenv('ITERACIONES_PROJECT_ROOT')
  if not project_root or project_root == '' then return nil end

  local outDir = project_root .. '/.iteraciones/processed-images'

  local ok, out = pcall(pandoc.pipe, 'bun', { 'run', QRCODE_SCRIPT, outDir }, url)
  if not ok or type(out) ~= 'string' then return nil end
  local jpgPath = out:gsub('%s+$', '')
  if jpgPath == '' or not jpgPath:match('%.jpg$') then return nil end

  local img = pandoc.Image('', jpgPath)
  img.attr = pandoc.Attr('', {}, width and { { 'width', width } } or {})
  return pandoc.Para({ img })
end
