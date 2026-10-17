local TITLE_PAGE_FIELDS = {
  'subtitle',
  'extratitle',
  'frontispiece',
  'titlehead',
  'subject',
  'dedication',
  'uppertitleback',
  'lowertitleback',
  'publishers',
  'colophon',
  'collectionCreator',
  'collectionCreatorPrefix',
}

local LIST_JOIN_FIELDS = { subject = true, publishers = true, collectionCreator = true }

local function append_inline_text(parts, inl)
  if inl.t == 'Str' then
    table.insert(parts, inl.text)
  elseif inl.t == 'Space' then
    table.insert(parts, ' ')
  else
    return false
  end
  return true
end

local function join_string_list(meta)
  local parts = {}
  for _, item in ipairs(meta) do
    if type(item) == 'string' then
      table.insert(parts, item)
    elseif type(item) == 'table' and #item > 0 then
      local item_parts = {}
      for _, inl in ipairs(item) do
        if not append_inline_text(item_parts, inl) then
          return nil
        end
      end
      table.insert(parts, table.concat(item_parts))
    else
      return nil
    end
  end
  return table.concat(parts, ', ')
end

local BLOCK_TYPES = {
  Para = true, Plain = true, Header = true, BlockQuote = true, Div = true,
  BulletList = true, OrderedList = true, CodeBlock = true, RawBlock = true,
  Figure = true,
}

local function br_count(div)
  if div.t ~= 'Div' or not div.attributes then return nil end
  local n = tonumber(div.attributes['br'])
  if not n then return nil end
  n = math.floor(n)
  if n <= 0 then return nil end
  return n
end

