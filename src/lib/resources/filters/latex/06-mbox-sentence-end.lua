-- Envuelve en \mbox{} las últimas 2 palabras de la oración final del
-- párrafo (únicas palabras que reciben mbox: sin mbox por oración no final
-- ni de inicio de oración). Solo dentro de bloques Para.
-- El conteo usa palabras REALES: un grupo de énfasis (\emph{...}) aporta sus
-- palabras internas individualmente. Regla del wrap (últimas 2):
--   A. sin énfasis      → \mbox{ejemplo final.}
--   B. dentro del grupo → \emph{...en \mbox{carne propia.}} (wrap interno)
--   C. toca el inicio   → en \mbox{\emph{carne propia.}} (grupo completo)
--   D. grupo de 1       → \mbox{dice \emph{ella.}} (extiende hacia atrás)
-- Uso: pandoc --from markdown --to latex --lua-filter latex/06-mbox-sentence-end.lua

-- Helpers de oraciones (ver shared/mbox-helpers.lua). El pipeline inyecta la
-- ruta absoluta del helper como ITERACIONES_MBOX_HELPERS (env): el require
-- relativo a PANDOC_SCRIPT_FILE fallaría si el proyecto sobrescribe este
-- filter (el script apuntaría al proyecto, donde no hay shared/). El require
-- se conserva como fallback para la ejecución suelta (tests).
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
-- posición interna, para el wrap interno). La puntuación suelta (Str de solo
-- puntuación, p. ej. "." tras "descansa". o **propia**.) no es una palabra:
-- se omite del conteo y, si está al final de la oración, se recuerda como
-- trailing_punct para adjuntarla al wrap normal.
local function expand_units(inlines, from_idx, to_idx)
  local units = {}
  local trailing_punct = nil
  for i = from_idx, to_idx - 1 do
    local c = mbox.classify(inlines[i])
    if c == 'word' then
      -- Un Span.uppercase es 'word' pero no tiene .text (no es puntuación)
      local text = inlines[i].text
      if text ~= nil and mbox.is_punct_str(text) then
        trailing_punct = i
      else
        table.insert(units, { idx = i, inner = nil })
      end
    elseif c == 'word-group' then
      local total = mbox.group_word_count(inlines[i])
      for k = 1, total do
        table.insert(units, { idx = i, inner = k, inner_total = total })
      end
    end
  end
  return units, trailing_punct
end

-- Calcula el wrap del mbox: las últimas 2 palabras REALES (conteo expandido)
-- de la oración final del párrafo. Reglas:
--   A. sin grupos            → wrap normal de las últimas 2 unidades
--   B. dentro del grupo      → wrap interno (inner_from/inner_to)
--   C. toca el inicio        → grupo completo desde su inicio
--   D. grupo de 1 palabra    → extiende hacia atrás
-- La puntuación final suelta (trailing) acompaña al wrap normal.
local function build_wrap(units, trailing_punct)
  if #units < 2 then return nil end
  -- No superar #units - 1: una oración de exactamente 2 palabras no se
  -- envuelve completa (se conserva la protección histórica ante solapes).
  local uc = math.min(2, #units - 1)
  local u1 = units[#units - uc + 1]
  local u2 = units[#units]
  local wrap
  if u1.idx == u2.idx then
    if u1.inner == 1 then
      -- Toca el inicio del grupo (caso C): envolver el grupo completo
      wrap = { start_idx = u1.idx, finish_idx = u1.idx }
    else
      -- Wrap interno dentro del grupo (caso B): la puntuación externa
      -- al grupo (trailing) queda fuera del mbox (limitación del AST)
      wrap = { start_idx = u1.idx, finish_idx = u1.idx, inner_from = u1.inner, inner_to = u2.inner }
    end
  elseif u2.inner ~= nil then
    -- Grupo de 1 palabra al final (caso D): extender hacia atrás
    wrap = { start_idx = u1.idx, finish_idx = u2.idx }
  else
    -- Sin grupos (caso A): wrap normal
    wrap = { start_idx = u1.idx, finish_idx = u2.idx }
  end
  -- La puntuación final suelta (p. ej. "." tras **propia**.) acompaña
  -- al wrap normal: sin ella, el mbox terminaría antes del punto.
  if wrap.inner_from == nil and trailing_punct ~= nil and wrap.finish_idx <= trailing_punct then
    wrap.finish_idx = trailing_punct
  end
  return wrap
end

local function process_para_inlines(inlines)
  if mbox.count_real_inlines(inlines) < 4 then return inlines end

  -- Solo la oración final del párrafo recibe mbox (las últimas 2 palabras
  -- reales). Las oraciones no finales quedan intactas.
  local sentence_bounds = mbox.find_sentence_bounds(inlines)
  local wraps = {}

  for _, sb in ipairs(sentence_bounds) do
    if sb.finish == #inlines + 1 then
      local units, trailing_punct = expand_units(inlines, sb.start, sb.finish)
      local wrap = build_wrap(units, trailing_punct)
      if wrap ~= nil then
        table.insert(wraps, wrap)
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
