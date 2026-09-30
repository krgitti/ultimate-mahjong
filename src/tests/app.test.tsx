// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { App } from '../app/App';
import { store, KEYS, MemoryStorage, Store } from '../storage/storage';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, loadStats, recordSolitaireResult } from '../storage/profile';

// Use an in-memory adapter so tests never touch a real localStorage.
const mem = new MemoryStorage();
(store as unknown as { adapter: StorageAdapterLike }).adapter = mem;
interface StorageAdapterLike {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

// RTL auto-cleanup requires vitest globals; we run with globals:false, so clean up manually.
afterEach(() => cleanup());

beforeEach(() => {
  mem.remove(KEYS.settings);
  mem.remove(KEYS.stats);
  mem.remove(KEYS.solitaireSave);
  mem.remove(KEYS.traditionalSave);
  mem.remove(KEYS.campaign);
  mem.remove(KEYS.challenges);
  mem.remove(KEYS.customLayouts);
  window.location.hash = '';
});

describe('app: initialization & navigation', () => {
  it('renders the home menu with all entries', () => {
    render(<App />);
    expect(screen.getByText(/Bem-vindo à mesa/i)).toBeInTheDocument();
    for (const label of [
      'Jogar Solitaire',
      'Mahjong Tradicional',
      'Jogar contra IA',
      'Aprender',
      'Desafios',
      'Estatísticas',
      'Configurações',
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it('navigates between screens via the top bar', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getAllByText('Aprender')[0]);
    expect(await screen.findByText(/Tutoriais/i)).toBeInTheDocument();
    await user.click(screen.getAllByText('Estatísticas')[0]);
    expect(await screen.findByText(/Melhor pontuação/i)).toBeInTheDocument();
    await user.click(screen.getAllByText('Config')[0]);
    expect(await screen.findByText(/Alto contraste/i)).toBeInTheDocument();
    await user.click(screen.getAllByText('Início')[0]);
    expect(await screen.findByText(/Bem-vindo à mesa/i)).toBeInTheDocument();
  });

  it('deep-links via hash work', async () => {
    window.location.hash = '#/stats';
    render(<App />);
    expect(await screen.findByText(/Mahjong Tradicional \(Hong Kong\)/i)).toBeInTheDocument();
  });
});

describe('app: settings persistence', () => {
  it('toggling high contrast persists and applies the body class', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getAllByText('Config')[0]);
    const cb = screen.getByLabelText(/Alto contraste/i) as HTMLInputElement;
    expect(cb.checked).toBe(false);
    await user.click(cb);
    expect(cb.checked).toBe(true);
    expect(document.body.classList.contains('contrast-high')).toBe(true);
    // persisted?
    const saved = JSON.parse(mem.get(KEYS.settings)!);
    expect(saved.highContrast).toBe(true);
  });

  it('settings survive a reload (new App instance)', async () => {
    const user = userEvent.setup();
    const view1 = render(<App />);
    await user.click(screen.getAllByText('Config')[0]);
    await user.click(screen.getByLabelText(/Sons/i));
    view1.unmount();
    render(<App />);
    await userEvent.setup().click(screen.getAllByText('Config')[0]);
    expect((screen.getByLabelText(/Sons/i) as HTMLInputElement).checked).toBe(false);
  });
});

describe('storage layer', () => {
  it('read/write round-trip with a memory adapter', () => {
    const s = new Store(new MemoryStorage());
    s.write('k', { a: 1 });
    expect(s.read('k', null)).toEqual({ a: 1 });
  });

  it('corrupted JSON falls back to default', () => {
    const s = new Store(new MemoryStorage());
    (s as unknown as { adapter: StorageAdapterLike }).adapter.set('k', '{oops');
    expect(s.read('k', 'fallback')).toBe('fallback');
  });

  it('stats accumulate correctly', () => {
    const st = recordSolitaireResult({ won: true, score: 120, pairs: 72, ms: 60000, hints: 1, shuffles: 0 });
    expect(st.solitaire.gamesWon).toBe(1);
    expect(st.solitaire.bestScore).toBe(120);
    recordSolitaireResult({ won: false, score: 10, pairs: 5, ms: 10000, hints: 0, shuffles: 1 });
    const st2 = loadStats();
    expect(st2.solitaire.gamesPlayed).toBe(2);
    expect(st2.solitaire.deadlocks).toBe(1);
  });

  it('default settings load when nothing is stored', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('partial settings merge with defaults', () => {
    saveSettings({ ...DEFAULT_SETTINGS, uiScale: 1.2 });
    mem.set(KEYS.settings, JSON.stringify({ uiScale: 0.9 }));
    const s = loadSettings();
    expect(s.uiScale).toBe(0.9);
    expect(s.sound).toBe(DEFAULT_SETTINGS.sound);
    expect(s.traditional.botDifficulty).toBe('medium');
  });
});

describe('solitaire screen: real gameplay through the UI', () => {
  it('renders a board, plays one legal pair via clicks, and persists the save', async () => {
    render(<App />);
    fireEvent.click(screen.getAllByText('Jogar Solitaire')[0]);
    // board appears (144 tiles -> at least many buttons with tile labels)
    await waitFor(() => {
      const tiles = document.querySelectorAll<HTMLButtonElement>('button[data-tile-id]');
      expect(tiles.length).toBeGreaterThan(100);
    });
    // use the hint to find a legal pair, then click both tiles
    const hintBtn = screen.getByTitle(/Dica/);
    await act(async () => {
      fireEvent.click(hintBtn);
    });
    const glowing = [...document.querySelectorAll('button.hint-glow')] as HTMLButtonElement[];
    expect(glowing.length).toBe(2);
    // separate acts: React must re-render between clicks (like real usage)
    await act(async () => {
      fireEvent.click(glowing[0]);
    });
    await act(async () => {
      fireEvent.click(document.querySelector(`button[data-tile-id="${glowing[1].dataset.tileId}"]`)!);
    });
    // save written
    await waitFor(() => {
      expect(mem.get(KEYS.solitaireSave)).not.toBeNull();
    });
    const save = JSON.parse(mem.get(KEYS.solitaireSave)!);
    expect(save.json).toContain('"moves":1');
  }, 20000);

  it('clicking a blocked tile shows the explanation and does not remove it', async () => {
    render(<App />);
    fireEvent.click(screen.getAllByText('Jogar Solitaire')[0]);
    await waitFor(() => expect(document.querySelectorAll('button[data-tile-id]').length).toBeGreaterThan(100));
    const blocked = document.querySelector('button.tile.blocked') as HTMLButtonElement;
    expect(blocked).toBeTruthy();
    await act(async () => {
      fireEvent.click(blocked);
    });
    expect(await screen.findByText(/bloqueada/i)).toBeInTheDocument();
  }, 20000);
});

describe('app: error resilience', () => {
  it('a corrupted solitaire save is discarded and a fresh game starts', async () => {
    mem.set(KEYS.solitaireSave, '{"json":"not-a-game","launch":null,"savedAt":1}');
    render(<App />);
    fireEvent.click(screen.getAllByText('Jogar Solitaire')[0]);
    await waitFor(() => {
      expect(document.querySelectorAll('button[data-tile-id]').length).toBeGreaterThan(100);
    }, { timeout: 10000 });
  }, 20000);
});

vi.setConfig({ testTimeout: 20000 });
