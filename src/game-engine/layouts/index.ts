import type { LayoutDefinition, RawLayout } from './types';
import { expandLayout, toPositions } from './types';
import { KMAHJONGG_LAYOUTS } from './kmahjongg-data';
import { HANDCRAFTED_LAYOUTS } from './handcrafted';

export * from './types';

/** Core five required layouts come first, then the extra catalog. */
const CORE_IDS = ['turtle', 'dragon', 'pyramid', 'fortress', 'butterfly'];

const RENAMES: Record<string, string> = {
  // KMahjongg's pyramid is a 204-tile XL variant; keep it in the catalog under another id.
  pyramid: 'pyramid-xl',
};
const NAME_FIXES: Record<string, string> = {
  'pyramid-xl': 'Pirâmide XL',
};

function buildRegistry(): Record<string, RawLayout> {
  const reg: Record<string, RawLayout> = {};
  for (const l of HANDCRAFTED_LAYOUTS) reg[l.id] = l;
  for (const [id, l] of Object.entries(KMAHJONGG_LAYOUTS)) {
    const newId = RENAMES[id] ?? id;
    if (reg[newId]) continue; // core wins
    reg[newId] = { ...l, id: newId, name: NAME_FIXES[newId] ?? l.name };
  }
  return reg;
}

const REGISTRY = buildRegistry();

export function getLayout(id: string): RawLayout | undefined {
  return REGISTRY[id];
}

export function getLayoutDefinition(id: string): LayoutDefinition | undefined {
  const l = REGISTRY[id];
  return l ? expandLayout(l) : undefined;
}

export function listLayouts(): LayoutDefinition[] {
  const all = Object.values(REGISTRY).map(expandLayout);
  all.sort((a, b) => {
    const ai = CORE_IDS.indexOf(a.id);
    const bi = CORE_IDS.indexOf(b.id);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.name.localeCompare(b.name);
  });
  return all;
}

export function coreLayoutIds(): string[] {
  return [...CORE_IDS];
}

export function layoutPositions(id: string) {
  const l = REGISTRY[id];
  if (!l) throw new Error(`unknown layout: ${id}`);
  return toPositions(l);
}

/** Register a custom (editor) layout at runtime. */
export function registerCustomLayout(raw: RawLayout): void {
  REGISTRY[raw.id] = { ...raw, source: 'custom' };
}

export function unregisterLayout(id: string): void {
  delete REGISTRY[id];
}
