-- Lua filter for pandoc
-- Transforms Divs with class .dictum to LaTeX \dictum commands.
-- Runs after pandoc-citeproc, so @citekey in the Div content is
-- already resolved to formatted citation text.
--
-- Usage: pandoc ... --lua-filter dictum.lua
--
-- The last paragraph inside the fenced div is treated as the author
-- (optional argument of \dictum). All preceding paragraphs form the quote.
-- Consecutive dictums are detected and spaced accordingly.

function Pandoc(doc)
  local new_blocks = {}
  local prev_was_dictum = false
  -- When a dictum chain ends, the next paragraph needs \noindent to
  -- avoid indentation. Rather than emitting a separate RawBlock (which
  -- becomes an empty paragraph in LaTeX), we prepend a RawInline to
  -- the next Para block.
  local needs_noindent = false

  for i, block in ipairs(doc.blocks) do
    if block.t == "Div" and block.classes:includes("dictum") then
      -- Collect paragraph blocks from the Div content
      local paras = {}
      for _, item in ipairs(block.content) do
        if item.t == "Para" then
          table.insert(paras, item)
        end
      end

      -- Separate quote (all but last paragraph) and author (last paragraph)
      local quote_paras = {}
      local author_para = nil
      if #paras >= 2 then
        for j = 1, #paras - 1 do
          table.insert(quote_paras, paras[j])
        end
        author_para = paras[#paras]
      elseif #paras == 1 then
        quote_paras = paras
      end

      -- Convert blocks to LaTeX string preserving formatting
      local function blocks_to_latex(blocks)
        local subdoc = pandoc.Pandoc(blocks, {})
        local latex = pandoc.write(subdoc, 'latex')
        -- Strip the pandoc document wrapper: \begin{document} ... \end{document}
        latex = latex:gsub('^.-\n\\begin{document}\n', '')
        latex = latex:gsub('\\end{document}\n?$', '')
        latex = latex:gsub('\n$', '')
        return latex
      end

      local quote_latex = #quote_paras > 0 and blocks_to_latex(quote_paras) or ""
      local author_latex = author_para and blocks_to_latex({author_para}) or ""

      -- Preserve paragraph breaks (\n\n) but collapse soft line wraps (\n) within paragraphs
      -- so multi-paragraph quotes stay as separate paragraphs inside \dictum{}
      local PAR = '\x00PAR\x00'
      quote_latex = quote_latex:gsub('\n\n+', PAR)
      quote_latex = quote_latex:gsub('\n', ' ')
      quote_latex = quote_latex:gsub(PAR, '\n\n')
      author_latex = author_latex:gsub('\n\n+', PAR)
      author_latex = author_latex:gsub('\n', ' ')
      author_latex = author_latex:gsub(PAR, '\n\n')

      -- Strip leading/trailing whitespace
      quote_latex = quote_latex:gsub('^%s+', ''):gsub('%s+$', '')
      author_latex = author_latex:gsub('^%s+', ''):gsub('%s+$', '')

      -- Determine spacing based on consecutive dictum detection.
      local next_is_dictum = false
      if i < #doc.blocks then
        local next = doc.blocks[i + 1]
        if next.t == "Div" and next.classes:includes("dictum") then
          next_is_dictum = true
        end
      end

      local spacing
      if next_is_dictum then
        spacing = "2\\topskip"
      elseif prev_was_dictum then
        spacing = "2.9\\topskip"
      else
        spacing = "3.4\\topskip"
      end

      -- Build LaTeX: \renewcommand + \dictum[author]{quote}
      local prefix = "\\renewcommand*{\\dictumauthorformat}[1]{{\\raggedleft\\normalfont\\normalsize #1}\\vspace*{" .. spacing .. "}}"
      local dictum_cmd
      if author_latex ~= "" then
        dictum_cmd = "\\dictum[" .. author_latex .. "]{" .. quote_latex .. "}"
      else
        dictum_cmd = "\\dictum{" .. quote_latex .. "}"
      end

      table.insert(new_blocks, pandoc.RawBlock('latex', prefix .. "\n" .. dictum_cmd))

      -- After the last (non-consecutive) dictum, signal that the next
      -- paragraph needs \noindent (to avoid indentation after dictum).
      needs_noindent = not next_is_dictum
      prev_was_dictum = true
    elseif block.t == "BlockQuote" or block.t == "CodeBlock" or block.t == "Header" then
      -- After blockquotes, code blocks and section titles the first
      -- text paragraph should not be indented.
      table.insert(new_blocks, block)
      needs_noindent = true
      prev_was_dictum = false
    elseif block.t == "RawBlock" and (block.format == "latex" or block.format == "tex") then
      -- Catch RawBlock with LaTeX sectioning commands (\sectionchild,
      -- \standalonesection, \chapterauthor, etc.) that are wrapped in
      -- groups and lose afterindent=false from the internal \section{}.
      local text = block.text:gsub('^%s*', '')
      local is_section_cmd = {
        ['\\chapter'] = true, ['\\section'] = true,
        ['\\subsection'] = true, ['\\subsubsection'] = true,
        ['\\paragraph'] = true, ['\\subparagraph'] = true,
        ['\\part'] = true,
        ['\\standalonesection'] = true, ['\\sectionchild'] = true,
        ['\\chapterauthor'] = true, ['\\standalonepart'] = true,
        ['\\invisiblechapter'] = true, ['\\containerpart'] = true,
      }
      local matched = false
      for cmd, _ in pairs(is_section_cmd) do
        if text:find(cmd, 1, true) == 1 then
          matched = true
          break
        end
      end
      if matched then
        table.insert(new_blocks, block)
        needs_noindent = true
        prev_was_dictum = false
      else
        -- Other raw blocks (e.g. \cleardoublepage) preserve needs_noindent
        -- from the previous block, so section → cleardoublepage → text
        -- still gets noindent on the text.
        table.insert(new_blocks, block)
      end
    else
      -- For non-dictum blocks: if we need \noindent and this is a Para,
      -- prepend \noindent\ignorespaces as a RawInline at the start of
      -- the paragraph content.
      if needs_noindent and block.t == "Para" then
        table.insert(block.content, 1, pandoc.RawInline('latex', '\\noindent\\ignorespaces '))
      end
      table.insert(new_blocks, block)
      needs_noindent = false
      prev_was_dictum = false
    end
  end

  return pandoc.Pandoc(new_blocks, doc.meta)
end
