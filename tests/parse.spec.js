/**
 * Number and table parsing. These run in Node — no page, no map.
 *
 * The separator cases are the ones that matter. Reading "45,2" as 452 produces
 * a vote share that is wrong by a factor of ten and looks like a plausible
 * number, so nothing downstream will ever flag it.
 */

import { test, expect } from '@playwright/test';
import { parseNumber, parseTable, guessColumns } from '../src/import/parse.js';

const value = (s) => parseNumber(s).value;
const note = (s) => parseNumber(s).note;

test('percent signs and spacing come off', () => {
  expect(value('45.2%')).toBe(45.2);
  expect(value('45.2 %')).toBe(45.2);
  expect(value(' 45.2 ')).toBe(45.2);
  expect(value('45%')).toBe(45);
});

test('a European decimal comma is a decimal point', () => {
  expect(value('45,2')).toBe(45.2);
  expect(value('45,2 %')).toBe(45.2);
  expect(value('0,8')).toBe(0.8);
  expect(value('9,75')).toBe(9.75);
});

test('a thousands separator is not a decimal point', () => {
  expect(value('1,234')).toBe(1234);
  expect(value('12,345')).toBe(12345);
  expect(value('1,234,567')).toBe(1234567);
});

test('a grouping space is not a decimal point', () => {
  expect(value('1 234')).toBe(1234);
  expect(value('1 234')).toBe(1234);   // non-breaking space
  expect(value('1 234')).toBe(1234);   // narrow no-break space
  expect(value('12 345 678')).toBe(12345678);
});

test('both separators together resolve by which comes last', () => {
  expect(value('1.234,5')).toBe(1234.5);    // European
  expect(value('1,234.5')).toBe(1234.5);    // Anglo
  expect(value('1.234.567,8')).toBe(1234567.8);
  expect(value('1,234,567.8')).toBe(1234567.8);
});

test('a single dot group stays a decimal', () => {
  // 1.234 is far more often a share than it is European thousands, and the
  // two cannot be told apart from the characters alone.
  expect(value('1.234')).toBe(1.234);
  expect(value('1.234.567')).toBe(1234567);  // repeated groups are unambiguous
});

test('non-values are answers, not failures', () => {
  for (const s of ['—', '–', '-', 'N/A', 'n/a', 'New', 'none', '', '?']) {
    expect(value(s), `${s} should read as no value`).toBe(null);
    expect(note(s), `${s} should not be reported as a failure`).toBe(null);
  }
});

test('a cell that cannot be read gets a note, never a zero', () => {
  expect(value('twelve')).toBe(null);
  expect(note('twelve')).toContain('twelve');
  expect(value('4,5,6,7')).not.toBe(0);
});

test('signs, footnotes and tildes survive', () => {
  expect(value('+3.2')).toBe(3.2);
  expect(value('-3.2')).toBe(-3.2);
  expect(value('−3.2')).toBe(-3.2);     // unicode minus
  expect(value('5.9[a]')).toBe(5.9);
  expect(note('~5.9%')).toContain('5.9');   // a tilde is an approximation, not a number
});

test('tab and comma tables both parse, quotes respected', () => {
  const tsv = parseTable('Region\tParty\nPraha\tSpolu');
  expect(tsv.delimiter).toBe('\t');
  expect(tsv.rows[1]).toEqual(['Praha', 'Spolu']);

  const csv = parseTable('Region,Party\n"Smith, John",Independent');
  expect(csv.delimiter).toBe(',');
  expect(csv.rows[1]).toEqual(['Smith, John', 'Independent']);

  // A semicolon file is European CSV, where the comma is the decimal mark.
  const euro = parseTable('Region;Vote\nPraha;45,2');
  expect(euro.delimiter).toBe(';');
  expect(euro.rows[1]).toEqual(['Praha', '45,2']);
});

test('column roles are guessed from the header, and only guessed', () => {
  const { rows } = parseTable('Region\tParty\tVotes\tTurnout\nPraha\tSpolu\t28,4\t62,1');
  const { columns, hasHeader } = guessColumns(rows);
  expect(hasHeader).toBe(true);
  expect(columns.map((c) => c.role)).toEqual(['unit', 'party', 'vote', 'turnout']);
});

test('a headerless table falls back to position, not to a numeric guess', () => {
  const { rows } = parseTable('Praha\tSpolu\t28,4\nBrno\tANO\t31,0');
  const { columns, hasHeader } = guessColumns(rows);
  expect(hasHeader).toBe(false);
  expect(columns[0].role).toBe('unit');
  expect(columns[1].role).toBe('party');
  // The number column is left for the person to name. Guessing it silently is
  // how a "change since last time" column becomes turnout.
  expect(columns[2].role).toBe('ignore');
});
