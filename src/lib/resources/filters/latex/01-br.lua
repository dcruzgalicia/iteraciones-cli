local function br_count(div)
  if div.t ~= 'Div' then return nil end
  local attrs = div.attributes
  if not attrs then return nil end
  local raw = attrs['br']
  if raw == nil then return nil end
  local n = tonumber(raw)
  if not n then return nil end
  n = math.floor(n)
  if n <= 0 then return nil end
  return n
end

local function transform_blocks(blocks)
  local out = {}
  local pending_noindent = false

  -- Recorre primero los contenedores anidados para que {br=N} funcione
  -- dentro de listas, blockquotes y divs sin handler especial.
  local function recurse(block)
    if block.t == 'Div' and block.content then
      block.content = transform_blocks(block.content)
    elseif block.t == 'BlockQuote' and block.content then
      block.content = transform_blocks(block.content)
    elseif (block.t == 'BulletList' or block.t == 'OrderedList') and block.content then
      for i, item in ipairs(block.content) do
        block.content[i] = transform_blocks(item)
      end
    end
  end

  for _, block in ipairs(blocks) do
    recurse(block)
    local n = (block.t == 'Div') and br_count(block) or nil
    if n then
      for i = 1, n do
        table.insert(out, pandoc.RawBlock('latex', '\\vspace{\\baselineskip}'))
      end
      pending_noindent = true
      -- El contenido del div se conserva: un fenced div puede llevar texto y
      -- tirarlo seria perderlo. El primer parrafo de ese contenido es el que
      -- recibe el noindent del salto.
      for _, child in ipairs(block.content or {}) do
        if pending_noindent and child.t == 'Para' then
          table.insert(child.content, 1, pandoc.RawInline('latex', '\\noindent '))
        end
        table.insert(out, child)
        pending_noindent = false
      end
    elseif pending_noindent and block.t == 'Para' then
      table.insert(block.content, 1, pandoc.RawInline('latex', '\\noindent '))
      table.insert(out, block)
      pending_noindent = false
    else
      table.insert(out, block)
      pending_noindent = false
    end
  end
  return out
end

function Pandoc(doc)
  doc.blocks = transform_blocks(doc.blocks)
  return doc
end