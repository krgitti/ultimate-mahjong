/**
 * Fila ranqueada por faixa de Elo (item 9.4) — lógica pura de pareamento:
 * a janela começa em `base` e alarga `perMin` por minuto completo de espera.
 * Mesa de 4 é preferida; com 3 o servidor completa com bot.
 */
export interface RQEntry {
  elo: number;
  since: number;
}

export function rankedWindowOf(e: RQEntry, now: number, base = 150, perMin = 100): number {
  const minutes = Math.floor((now - e.since) / 60000);
  return base + perMin * minutes;
}

/** devolve os índices (em `entries`) do grupo pareável, ou null */
export function pickRankedGroup(
  entries: RQEntry[],
  now: number,
  base = 150,
  perMin = 100
): number[] | null {
  if (entries.length < 3) return null;
  const idx = entries.map((_, i) => i).sort((a, b) => entries[a].elo - entries[b].elo);
  for (const size of [4, 3]) {
    for (let k = 0; k + size <= idx.length; k++) {
      const group = idx.slice(k, k + size);
      const spread = entries[group[group.length - 1]].elo - entries[group[0]].elo;
      const allowed = Math.min(...group.map((i) => rankedWindowOf(entries[i], now, base, perMin)));
      if (spread <= allowed) return group;
    }
  }
  return null;
}
