local CJK_ENCODINGS = {
  japanese = 'min',
  chinese = 'gbsn',
  korean = 'ksc',
}

local function has_class(block, cls)
  if block.t ~= 'Div' then return false end
  for _, c in ipairs(block.classes) do
    if c == cls then return true end
  end
  return false
end

local function process_cjk(div, encoding)
  local result = { pandoc.RawBlock('latex', '\\begin{CJK}{UTF8}{' .. encoding .. '}') }
  for _, b in ipairs(div.content) do
    table.insert(result, b)
  end
  table.insert(result, pandoc.RawBlock('latex', '\\end{CJK}'))
  return result
end

function Pandoc(doc)
  local result = {}
  for _, block in ipairs(doc.blocks) do
    local encoding = nil
    if block.t == 'Div' then
      for _, cls in ipairs(block.classes) do
        if CJK_ENCODINGS[cls] ~= nil then
          encoding = CJK_ENCODINGS[cls]
          break
        end
      end
    end
    if encoding ~= nil then
      local expanded = process_cjk(block, encoding)
      for _, b in ipairs(expanded) do table.insert(result, b) end
    else
      table.insert(result, block)
    end
  end
  doc.blocks = result
  return doc
end
