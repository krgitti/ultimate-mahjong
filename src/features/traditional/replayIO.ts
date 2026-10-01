import type { ReplayRecord } from '../../game-engine/traditional/engine';
import type { Ruleset } from '../../game-engine/rules/ruleset';
import { hkRuleset } from '../../game-engine/rules/ruleset';
import { HK_DEFAULTS } from '../../game-engine/rules/hongkong';
import { riichiRuleset } from '../../game-engine/rules/riichi';
import { mcrRuleset } from '../../game-engine/rules/mcr';

/** versão do formato exportado (item 9.2) */
const FORMAT = 'umo-replay-v1';

/** reconstrói o ruleset pelo id gravado no replay (mesmo conjunto do servidor) */
export function rulesetForReplay(id: string): Ruleset {
  if (id === 'riichi') return riichiRuleset({ handsPerMatch: 4, renchan: true });
  if (id === 'mcr') return mcrRuleset();
  return hkRuleset(HK_DEFAULTS);
}

/** serializa para exportação (JSON com marcador de formato) */
export function exportReplay(record: ReplayRecord): string {
  return JSON.stringify({ format: FORMAT, ...record });
}

/**
 * Valida um JSON exportado e devolve o ReplayRecord (null se inválido).
 * Não confia em nada externo: confere formato, tipos e a lista de ações.
 */
export function parseReplay(json: string): ReplayRecord | null {
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    if (o.format !== FORMAT) return null;
    if (typeof o.rulesetId !== 'string' || !o.rulesetId) return null;
    if (typeof o.seed !== 'number' || !Number.isFinite(o.seed)) return null;
    if (!Array.isArray(o.actions)) return null;
    return { rulesetId: o.rulesetId, seed: o.seed, actions: o.actions as ReplayRecord['actions'] };
  } catch {
    return null;
  }
}
