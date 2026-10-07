local M = {}

local ABBREVIATIONS = {
  ['dr.'] = true, ['dra.'] = true, ['lic.'] = true, ['ing.'] = true, ['mtro.'] = true,
  ['mtra.'] = true, ['prof.'] = true, ['sra.'] = true, ['sr.'] = true, ['srta.'] = true,
  ['sta.'] = true, ['vol.'] = true, ['pág.'] = true, ['p.'] = true, ['ej.'] = true,
  ['vs.'] = true, ['aprox.'] = true, ['ed.'] = true, ['trad.'] = true, ['coord.'] = true,
  ['cols.'] = true, ['no.'] = true, ['cap.'] = true, ['art.'] = true, ['sec.'] = true,
  ['fig.'] = true, ['tab.'] = true, ['etc.'] = true,
  ['ene.'] = true, ['feb.'] = true, ['mar.'] = true, ['abr.'] = true, ['may.'] = true,
  ['jun.'] = true, ['jul.'] = true, ['ago.'] = true, ['sep.'] = true, ['sept.'] = true,
  ['oct.'] = true, ['nov.'] = true, ['dic.'] = true,
  ['núm.'] = true, ['nro.'] = true, ['apdo.'] = true, ['p.ej.'] = true,
}

function M.trim(s)
  return s:gsub('^%s*(.-)%s*$', '%1')
end

function M.classify(inl)
  if inl.t == 'Str' then return 'word' end
  if inl.t == 'Space' or inl.t == 'SoftBreak' then return 'space' end
  if inl.t == 'Span' and inl.classes:find('uppercase', 1, true) then return 'word' end
  if inl.t == 'Emph' or inl.t == 'Strong' or inl.t == 'Underline' or inl.t == 'Superscript' or
     inl.t == 'Subscript' or inl.t == 'SmallCaps' or inl.t == 'Span' or inl.t == 'Link' or inl.t == 'Cite' or
     inl.t == 'Quoted' or inl.t == 'Mark' or inl.t == 'Strikeout' then
    return 'word-group'
  end
  return 'skip'
end

function M.inline_text(inl)
  if inl.t == 'Str' then return inl.text end
  if inl.t == 'Space' or inl.t == 'SoftBreak' then return ' ' end
  if inl.t == 'Emph' or inl.t == 'Strong' or inl.t == 'Underline' or inl.t == 'Superscript' or
     inl.t == 'Subscript' or inl.t == 'SmallCaps' or inl.t == 'Span' or inl.t == 'Quoted' or
     inl.t == 'Mark' or inl.t == 'Strikeout' then
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
  local trimmed = text:gsub('[%s\u{00A0}]+$', '')
  if #trimmed == 0 then return false end
  local last = trimmed:sub(-1)
  return last == '.' or last == '!' or last == '?' or last == ':'
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

function M.count_real_inlines(inlines)
  local n = 0
  for _, inl in ipairs(inlines) do
    if M.classify(inl) ~= 'skip' then n = n + 1 end
  end
  return n
end

function M.group_word_count(inl)
  local n = 0
  for _, c in ipairs(inl.content) do
    local cls = M.classify(c)
    if cls == 'word' then
      n = n + 1
    elseif cls == 'word-group' then
      n = n + M.group_word_count(c)
    end
  end
  return n
end

function M.is_punct_str(text)
  return #text > 0 and text:match('^%p+$') ~= nil
end

return M