-- Convierte un Div {br=N} en sus bloques: N vspaces mas su contenido, que no
-- se tira (un fenced div puede llevar texto y los otros atributos de bloque
-- si lo conservan). El primer parrafo del contenido recibe el \noindent del
-- salto; si el primer bloque no es un parrafo, la bandera se descarta (#2670).
local function br_div_blocks(div)
  local n = br_count(div)
  if not n then return nil end
  local out = {}
  for i = 1, n do
    table.insert(out, pandoc.RawBlock('latex', '\\vspace{\\baselineskip}'))
  end
  local first = true
  for _, child in ipairs(div.content or {}) do
    if child.t == 'Div' and br_count(child) then
      for _, nb in ipairs(br_div_blocks(child)) do
        table.insert(out, nb)
      end
    else
      if first and child.t == 'Para' then
        table.insert(child.content, 1, pandoc.RawInline('latex', '\\noindent '))
      end
      table.insert(out, child)
    end
    first = false
  end
  return out
end

local function image_to_latex(el)
  local path = el.src
  local attrs = ''
  if el.attributes and el.attributes['width'] then
    attrs = '[width=' .. el.attributes['width'] .. ']'
  end
  return '\\includegraphics' .. attrs .. '{' .. path .. '}'
end

local function extract_image_from_figure(el)
  if el.t ~= 'Figure' or not el.content or #el.content == 0 then return nil end
  local inner = el.content[1]
  if inner.t == 'Image' then
    return inner
  elseif inner.t == 'Plain' and inner.content and #inner.content > 0 then
    local inline = inner.content[1]
    if inline.t == 'Image' then
      return inline
    end
  end
  return nil
end

local function meta_to_blocks(meta)
  if type(meta) ~= 'table' or #meta == 0 then return nil end
  local blocks = {}
  if BLOCK_TYPES[meta[1].t] then
    for i = 1, #meta do
      local el = meta[i]
      local img = extract_image_from_figure(el)
      if img then
        blocks[i] = pandoc.RawBlock('latex', image_to_latex(img))
      else
        blocks[i] = el
      end
    end
  else
    local inlines = {}
    for i = 1, #meta do
      local el = meta[i]
      local img = extract_image_from_figure(el)
      if img then
        inlines[i] = pandoc.RawInline('latex', image_to_latex(img))
      elseif el.t == 'Image' then
        inlines[i] = pandoc.RawInline('latex', image_to_latex(el))
      else
        inlines[i] = el
      end
    end
    return { pandoc.Para(inlines) }
  end
  return blocks
end

local function mbox_span_to_rawlatex(span)
  local body = pandoc.write(pandoc.Pandoc({ pandoc.Para(span.content) }), 'latex')
  body = body:gsub('%s+$', '')
  return pandoc.RawInline('latex', '\\mbox{' .. body .. '}')
end

local function uppercase_span_to_rawlatex(span)
  local body = pandoc.write(pandoc.Pandoc({ pandoc.Para(span.content) }), 'latex')
  body = body:gsub('%s+$', '')
  return pandoc.RawInline('latex', '\\MakeUppercase{' .. body .. '}')
end

local TEXTSIZE_CLASSES = {
  ['text-xs'] = 'footnotesize',
  ['text-sm'] = 'small',
  ['text-base'] = 'normalsize',
  ['text-lg'] = 'large',
  ['text-xl'] = 'Large',
  ['text-2xl'] = 'LARGE',
  ['text-4xl'] = 'huge',
  ['text-6xl'] = 'Huge',
}

local function textls_value(el)
  local attrs = el.attributes
  if not attrs then return nil end
  local shrink = attrs['shrink']
  if shrink ~= nil then
    local n = tonumber(shrink)
    if n then return string.format('%g', -n) end
  end
  local stretch = attrs['stretch']
  if stretch ~= nil then
    local n = tonumber(stretch)
    if n then return string.format('%g', n) end
  end
  return nil
end

local function textsize_cmd(el)
  for _, c in ipairs(el.classes) do
    if TEXTSIZE_CLASSES[c] then return TEXTSIZE_CLASSES[c] end
  end
  return nil
end

local function textsize_span_to_rawlatex(span)
  local cmd = textsize_cmd(span)
  local body = pandoc.write(pandoc.Pandoc({ pandoc.Para(span.content) }), 'latex')
  body = body:gsub('%s+$', '')
  return pandoc.RawInline('latex', '{\\' .. cmd .. ' ' .. body .. '}')
end

local function walk_inlines(inls)
  local out = {}
  for _, el in ipairs(inls) do
    if el.t == 'Span' and el.classes:find('mbox', 1, true) then
      table.insert(out, mbox_span_to_rawlatex(el))
    elseif el.t == 'Span' and el.classes:find('uppercase', 1, true) then
      table.insert(out, uppercase_span_to_rawlatex(el))
    elseif el.t == 'Span' and textsize_cmd(el) then
      table.insert(out, textsize_span_to_rawlatex(el))
    else
      table.insert(out, el)
    end
  end
  return out
end

local function preprocess_blocks(blocks)
  local out = {}
  for _, b in ipairs(blocks) do
    if b.content and (b.t == 'Para' or b.t == 'Plain') then
      local cloned = pandoc[b.t](walk_inlines(b.content))
      table.insert(out, cloned)
    else
      table.insert(out, b)
    end
  end
  return out
end

local function preprocess_div_content(blocks)
  local out = {}
  for _, b in ipairs(blocks) do
    if b.content and (b.t == 'Para' or b.t == 'Plain') then
      local cloned = pandoc[b.t](walk_inlines(b.content))
      table.insert(out, cloned)
    elseif b.t == 'Div' and b.classes and textsize_cmd(b) then
      local cmd = textsize_cmd(b)
      local inner = preprocess_div_content(b.content)
      local body = pandoc.write(pandoc.Pandoc(inner), 'latex')
      body = body:gsub('%s+$', '')
      table.insert(out, pandoc.RawBlock('latex', '{\\' .. cmd .. ' ' .. body .. '}'))
    elseif b.t == 'Div' and textls_value(b) then
      local inner = preprocess_div_content(b.content)
      local body = pandoc.write(pandoc.Pandoc(inner), 'latex')
      body = body:gsub('%s+$', '')
      table.insert(out, pandoc.RawBlock('latex', '\\textls[' .. textls_value(b) .. ']{' .. body .. '}'))
    elseif b.t == 'Div' and br_count(b) then
      for _, nb in ipairs(br_div_blocks(b)) do
        table.insert(out, nb)
      end
    elseif b.t == 'Div' and b.content then
      local cloned = pandoc.Div(preprocess_div_content(b.content))
      cloned.classes = b.classes
      cloned.attributes = b.attributes
      table.insert(out, cloned)
    else
      table.insert(out, b)
    end
  end
  return out
end

local function textsize_div_to_rawlatex(div)
  local cmd = textsize_cmd(div)
  local preprocessed = preprocess_div_content(div.content)
  local body = pandoc.write(pandoc.Pandoc(preprocessed), 'latex')
  body = body:gsub('%s+$', '')
  return pandoc.RawBlock('latex', '{\\' .. cmd .. ' ' .. body .. '}')
end

local function serialize_titleback(blocks)
  local out = {}
  local pending_noindent = false
  for _, b in ipairs(blocks) do
    local br_blocks = (b.t == 'Div') and br_div_blocks(b) or nil
    if br_blocks then
      for _, nb in ipairs(br_blocks) do
        table.insert(out, nb)
      end
      -- El div vacio no tiene a quien ponerle el noindent: lo recibe el
      -- bloque siguiente, igual que en el cuerpo.
      pending_noindent = next(b.content) == nil
    else
      if pending_noindent and b.t == 'Para' then
        table.insert(b.content, 1, pandoc.RawInline('latex', '\\noindent '))
      end
      pending_noindent = false
      if b.t == 'Div' and b.classes and b.classes:find('dictum', 1, true) then
        local text_parts = {}
        local author = nil
        local width = nil
        if b.attributes and b.attributes['width'] then
          local num = tonumber(b.attributes['width'])
          if num and num >= 0.1 and num <= 1.0 then
            width = num
          end
        end
        for _, inner in ipairs(b.content) do
          if inner.t == 'Div' and inner.classes and inner.classes:find('author', 1, true) then
            local author_inls = {}
            for _, bl in ipairs(inner.content) do
              if (bl.t == 'Para' or bl.t == 'Plain') and bl.content then
                for _, inl in ipairs(bl.content) do
                  table.insert(author_inls, inl)
                end
              end
            end
            author = pandoc.write(pandoc.Pandoc({ pandoc.Para(author_inls) }), 'latex')
            author = author:gsub('%s+$', '')
          else
            table.insert(text_parts, inner)
          end
        end
        local text_latex = ''
        if #text_parts > 0 then
          text_latex = pandoc.write(pandoc.Pandoc(text_parts), 'latex')
          text_latex = text_latex:gsub('%s+$', '')
        end
        local cmd = '\\dictum'
        if author and author:match('%S') then
          cmd = cmd .. '[' .. author .. ']'
        end
        cmd = cmd .. '{' .. text_latex .. '}{' .. (width or '') .. '}'
        table.insert(out, pandoc.RawBlock('latex', cmd))
      elseif b.t == 'Div' and b.classes and textsize_cmd(b) then
        table.insert(out, textsize_div_to_rawlatex(b))
      elseif b.t == 'Div' and textls_value(b) then
        local preprocessed = preprocess_div_content(b.content)
        local body = pandoc.write(pandoc.Pandoc(preprocessed), 'latex')
        body = body:gsub('%s+$', '')
        table.insert(out, pandoc.RawBlock('latex', '\\textls[' .. textls_value(b) .. ']{' .. body .. '}'))
      elseif b.t == 'Div' and b.attributes and b.attributes['line-height'] then
        local value = b.attributes['line-height']
        local num = tonumber(value)
        if num and num > 0 then
          local preprocessed = preprocess_div_content(b.content)
          local body = pandoc.write(pandoc.Pandoc(preprocessed), 'latex')
          body = body:gsub('%s+$', '')
          table.insert(out, pandoc.RawBlock('latex', '\\begin{spacing}{' .. value .. '}\n' .. body .. '\n\\end{spacing}'))
        else
          table.insert(out, b)
        end
      else
        table.insert(out, b)
      end
    end
  end
  out = preprocess_blocks(out)
  local latex = pandoc.write(pandoc.Pandoc(out), 'latex')
  return latex:gsub('%s+$', '')
end

local RAW_PATH_FIELDS = { 'titleImage', 'publisherImage', 'startpaper' }

local function meta_to_rawpath(meta)
  if type(meta) == 'string' then
    return meta
  end
  if type(meta) ~= 'table' or #meta == 0 then
    return nil
  end
  local parts = {}
  for _, inl in ipairs(meta) do
    if inl.t == 'Str' then
      table.insert(parts, inl.text)
    elseif inl.t == 'Space' then
      table.insert(parts, ' ')
    else
      return nil
    end
  end
  return table.concat(parts)
end

function Pandoc(doc)
  if FORMAT ~= 'latex' then return doc end

  for _, field in ipairs(TITLE_PAGE_FIELDS) do
    local meta = doc.meta[field]
    if LIST_JOIN_FIELDS[field] and type(meta) == 'table' and #meta > 0 then
      local joined = join_string_list(meta)
      if joined ~= nil then
        meta = { pandoc.Str(joined) }
      end
    end
    local blocks = meta_to_blocks(meta)
    if blocks ~= nil then
      local latex = serialize_titleback(blocks)
      if latex:match('%S') then
        doc.meta[field] = pandoc.MetaInlines({ pandoc.RawInline('latex', latex) })
      end
    end
  end

  for _, field in ipairs(RAW_PATH_FIELDS) do
    local raw = meta_to_rawpath(doc.meta[field])
    if raw ~= nil and raw ~= '' then
      doc.meta[field] = pandoc.MetaInlines({ pandoc.RawInline('latex', raw) })
    end
  end

  return doc
end
