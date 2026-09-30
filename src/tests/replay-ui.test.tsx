// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ReplayReview } from '../features/traditional/ReplayReview';
import { newMatch, drawTile, discard, serializeReplay } from '../game-engine/traditional/engine';
import { hkRuleset } from '../game-engine/rules/ruleset';
import { HK_DEFAULTS } from '../game-engine/rules/hongkong';

afterEach(() => cleanup());

function buildRecord() {
  const s = newMatch(HK_DEFAULTS, 1234);
  drawTile(s);
  discard(s, s.drawnTile ?? s.players[0].hand[0]);
  drawTile(s);
  discard(s, s.drawnTile ?? s.players[1].hand[0]);
  return serializeReplay(s);
}

describe('ReplayReview (item 3) — UI de revisão com linha do tempo', () => {
  it('abre no estado final e navega passo a passo', () => {
    const record = buildRecord();
    const n = record.actions.length;
    expect(n).toBeGreaterThanOrEqual(3);
    render(<ReplayReview record={record} ruleset={hkRuleset(HK_DEFAULTS)} onClose={() => {}} />);
    expect(screen.getByText(/Revisão da partida/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`passo ${n}/${n}`))).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Início'));
    expect(screen.getByText(new RegExp(`passo 0/${n}`))).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Avançar um passo'));
    expect(screen.getByText(new RegExp(`passo 1/${n}`))).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Voltar um passo'));
    expect(screen.getByText(new RegExp(`passo 0/${n}`))).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Fim'));
    expect(screen.getByText(new RegExp(`passo ${n}/${n}`))).toBeInTheDocument();
    expect(screen.getByText(/Fim da linha do tempo/)).toBeInTheDocument();
  });

  it('a linha do tempo lista as ações e um clique salta para aquele ponto', () => {
    const record = buildRecord();
    const n = record.actions.length;
    render(<ReplayReview record={record} ruleset={hkRuleset(HK_DEFAULTS)} onClose={() => {}} />);
    const items = screen.getAllByText(/descarta #/);
    expect(items.length).toBeGreaterThan(0);
    // clica na primeira ação visível (passo 1)
    fireEvent.click(items[0]);
    expect(screen.getByText(new RegExp(`passo 1/${n}`))).toBeInTheDocument();
  });

  it('o slider move a revisão', () => {
    const record = buildRecord();
    const n = record.actions.length;
    render(<ReplayReview record={record} ruleset={hkRuleset(HK_DEFAULTS)} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Linha do tempo'), { target: { value: '2' } });
    expect(screen.getByText(new RegExp(`passo 2/${n}`))).toBeInTheDocument();
  });
});
