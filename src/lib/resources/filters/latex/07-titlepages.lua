-- Convierte los campos de frontmatter multilinea (subtitle, extratitle,
-- frontispiece, titlehead, subject, dedication, uppertitleback,
-- lowertitleback, publishers, colophon) a LaTeX para la portada, las páginas
-- de título internas y el colofón final. subject y publishers aceptan un
-- array de strings (como author): se unen con ', '. Solo corre en la pasada
-- latex (en HTML los campos se ignoran o los serializa el compositor HTML
-- con \n → espacio). titleImage (imagen de portada) no es contenido
-- markdown: la ruta pasa literal como RawInline latex.
--
-- El valor llega como MetaBlocks (frontmatter YAML |: los párrafos ya son
-- bloques markdown) o MetaInlines (string simple). Se serializa con
-- pandoc.write: el doble espacio al final de línea → \\, y un párrafo con
-- solo :: (o :;) → \vspace{\baselineskip} (+ \noindent). El resultado se
-- guarda como MetaInlines(RawInline('latex')): el template lo emite sin
-- re-escape.
-- Uso: pandoc --from markdown --to latex --lua-filter latex/07-titlepages.lua

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

-- subject y publishers aceptan un solo valor o un array (como author): los
-- items se unen con ', '. Pandoc parsea cada item del array como markdown
-- (MetaInlines → lista de inlines) o lo deja como string (MetaString): se
-- aceptan ambos, extrayendo el texto de inlines Str/Space. Si algún item es
-- complejo (markdown con formato), se deja el valor original.
local LIST_JOIN_FIELDS = { subject = true, publishers = true }

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

-- true si el párrafo es exactamente '::' o ':;' (espacio vertical del
-- vocabulario semántico, escrito como línea sola en el frontmatter).
local function para_is_spacer(para)
  local parts = {}
  for _, inl in ipairs(para.content) do
    if inl.t == 'Str' then
      table.insert(parts, inl.text)
    elseif inl.t ~= 'Space' and inl.t ~= 'SoftBreak' then
      return false
    end
  end
  local joined = table.concat(parts)
  return joined == '::' or joined == ':;'
end

-- Convierte el valor de metadata a una lista de bloques: MetaBlocks
-- (frontmatter |) tal cual; MetaInlines (string simple) envuelto en Para.
-- Los elementos Image se convierten a RawInline(\includegraphics) para
-- que pandoc.write los serialize correctamente.
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

-- Convierte Span con clase .mbox a \mbox{...} (RawInline). pandoc.write no
-- conoce esta clase y la descarta; se pre-procesa antes de serializar.
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
  tiny = true, scriptsize = true, footnotesize = true, small = true,
  normalsize = true, large = true, Large = true, LARGE = true,
  huge = true, Huge = true,
}

local function textsize_class(el)
  for _, c in ipairs(el.classes) do
    if TEXTSIZE_CLASSES[c] then return c end
  end
  return nil
end

local function textsize_span_to_rawlatex(span)
  local cls = textsize_class(span)
  local body = pandoc.write(pandoc.Pandoc({ pandoc.Para(span.content) }), 'latex')
  body = body:gsub('%s+$', '')
  return pandoc.RawInline('latex', '{\\' .. cls .. ' ' .. body .. '}')
end

local function textsize_div_to_rawlatex(div)
  local cls = textsize_class(div)
  local preprocessed = preprocess_div_content(div.content)
  local body = pandoc.write(pandoc.Pandoc(preprocessed), 'latex')
  body = body:gsub('%s+$', '')
  return pandoc.RawBlock('latex', '{\\' .. cls .. ' ' .. body .. '}')
end

local function walk_inlines(inls)
  local out = {}
  for _, el in ipairs(inls) do
    if el.t == 'Span' and el.classes:find('mbox', 1, true) then
      table.insert(out, mbox_span_to_rawlatex(el))
    elseif el.t == 'Span' and el.classes:find('uppercase', 1, true) then
      table.insert(out, uppercase_span_to_rawlatex(el))
    elseif el.t == 'Span' and textsize_class(el) then
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
    elseif b.t == 'Div' and b.classes and textsize_class(b) then
      local cls = textsize_class(b)
      local inner = preprocess_div_content(b.content)
      local body = pandoc.write(pandoc.Pandoc(inner), 'latex')
      body = body:gsub('%s+$', '')
      table.insert(out, pandoc.RawBlock('latex', '{\\' .. cls .. ' ' .. body .. '}'))
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

-- Serializa los bloques a LaTeX: los párrafos "::" se convierten a RawBlock
-- antes de escribir (pandoc.write maneja los escapes, los LineBreak del
-- doble espacio y las comillas). Los Div con clase .dictum se convierten a
-- \dictum[author]{text} de KOMA-Script.
local function serialize_titleback(blocks)
  local out = {}
  for _, b in ipairs(blocks) do
    if b.t == 'Para' and para_is_spacer(b) then
      local marker = b.content[1].text
      local latex = '\\vspace{\\baselineskip}'
      if marker == ':;' then latex = latex .. '\\noindent' end
      table.insert(out, pandoc.RawBlock('latex', latex))
    elseif b.t == 'Div' and b.classes and b.classes:find('dictum', 1, true) then
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
      if width then
        table.insert(out, pandoc.RawBlock('latex', '\\renewcommand{\\dictumwidth}{' .. width .. '\\textwidth}'))
      end
      local cmd = '\\dictum'
      if author and author:match('%S') then
        cmd = cmd .. '[' .. author .. ']'
      end
      cmd = cmd .. '{' .. text_latex .. '}'
      table.insert(out, pandoc.RawBlock('latex', cmd))
    elseif b.t == 'Div' and b.classes and textsize_class(b) then
      table.insert(out, textsize_div_to_rawlatex(b))
    elseif b.t == 'Div' and b.attributes and b.attributes['spacing'] then
      local value = b.attributes['spacing']
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
  out = preprocess_blocks(out)
  local latex = pandoc.write(pandoc.Pandoc(out), 'latex')
  return latex:gsub('%s+$', '')
end

-- titleImage y publisherImage NO son contenido markdown: son rutas de
-- archivo que deben llegar literal a \includegraphics. El writer de pandoc
-- escaparía el guion bajo (mi_imagen.jpg → mi\_imagen.jpg) y rompería la
-- búsqueda del archivo. Acepta MetaString (--metadata del CLI) o inlines
-- Str/Space (frontmatter).
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
