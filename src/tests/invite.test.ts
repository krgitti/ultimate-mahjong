import { describe, it, expect } from 'vitest';
import { inviteLink, roomFromSearch, replayLink, replayCodeFromSearch } from '../features/online/invite';
import { exportReplay, parseReplay } from '../features/traditional/replayIO';

describe('item 8d — convite por link', () => {
  it('inviteLink: adiciona ?sala=CODE e a rota #online', () => {
    expect(inviteLink('https://jogo.example/app/', 'A7K2')).toBe(
      'https://jogo.example/app/?sala=A7K2#online'
    );
  });

  it('inviteLink: preserva parâmetros existentes e substitui sala anterior', () => {
    expect(inviteLink('https://jogo.example/?a=1', 'XY12')).toBe(
      'https://jogo.example/?a=1&sala=XY12#online'
    );
    expect(inviteLink('https://jogo.example/?sala=VELHA&a=1', 'NOVA')).toBe(
      'https://jogo.example/?sala=NOVA&a=1#online'
    );
  });

  it('roomFromSearch: lê ?sala=CODE e devolve vazio quando ausente', () => {
    expect(roomFromSearch('?sala=ABCD')).toBe('ABCD');
    expect(roomFromSearch('?a=1&sala=Q9Z1&b=2')).toBe('Q9Z1');
    expect(roomFromSearch('')).toBe('');
    expect(roomFromSearch('?outra=1')).toBe('');
  });

  it('replayLink/replayCodeFromSearch: link de replay compartilhado (item 9.2)', () => {
    expect(replayLink('https://jogo.example/app/', 'A7K2X9')).toBe(
      'https://jogo.example/app/?replay=A7K2X9#online'
    );
    // remove ?sala= anterior para não conflitar com convite de sala
    expect(replayLink('https://jogo.example/?sala=QQQQ', 'A7K2X9')).toBe(
      'https://jogo.example/?replay=A7K2X9#online'
    );
    expect(replayCodeFromSearch('?replay=A7K2X9')).toBe('A7K2X9');
    expect(replayCodeFromSearch('')).toBe('');
  });
});

describe('item 9b — export/import de replay', () => {
  it('round-trip: exportReplay → parseReplay devolve o mesmo record', () => {
    const rec = { rulesetId: 'hk', seed: 42, actions: [{ t: 'discard', seat: 0, tile: 5 }] } as never;
    const json = exportReplay(rec);
    const back = parseReplay(json);
    expect(back).toEqual(rec);
  });

  it('parseReplay rejeita JSON inválido/estranho', () => {
    expect(parseReplay('não é json')).toBeNull();
    expect(parseReplay('{}')).toBeNull();
    expect(parseReplay(JSON.stringify({ format: 'outro', rulesetId: 'hk', seed: 1, actions: [] }))).toBeNull();
    expect(parseReplay(JSON.stringify({ format: 'umo-replay-v1', rulesetId: '', seed: 1, actions: [] }))).toBeNull();
    expect(parseReplay(JSON.stringify({ format: 'umo-replay-v1', rulesetId: 'hk', seed: 'x', actions: [] }))).toBeNull();
    expect(parseReplay(JSON.stringify({ format: 'umo-replay-v1', rulesetId: 'hk', seed: 1, actions: 'nope' }))).toBeNull();
  });
});
