import { describe, it, expect } from 'vitest';
import { inviteLink, roomFromSearch } from '../features/online/invite';

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
});
