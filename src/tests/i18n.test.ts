import { describe, it, expect, afterEach } from 'vitest';
import { t, setLang, getLang, isLang } from '../i18n';
import { pt } from '../i18n/pt';
import { en } from '../i18n/en';
import { es } from '../i18n/es';

describe('item 8e — i18n', () => {
  afterEach(() => setLang('pt'));

  it('dicionários EN e ES têm exatamente as mesmas chaves do PT', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(pt).sort());
    expect(Object.keys(es).sort()).toEqual(Object.keys(pt).sort());
  });

  it('traduz no idioma ativo e volta ao PT como padrão', () => {
    expect(getLang()).toBe('pt');
    expect(t('nav.home')).toBe('Início');
    setLang('en');
    expect(t('nav.home')).toBe('Home');
    setLang('es');
    expect(t('nav.home')).toBe('Inicio');
    setLang('pt');
    expect(t('nav.home')).toBe('Início');
  });

  it('idioma inválido cai em PT; chave inexistente devolve a própria chave', () => {
    setLang('xx' as never);
    expect(getLang()).toBe('pt');
    expect(t('chave.que.nao.existe')).toBe('chave.que.nao.existe');
  });

  it('interpola variáveis {nome}', () => {
    setLang('en');
    expect(t('on.seasonEnded', { season: '2026-09', elo: 1680 })).toContain('2026-09');
    expect(t('on.seasonEnded', { season: '2026-09', elo: 1680 })).toContain('1680');
    expect(t('home.c2m', { a: 3, b: 7 })).toBe('3/7 hands won');
  });

  it('isLang valida os cinco idiomas', () => {
    expect(isLang('pt')).toBe(true);
    expect(isLang('en')).toBe(true);
    expect(isLang('es')).toBe(true);
    expect(isLang(null)).toBe(false);
  });
});
