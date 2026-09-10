import { describe, expect, it } from 'bun:test';
import { loadPreambleFilters } from '../builder/preamble-loader.js';
import { validateFrontmatterFields } from '../builder/project-validator.js';

function validate(fm: Record<string, unknown>) {
  return validateFrontmatterFields(fm);
}

function errors(fm: Record<string, unknown>) {
  return validate(fm).filter((i) => i.severity === 'error');
}

describe('intervention type validation', () => {
  it('accepts type: intervention with no extra fields', () => {
    const errs = errors({ type: 'intervention' });
    expect(errs).toHaveLength(0);
  });

  it('accepts pages as positive integer', () => {
    const errs = errors({ type: 'intervention', pages: 3 });
    expect(errs).toHaveLength(0);
  });

  it('accepts lineLength as positive integer', () => {
    const errs = errors({ type: 'intervention', lineLength: 60 });
    expect(errs).toHaveLength(0);
  });

  it('rejects pages as string', () => {
    const errs = errors({ type: 'intervention', pages: 'two' });
    expect(errs.length).toBe(1);
    expect(errs[0]?.message).toContain('pages');
  });

  it('rejects pages as zero', () => {
    const errs = errors({ type: 'intervention', pages: 0 });
    expect(errs.length).toBe(1);
    expect(errs[0]?.message).toContain('pages');
  });

  it('rejects pages as negative', () => {
    const errs = errors({ type: 'intervention', pages: -1 });
    expect(errs.length).toBe(1);
  });

  it('rejects lineLength as float', () => {
    const errs = errors({ type: 'intervention', lineLength: 1.5 });
    expect(errs.length).toBe(1);
    expect(errs[0]?.message).toContain('lineLength');
  });

  it('does not require title or creator', () => {
    const errs = errors({ type: 'intervention', date: '2026-01-01' });
    expect(errs).toHaveLength(0);
  });
});

describe('intervention type in other contexts', () => {
  it('validates as unknown type when not intervention', () => {
    const errs = errors({ type: 'invalid' });
    expect(errs.length).toBe(1);
    expect(errs[0]?.message).toContain('intervention');
  });

  it('accepts pages and lineLength together', () => {
    const errs = errors({ type: 'intervention', pages: 2, lineLength: 50 });
    expect(errs).toHaveLength(0);
  });
});

describe('intervention preamble loading', () => {
  it('loads intervention preamble filters', async () => {
    const filters = await loadPreambleFilters(undefined, undefined, 'intervention');
    expect(filters.length).toBeGreaterThan(0);
    const names = filters.map((f) => f.name);
    expect(names).toContain('19-maketitle');
    expect(names).toContain('28-titlepages');
  });

  it('intervention preamble has same filter count as file preamble', async () => {
    const fileFilters = await loadPreambleFilters(undefined, undefined, 'file');
    const interventionFilters = await loadPreambleFilters(undefined, undefined, 'intervention');
    expect(interventionFilters.length).toBe(fileFilters.length);
  });
});
