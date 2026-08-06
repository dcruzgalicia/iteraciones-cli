-- Convierte Div.dictum a \dictum[author]{quote} (formato LaTeX), con espacio
-- superior e inferior configurables (beforeskip/afterskip) y \noindent al
-- párrafo siguiente si es Para.
-- Reemplaza al filter TS latex/02-dictum.
-- Uso: pandoc --from json --to latex --lua-filter latex/02-dictum.lua

local BS = '\1' -- placeholder para el backslash (evita re-escapar \textbackslash{})

local function escape_latex(s)
  s = s:gsub('\\', BS)
  s = s:gsub('{', '\\{')
  s = s:gsub('}', '\\}')
  s = s:gsub('%$', '\\$')
  s = s:gsub('&', '\\&')
  s = s:gsub('#', '\\#')
  s = s:gsub('%^', '\\textasciicircum{}')
  s = s:gsub('_', '\\_')
  s = s:gsub('~', '\\textasciitilde{}')
  s = s:gsub('%%', '\\%')
  s = s:gsub(BS, '\\textbackslash{}')
  return s
end

local function inlines_to_latex(inlines)
  local out = {}
  for _, inl in ipairs(inlines) do
    if inl.t == 'Str' then
      table.insert(out, escape_latex(inl.text))
    elseif inl.t == 'Space' or inl.t == 'SoftBreak' then
      table.insert(out, ' ')
    elseif inl.t == 'LineBreak' then
      table.insert(out, '\\\\')
    elseif inl.t == 'Emph' then
      table.insert(out, '\\emph{' .. inlines_to_latex(inl.content) .. '}')
    elseif inl.t == 'Strong' then
      table.insert(out, '\\textbf{' .. inlines_to_latex(inl.content) .. '}')
    elseif inl.t == 'RawInline' and inl.format == 'latex' then
      table.insert(out, inl.text)
    end
  end
  return table.concat(out)
end

local function has_class(block, cls)
  if block.t ~= 'Div' then return false end
  for _, c in ipairs(block.classes) do
    if c == cls then return true end
  end
  return false
end

local function process_dictum(div)
  local beforeskip = div.attributes['beforeskip'] or ''
  local afterskip = div.attributes['afterskip'] or '2\\baselineskip'

  local quote_blocks = {}
  local author_latex = ''
  for _, block in ipairs(div.content) do
    if has_class(block, 'author') then
      local all_paras = true
      local inlines = {}
      for _, b in ipairs(block.content) do
        if b.t == 'Para' then
          for _, inl in ipairs(b.content) do table.insert(inlines, inl) end
        else
          all_paras = false
        end
      end
      if all_paras and #inlines > 0 then
        author_latex = inlines_to_latex(inlines)
      else
        -- autor con estructura compleja: se conserva dentro de la cita
        table.insert(quote_blocks, block)
      end
    else
      table.insert(quote_blocks, block)
    end
  end

  -- Apertura: vspace antes solo si beforeskip está definido
  local opening = ''
  if beforeskip ~= '' then
    opening = '\\vspace*{' .. beforeskip .. '}'
  end
  opening = opening .. '\\dictum'
  if author_latex ~= '' then
    opening = opening .. '[' .. author_latex .. ']'
  end
  opening = opening .. '{'
  local closing = '}\\vspace*{' .. afterskip .. '}'

  -- Sin contenido: solo los RawBlocks
  if #quote_blocks == 0 then
    return {
      pandoc.RawBlock('latex', opening),
      pandoc.RawBlock('latex', closing),
    }
  end

  -- Mismo orden de RawInline/RawBlock que el filter TS
  local result = {}
  for i, block in ipairs(quote_blocks) do
    local is_first = i == 1
    local is_last = i == #quote_blocks
    if block.t == 'Para' then
      if is_first then table.insert(block.content, 1, pandoc.RawInline('latex', opening)) end
      if is_last then table.insert(block.content, pandoc.RawInline('latex', closing)) end
      table.insert(result, block)
    elseif is_first and is_last then
      table.insert(result, block)
      table.insert(result, pandoc.RawBlock('latex', opening))
      table.insert(result, pandoc.RawBlock('latex', closing))
    elseif is_first then
      table.insert(result, block)
      table.insert(result, pandoc.RawBlock('latex', opening))
    elseif is_last then
      table.insert(result, block)
      table.insert(result, pandoc.RawBlock('latex', closing))
    else
      table.insert(result, block)
    end
  end
  return result
end

-- Filtro Pandoc: equivalente al loop de transform() del TS (solo nivel
-- superior, con last_was_dictum para el \noindent del párrafo siguiente)
function Pandoc(doc)
  local result = {}
  local last_was_dictum = false
  for _, block in ipairs(doc.blocks) do
    if has_class(block, 'dictum') then
      local expanded = process_dictum(block)
      for _, b in ipairs(expanded) do table.insert(result, b) end
      last_was_dictum = true
    elseif last_was_dictum and block.t == 'Para' then
      table.insert(block.content, 1, pandoc.RawInline('latex', '\\noindent '))
      table.insert(result, block)
      last_was_dictum = false
    else
      table.insert(result, block)
      last_was_dictum = false
    end
  end
  doc.blocks = result
  return doc
end
