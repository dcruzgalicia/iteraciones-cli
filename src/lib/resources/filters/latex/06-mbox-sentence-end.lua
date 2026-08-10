-- Envuelve en \mbox{} la última palabra de cada oración (o las últimas 3 si
-- es la oración final del párrafo). Solo dentro de bloques Para.
-- Uso: pandoc --from markdown --to latex --lua-filter latex/06-mbox-sentence-end.lua

-- Helpers de oraciones compartidos con latex/07-mbox-sentence-start
-- (ver shared/mbox-helpers.lua; la ruta del script es absoluta en el pipeline).
local script_dir = PANDOC_SCRIPT_FILE:match('^(.*[\\/])')
package.path = package.path .. ';' .. script_dir .. '?.lua'
local mbox = require 'shared.mbox-helpers'

-- ── Procesamiento del párrafo ─────────────────────────────────────────────

local function is_space(inl)
  return inl.t == 'Space' or inl.t == 'SoftBreak'
end

local function process_para_inlines(inlines)
  if mbox.count_real_inlines(inlines) < 4 then return inlines end

  local sentence_bounds = mbox.find_sentence_bounds(inlines)
  local wraps = {}

  for _, sb in ipairs(sentence_bounds) do
    local word_indices = {}
    for i = sb.start, sb.finish - 1 do
      local c = mbox.classify(inlines[i])
      if c == 'word' or c == 'word-group' then
        table.insert(word_indices, i)
      end
    end

    local is_last_sentence = sb.finish == #inlines + 1
    local ideal_wrap_count = is_last_sentence and 3 or 1
    local min_words = is_last_sentence and 3 or 2

    if #word_indices >= min_words then
      -- No superar #word_indices - 1 (evita solapamiento con mbox-sentence-start)
      local wrap_count = math.min(ideal_wrap_count, #word_indices - 1)
      local first_idx = word_indices[#word_indices - wrap_count + 1]
      local last_idx = word_indices[#word_indices]
      table.insert(wraps, { start_idx = first_idx, finish_idx = last_idx })
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
      for j = wrap.start_idx, wrap.finish_idx do
        if j > wrap.start_idx and is_space(inlines[j]) then
          table.insert(result, pandoc.RawInline('latex', ' '))
        elseif not is_space(inlines[j]) then
          table.insert(result, inlines[j])
        end
      end
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
