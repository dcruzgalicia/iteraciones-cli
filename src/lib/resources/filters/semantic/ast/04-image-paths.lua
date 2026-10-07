local paths = nil

local function loadPaths()
  local file = os.getenv('ITERACIONES_PATHS_JSON')
  if file == nil or file == '' then return nil end
  if pandoc.json == nil or pandoc.json.decode == nil then
    error('semantic/ast/04-image-paths: requiere pandoc >= 3.1.1 (módulo pandoc.json)')
  end
  local handle = io.open(file, 'r')
  if handle == nil then
    error('semantic/ast/04-image-paths: no se pudo leer el mapa de rutas "' .. file .. '"')
  end
  local content = handle:read('*a')
  handle:close()
  return pandoc.json.decode(content)
end

paths = loadPaths()

local function mapped(src)
  if paths == nil then return nil end
  local dst = paths[src]
  if dst ~= nil and dst ~= src then return dst end
  return nil
end

local function escapePattern(text)
  return (text:gsub('%p', '%%%0'))
end

local function rewriteRawText(text)
  if paths == nil or not text:lower():find('src=', 1, true) then return text end
  for src, dst in pairs(paths) do
    if dst ~= src then
      text = text:gsub('([sS][rR][cC]=)(["\']?)' .. escapePattern(src) .. '(["\'])', function(open, quote, close)
        return open .. quote .. dst .. close
      end)
    end
  end
  return text
end

function Image(image)
  local dst = mapped(image.src)
  if dst ~= nil then image.src = dst end
  return image
end

function RawInline(element)
  element.text = rewriteRawText(element.text)
  return element
end

function RawBlock(element)
  element.text = rewriteRawText(element.text)
  return element
end

local function plainText(inlines)
  local parts = {}
  for _, inl in ipairs(inlines) do
    if inl.t == 'Str' then
      parts[#parts + 1] = inl.text
    elseif inl.t == 'Space' or inl.t == 'SoftBreak' or inl.t == 'LineBreak' then
      parts[#parts + 1] = ' '
    else
      return nil
    end
  end
  return table.concat(parts)
end

local function rewriteMeta(value)
  local kind = pandoc.utils.type(value)
  if kind == 'string' then
    return mapped(value) or value
  end
  if kind == 'Inlines' then
    local text = plainText(value)
    local dst = text ~= nil and mapped(text) or nil
    if dst ~= nil then return pandoc.Inlines{ pandoc.Str(dst) } end
    return value
  end
  if kind == 'Blocks' then
    if #value == 1 and (value[1].t == 'Para' or value[1].t == 'Plain') then
      local text = plainText(value[1].content)
      local dst = text ~= nil and mapped(text) or nil
      if dst ~= nil then value[1].content = pandoc.Inlines{ pandoc.Str(dst) } end
    end
    return value
  end
  if kind == 'table' or kind == 'List' then
    for key, item in pairs(value) do
      value[key] = rewriteMeta(item)
    end
    return value
  end
  return value
end

function Pandoc(doc)
  if paths == nil then return nil end
  for key, value in pairs(doc.meta) do
    doc.meta[key] = rewriteMeta(value)
  end
  return doc
end
