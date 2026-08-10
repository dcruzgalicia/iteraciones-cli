-- Envuelve en \mbox{} la primera palabra de cada oración. Solo dentro de
-- bloques Para. Corre después de mbox-sentence-end (evita mbox anidados).
-- Uso: pandoc --from markdown --to latex --lua-filter latex/07-mbox-sentence-start.lua

-- Helpers de oraciones compartidos con latex/06-mbox-sentence-end
-- (ver shared/mbox-helpers.lua; la ruta del script es absoluta en el pipeline).
local script_dir = PANDOC_SCRIPT_FILE:match('^(.*[\\/])')
package.path = package.path .. ';' .. script_dir .. '?.lua'
local mbox = require 'shared.mbox-helpers'

-- ── Procesamiento del párrafo ─────────────────────────────────────────────

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
