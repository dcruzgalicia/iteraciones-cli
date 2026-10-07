local FIELDS = {
  'titlehead',
  'subject',
  'subtitle',
  'publishers',
  'collection-creator-prefix',
}

local NAME_FIELDS = { 'author-names', 'collection-creator-names' }

local function blocks_to_inlines(blocks)
  local out = pandoc.Inlines({})
  for _, block in ipairs(blocks) do
    if block.t == 'Para' then
      out:extend(block.content)
    end
  end
  return out
end

local function markdown_inlines(text)
  if text == nil or text:match('^%s*$') then
    return nil
  end
  return blocks_to_inlines(pandoc.read(text, 'markdown').blocks)
end

local function as_inlines(value)
  if value == nil then
    return nil
  end
  local kind = pandoc.utils.type(value)
  if kind == 'Inlines' then
    return value
  end
  if kind == 'Blocks' then
    return blocks_to_inlines(value)
  end
  if kind == 'string' then
    return markdown_inlines(pandoc.utils.stringify(value))
  end
  return nil
end

local function separator(out)
  if #out > 0 then
    out:insert(pandoc.Str(','))
    out:insert(pandoc.Space())
  end
end

local function names_inlines(value)
  if value == nil then
    return nil
  end
  local out = pandoc.Inlines({})
  if pandoc.utils.type(value) == 'List' then
    for _, item in ipairs(value) do
      local inl = as_inlines(item)
      if inl ~= nil and #inl > 0 then
        separator(out)
        out:insert(pandoc.Span(inl, pandoc.Attr('', { 'whitespace-nowrap' })))
      end
    end
  else
    local inl = as_inlines(value)
    if inl == nil or #inl == 0 then
      return nil
    end
    out:insert(pandoc.Span(inl, pandoc.Attr('', { 'whitespace-nowrap' })))
  end
  return #out > 0 and out or nil
end

function Pandoc(doc)
  for _, field in ipairs(FIELDS) do
    local inlines = as_inlines(doc.meta[field])
    if inlines ~= nil and #inlines > 0 then
      doc.meta[field] = inlines
    end
  end
  for _, field in ipairs(NAME_FIELDS) do
    local inlines = names_inlines(doc.meta[field])
    if inlines ~= nil then
      doc.meta[field] = inlines
    end
  end
  return doc
end
