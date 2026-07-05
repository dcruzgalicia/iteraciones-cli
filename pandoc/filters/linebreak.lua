-- Lua filter for pandoc
-- 1. Replaces consecutive LineBreaks (backslash at end of line) with
--    paragraph breaks using a non-breaking space, exactly matching the
--    spacing produced by &nbsp; on a blank line.
-- 2. Ensures paragraphs after a &nbsp;-only paragraph are not indented,
--    both for explicit &nbsp; usage and for the synthesized ones above.

function Pandoc(doc)
  local new_blocks = {}
  local prev_was_nbsp = false

  for _, block in ipairs(doc.blocks) do
    if block.t == "Para" then
      local content = block.content

      -- Check if this paragraph contains consecutive LineBreaks
      -- (from markdown: \ at end of line on consecutive lines)
      local has_consecutive_lb = false
      for j = 1, #content - 1 do
        if content[j].t == "LineBreak" and content[j + 1].t == "LineBreak" then
          has_consecutive_lb = true
          break
        end
      end

      if has_consecutive_lb then
        -- Split the Para at consecutive LineBreaks
        local segments = {}
        local current = {}
        local i = 1

        while i <= #content do
          local item = content[i]
          if item.t == "LineBreak" and i < #content and content[i + 1].t == "LineBreak" then
            if #current > 0 then
              table.insert(segments, current)
              current = {}
            end
            -- Skip all consecutive LineBreaks
            while i <= #content and content[i].t == "LineBreak" do
              i = i + 1
            end
            -- Mark that we need an nbsp paragraph
            table.insert(segments, "nbsp")
          else
            table.insert(current, item)
            i = i + 1
          end
        end
        if #current > 0 then
          table.insert(segments, current)
        end

        -- Build blocks from segments
        for idx, seg in ipairs(segments) do
          if seg == "nbsp" then
            -- Insert a blank paragraph matching &nbsp; behavior
            table.insert(new_blocks, pandoc.Para({pandoc.Str("\u{00A0}")}))
            prev_was_nbsp = true
          else
            local para = pandoc.Para(seg)
            -- If previous block was nbsp, add \noindent
            if prev_was_nbsp then
              table.insert(para.content, 1, pandoc.RawInline("latex", "\\noindent\\ignorespaces "))
              prev_was_nbsp = false
            end
            table.insert(new_blocks, para)
          end
        end
      else
        -- Regular paragraph (no consecutive LineBreaks)
        -- If this paragraph contains only a non-breaking space, mark it
        local is_nbsp = false
        if #content == 1 and content[1].t == "Str" and content[1].text == "\u{00A0}" then
          is_nbsp = true
        end

        if is_nbsp then
          table.insert(new_blocks, block)
          prev_was_nbsp = true
        else
          -- Prepend \noindent if previous was nbsp
          if prev_was_nbsp then
            table.insert(content, 1, pandoc.RawInline("latex", "\\noindent\\ignorespaces "))
          end
          table.insert(new_blocks, block)
          prev_was_nbsp = false
        end
      end
    else
      -- Non-Para blocks: propagate prev_was_nbsp
      -- (so section titles, code blocks, etc. reset the flag)
      table.insert(new_blocks, block)
      prev_was_nbsp = false
    end
  end

  return pandoc.Pandoc(new_blocks, doc.meta)
end
