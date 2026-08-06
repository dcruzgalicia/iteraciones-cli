-- Envuelve en \mbox{} la primera palabra de cada oración. Solo dentro de
-- bloques Para. Corre después de mbox-sentence-end (evita mbox anidados).
-- Reemplaza al filter TS latex/07-mbox-sentence-start.
-- Uso: pandoc --from json --to latex --lua-filter latex/07-mbox-sentence-start.lua

-- ── Helpers de oraciones (equivalentes a _sentence-utils.ts) ──────────────

local ABBREVIATIONS = {
  ['dr.'] = true, ['dra.'] = true, ['lic.'] = true, ['ing.'] = true, ['mtro.'] = true,
  ['mtra.'] = true, ['prof.'] = true, ['sra.'] = true, ['sr.'] = true, ['srta.'] = true,
  ['sta.'] = true, ['vol.'] = true, ['pág.'] = true, ['p.'] = true, ['ej.'] = true,
  ['vs.'] = true, ['aprox.'] = true, ['ed.'] = true, ['trad.'] = true, ['coord.'] = true,
  ['cols.'] = true, ['no.'] = true, ['cap.'] = true, ['art.'] = true, ['sec.'] = true,
  ['fig.'] = true, ['tab.'] = true, ['etc.'] = true,
}

local function trim(s)
  return s:gsub('^%s*(.-)%s*$', '%1')
end

local function classify(inl)
  if inl.t == 'Str' then return 'word' end
  if inl.t == 'Space' or inl.t == 'SoftBreak' then return 'space' end
  if inl.t == 'Emph' or inl.t == 'Strong' or inl.t == 'Underline' or inl.t == 'Superscript' or
     inl.t == 'Subscript' or inl.t == 'SmallCaps' or inl.t == 'Span' or inl.t == 'Link' or inl.t == 'Cite' then
    return 'word-group'
  end
  return 'skip'
end

local function inline_text(inl)
  if inl.t == 'Str' then return inl.text end
  if inl.t == 'Space' or inl.t == 'SoftBreak' then return ' ' end
  if inl.t == 'Emph' or inl.t == 'Strong' or inl.t == 'Underline' or inl.t == 'Superscript' or
     inl.t == 'Subscript' or inl.t == 'SmallCaps' or inl.t == 'Span' then
    local parts = {}
    for _, c in ipairs(inl.content) do
      local t = inline_text(c)
      if t ~= nil then table.insert(parts, t) end
    end
    return table.concat(parts)
  end
  return nil
end

local function is_sentence_end_punct(text)
  if #text == 0 then return false end
  local last = text:sub(-1)
  return last == '.' or last == '!' or last == '?'
end

local function is_abbreviation(text)
  return ABBREVIATIONS[trim(text):lower()] == true
end

local function find_next_non_space(inlines, from_idx)
  for i = from_idx, #inlines do
    local c = classify(inlines[i])
    if c ~= 'space' and c ~= 'skip' then return i end
  end
  return -1
end

local function find_sentence_bounds(inlines)
  local bounds = {}
  local sent_start = 1
  local i = 1
  while i <= #inlines do
    local c = classify(inlines[i])
    if c ~= 'skip' then
      local text = inline_text(inlines[i])
      if text ~= nil and is_sentence_end_punct(text) and not is_abbreviation(text) then
        local next_idx = find_next_non_space(inlines, i + 1)
        if next_idx ~= -1 then
          local next_text = inline_text(inlines[next_idx])
          if next_text ~= nil and trim(next_text):match('^[A-ZÁÉÍÓÚÜÑ¿¡]') then
            table.insert(bounds, { start = sent_start, finish = i + 1 })
            sent_start = next_idx
            i = next_idx - 1
          end
        else
          table.insert(bounds, { start = sent_start, finish = #inlines + 1 })
        end
      end
    end
    i = i + 1
  end
  if #bounds == 0 then
    table.insert(bounds, { start = 1, finish = #inlines + 1 })
  end
  return bounds
end

-- ── Procesamiento del párrafo ─────────────────────────────────────────────

local function process_para_inlines(inlines)
  if #inlines < 4 then return inlines end

  local sentence_bounds = find_sentence_bounds(inlines)
  local wraps = {}

  for _, sb in ipairs(sentence_bounds) do
    local word_indices = {}
    for i = sb.start, sb.finish - 1 do
      local c = classify(inlines[i])
      if c == 'word' or c == 'word-group' then
        table.insert(word_indices, i)
      end
    end

    if #word_indices >= 2 then
      local first_idx = word_indices[1]
      table.insert(wraps, { start_idx = first_idx, finish_idx = first_idx })
    end
  end

  if #wraps == 0 then return inlines end

  local result = {}
  local i = 1
  while i <= #inlines do
    local wrap = nil
    for _, w in ipairs(wraps) do
      if w.start_idx == i then
        wrap = w
        break
      end
    end
    if wrap ~= nil then
      table.insert(result, pandoc.RawInline('latex', '\\mbox{'))
      table.insert(result, inlines[i])
      table.insert(result, pandoc.RawInline('latex', '}'))
      i = wrap.finish_idx + 1
    else
      table.insert(result, inlines[i])
      i = i + 1
    end
  end

  return result
end

function Pandoc(doc)
  local blocks = {}
  for _, block in ipairs(doc.blocks) do
    if block.t == 'Para' then
      block.content = process_para_inlines(block.content)
    end
    table.insert(blocks, block)
  end
  doc.blocks = blocks
  return doc
end
