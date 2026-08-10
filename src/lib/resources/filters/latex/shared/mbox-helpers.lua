-- Helpers compartidos por latex/06-mbox-sentence-end y latex/07-mbox-sentence-start
-- (detección de oraciones, abreviaturas y conteo de inlines reales). No es un
-- filter: no define handlers de pandoc y no aparece en `iteraciones filters`.
-- Se carga con `require 'shared.mbox-helpers'` desde los filtros 06/07; ambos
-- resuelven el directorio del propio script con PANDOC_SCRIPT_FILE.

local M = {}

local ABBREVIATIONS = {
  ['dr.'] = true, ['dra.'] = true, ['lic.'] = true, ['ing.'] = true, ['mtro.'] = true,
  ['mtra.'] = true, ['prof.'] = true, ['sra.'] = true, ['sr.'] = true, ['srta.'] = true,
  ['sta.'] = true, ['vol.'] = true, ['pág.'] = true, ['p.'] = true, ['ej.'] = true,
  ['vs.'] = true, ['aprox.'] = true, ['ed.'] = true, ['trad.'] = true, ['coord.'] = true,
  ['cols.'] = true, ['no.'] = true, ['cap.'] = true, ['art.'] = true, ['sec.'] = true,
  ['fig.'] = true, ['tab.'] = true, ['etc.'] = true,
}

function M.trim(s)
  return s:gsub('^%s*(.-)%s*$', '%1')
end

function M.classify(inl)
  if inl.t == 'Str' then return 'word' end
  if inl.t == 'Space' or inl.t == 'SoftBreak' then return 'space' end
  if inl.t == 'Emph' or inl.t == 'Strong' or inl.t == 'Underline' or inl.t == 'Superscript' or
     inl.t == 'Subscript' or inl.t == 'SmallCaps' or inl.t == 'Span' or inl.t == 'Link' or inl.t == 'Cite' then
    return 'word-group'
  end
  return 'skip'
end

function M.inline_text(inl)
  if inl.t == 'Str' then return inl.text end
  if inl.t == 'Space' or inl.t == 'SoftBreak' then return ' ' end
  if inl.t == 'Emph' or inl.t == 'Strong' or inl.t == 'Underline' or inl.t == 'Superscript' or
     inl.t == 'Subscript' or inl.t == 'SmallCaps' or inl.t == 'Span' then
    local parts = {}
    for _, c in ipairs(inl.content) do
      local t = M.inline_text(c)
      if t ~= nil then table.insert(parts, t) end
    end
    return table.concat(parts)
  end
  return nil
end

function M.is_sentence_end_punct(text)
  if #text == 0 then return false end
  local last = text:sub(-1)
  return last == '.' or last == '!' or last == '?'
end

function M.is_abbreviation(text)
  return ABBREVIATIONS[M.trim(text):lower()] == true
end

function M.find_next_non_space(inlines, from_idx)
  for i = from_idx, #inlines do
    local c = M.classify(inlines[i])
    if c ~= 'space' and c ~= 'skip' then return i end
  end
  return -1
end

function M.find_sentence_bounds(inlines)
  local bounds = {}
  local sent_start = 1
  local i = 1
  while i <= #inlines do
    local c = M.classify(inlines[i])
    if c ~= 'skip' then
      local text = M.inline_text(inlines[i])
      if text ~= nil and M.is_sentence_end_punct(text) and not M.is_abbreviation(text) then
        local next_idx = M.find_next_non_space(inlines, i + 1)
        if next_idx ~= -1 then
          local next_text = M.inline_text(inlines[next_idx])
          if next_text ~= nil and M.trim(next_text):match('^[A-ZÁÉÍÓÚÜÑ¿¡]') then
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

-- Cuenta solo los inlines "reales" (palabras, grupos, espacios): los RawInline
-- (p. ej. el \noindent que inyecta el filtro internal/flags o latex/02-dictum)
-- no son palabras y no deben mover el umbral de 4.
function M.count_real_inlines(inlines)
  local n = 0
  for _, inl in ipairs(inlines) do
    if M.classify(inl) ~= 'skip' then n = n + 1 end
  end
  return n
end

return M
