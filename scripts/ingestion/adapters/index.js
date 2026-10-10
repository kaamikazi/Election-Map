import { parseParlGov } from './parlgov.js';
import { parseUKParliament } from './uk-parliament.js';

export const ADAPTERS = Object.freeze({
  'parlgov-v1': { version: 1, parse: parseParlGov },
  'uk-parliament-v1': { version: 1, parse: parseUKParliament }
});
export function parseSource(input) {
  const adapter = ADAPTERS[input.source.parser];
  if (!adapter) throw new Error(`No parser registered for ${input.source.parser}`);
  return { ...adapter.parse(input), parser: input.source.parser, parserVersion: adapter.version };
}
