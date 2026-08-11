-- Envuelve en \mbox{} la última palabra de cada oración (o las últimas 2 si
-- es la oración final del párrafo). Solo dentro de bloques Para.
-- El conteo usa palabras REALES: un grupo de énfasis (\emph{...}) aporta sus
-- palabras internas individualmente. Regla del wrap final (últimas 2):
--   A. sin énfasis      → \mbox{ejemplo final.}
--   B. dentro del grupo → \emph{...en \mbox{carne propia.}} (wrap interno)
--   C. toca el inicio   → en \mbox{\emph{carne propia.}} (grupo completo)
--   D. grupo de 1       → \mbox{dice \emph{ella.}} (extiende hacia atrás)
-- Uso: pandoc --from markdown --to latex --lua-filter latex/06-mbox-sentence-end.lua

-- Helpers de oraciones compartidos con latex/07-mbox-sentence-start
-- (ver shared/mbox-helpers.lua). El pipeline inyecta la ruta absoluta del
-- helper como ITERACIONES_MBOX_HELPERS (env): el require relativo a
-- PANDOC_SCRIPT_FILE fallaría si el proyecto sobrescribe este filter (el
-- script apuntaría al proyecto, donde no hay shared/). El require se
-- conserva como fallback para la ejecución suelta (tests).
local mbox
local helpers_path = os.getenv('ITERACIONES_MBOX_HELPERS')
if helpers_path and helpers_path ~= '' then
  mbox = dofile(helpers_path)
else
  local script_dir = PANDOC_SCRIPT_FILE:match('^(.*[\\/])')
  package.path = package.path .. ';' .. script_dir .. '?.lua'
  mbox = require 'shared.mbox-helpers'
end

-- ── Procesamiento del párrafo ─────────────────────────────────────────────

local function is_space(inl)
  return inl.t == 'Space' or inl.t == 'SoftBreak'
end

-- Inserta \mbox{...} dentro del grupo alrededor de las palabras internas
-- [from_inner, to_inner] (las últimas 2 palabras reales de la oración).
-- Recorre las palabras en el mismo orden que mbox.group_word_count, de modo
-- que las posiciones internas coinciden incluso con grupos anidados.
local function wrap_group_internally(inl, from_inner, to_inner)
  local inner_word = 0
  local function walk(content)
    local new_content = {}
    for _, c in ipairs(content) do
      local cls = mbox.classify(c)
      if cls == 'word' then
        inner_word = inner_word + 1
        if inner_word == from_inner then
          table.insert(new_content, pandoc.RawInline('latex', '\\mbox{'))
        end
        table.insert(new_content, c)
        if inner_word == to_inner then
          table.insert(new_content, pandoc.RawInline('latex', '}'))
        end
      elseif cls == 'word-group' then
        c.content = walk(c.content)
        table.insert(new_content, c)
      else
        table.insert(new_content, c)
      end
    end
    return new_content
  end
  inl.content = walk(inl.content)
  return inl
end

-- Unidades virtuales de la oración final: cada palabra real es una unidad.
-- Un Str es 1 unidad; un grupo aporta group_word_count unidades (con su
-- posición interna, para el wrap interno).
local function expand_units(inlines, from_idx, to_idx)
  local units = {}
  for i = from_idx, to_idx - 1 do
    local c = mbox.classify(inlines[i])
    if c == 'word' then
      table.insert(units, { idx = i, inner = nil })
    elseif c == 'word-group' then
      local total = mbox.group_word_count(inlines[i])
      for k = 1, total do
        table.insert(units, { idx = i, inner = k, inner_total = total })
      end
    end
  end
  return units
end

local function process_para_inlines(inlines)
  if mbox.count_real_inlines(inlines) < 4 then return inlines end

  local sentence_bounds = mbox.find_sentence_bounds(inlines)
  local wraps = {}

  for _, sb in ipairs(sentence_bounds) do
    local is_last_sentence = sb.finish == #inlines + 1

    if is_last_sentence then
      -- Oración final: últimas 2 palabras REALES (conteo expandido).
      -- Si la última unidad es un grupo de >= 2 palabras, las últimas 2 caen
      -- dentro del grupo (u1.idx == u2.idx); el caso "cruza el inicio" solo
      -- ocurre con un grupo de 1 palabra al final.
      local units = expand_units(inlines, sb.start, sb.finish)
      if #units >= 2 then
        local wrap_count = math.min(2, #units - 1)
        local u1 = units[#units - wrap_count + 1]
        local u2 = units[#units]
        if u1.idx == u2.idx then
          if u1.inner == 1 then
            -- Toca el inicio del grupo (caso C): envolver el grupo completo
            table.insert(wraps, { start_idx = u1.idx, finish_idx = u1.idx })
          else
            -- Wrap interno dentro del grupo (caso B)
            table.insert(wraps, { start_idx = u1.idx, finish_idx = u1.idx, inner_from = u1.inner, inner_to = u2.inner })
          end
        elseif u2.inner ~= nil then
          -- Grupo de 1 palabra al final (caso D): extender hacia atrás
          table.insert(wraps, { start_idx = u1.idx, finish_idx = u2.idx })
        else
          -- Sin grupos (caso A): wrap normal
          table.insert(wraps, { start_idx = u1.idx, finish_idx = u2.idx })
        end
      end
    else
      -- Oraciones no finales: última unidad, mínimo 2 (comportamiento previo)
      local word_indices = {}
      for i = sb.start, sb.finish - 1 do
        local c = mbox.classify(inlines[i])
        if c == 'word' or c == 'word-group' then
          table.insert(word_indices, i)
        end
      end
      if #word_indices >= 2 then
        local last_idx = word_indices[#word_indices]
        table.insert(wraps, { start_idx = last_idx, finish_idx = last_idx })
      end
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
      if wrap.inner_from ~= nil then
        table.insert(result, wrap_group_internally(inlines[i], wrap.inner_from, wrap.inner_to))
      else
        table.insert(result, pandoc.RawInline('latex', '\\mbox{'))
        for j = wrap.start_idx, wrap.finish_idx do
          if j > wrap.start_idx and is_space(inlines[j]) then
            table.insert(result, pandoc.RawInline('latex', ' '))
          elseif not is_space(inlines[j]) then
            table.insert(result, inlines[j])
          end
        end
        table.insert(result, pandoc.RawInline('latex', '}'))
      end
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
