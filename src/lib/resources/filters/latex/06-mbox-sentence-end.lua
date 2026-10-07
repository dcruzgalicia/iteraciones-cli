local mbox
local helpers_path = os.getenv('ITERACIONES_MBOX_HELPERS')
if helpers_path and helpers_path ~= '' then
  mbox = dofile(helpers_path)
else
  local script_dir = PANDOC_SCRIPT_FILE:match('^(.*[\\/])')
  package.path = package.path .. ';' .. script_dir .. '?.lua'
  mbox = require 'shared.mbox-helpers'
end

local function is_space(inl)
  return inl.t == 'Space' or inl.t == 'SoftBreak'
end

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

local function expand_units(inlines, from_idx, to_idx)
  local units = {}
  local trailing_punct = nil
  for i = from_idx, to_idx - 1 do
    local c = mbox.classify(inlines[i])
    if c == 'word' then
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

local function build_wrap(units, trailing_punct)
  if #units < 3 then return nil end
  local uc = math.min(3, #units - 1)
  local u1 = units[#units - uc + 1]
  local u2 = units[#units]
  local wrap
  if u1.idx == u2.idx then
    if u1.inner == 1 then
      wrap = { start_idx = u1.idx, finish_idx = u1.idx }
    else
      wrap = { start_idx = u1.idx, finish_idx = u1.idx, inner_from = u1.inner, inner_to = u2.inner }
    end
  elseif u2.inner ~= nil then
    wrap = { start_idx = u1.idx, finish_idx = u2.idx }
  else
    wrap = { start_idx = u1.idx, finish_idx = u2.idx }
  end
  if wrap.inner_from == nil and trailing_punct ~= nil and wrap.finish_idx <= trailing_punct then
    wrap.finish_idx = trailing_punct
  end
  return wrap
end

local function process_para_inlines(inlines)
  if mbox.count_real_inlines(inlines) < 5 then return inlines end

  local has_nombox = false
  for _, inl in ipairs(inlines) do
    if inl.t == 'Span' and inl.classes:find('no-mbox', 1, true) then
      has_nombox = true
      break
    end
  end
  if has_nombox then
    local result = {}
    for _, inl in ipairs(inlines) do
      if inl.t == 'Span' and inl.classes:find('no-mbox', 1, true) then
        for _, c in ipairs(inl.content) do
          table.insert(result, c)
        end
      else
        table.insert(result, inl)
      end
    end
    return result
  end

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

local function process_blocks(blocks)
  for i, block in ipairs(blocks) do
    if block.t == 'Para' then
      blocks[i].content = process_para_inlines(block.content)
    elseif block.t == 'Div' or block.t == 'BlockQuote' then
      process_blocks(block.content)
    end
  end
  return blocks
end

function Pandoc(doc)
  process_blocks(doc.blocks)
  return doc
end
