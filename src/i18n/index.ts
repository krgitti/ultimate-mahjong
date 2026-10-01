/**
 * i18n leve (item 8.5): dicionários PT/EN/ES com fallback para PT.
 * Sem dependências — `t(key, vars)` resolve no render; trocar o idioma
 * chama setLang() e o App re-renderiza (settings.language persistido).
 */
import { pt } from './pt';
import { en } from './en';
import { es } from './es';
import { fr } from './fr';
import { de } from './de';

export type Lang = 'pt' | 'en' | 'es' | 'fr' | 'de';

const DICTS: Record<Lang, Record<string, string>> = { pt, en, es, fr, de };

let current: Lang = 'pt';

export function setLang(l: Lang): void {
  current = l in DICTS ? l : 'pt';
}

export function getLang(): Lang {
  return current;
}

export function isLang(v: unknown): v is Lang {
  return v === 'pt' || v === 'en' || v === 'es' || v === 'fr' || v === 'de';
}

/** traduz `key` no idioma atual; fallback PT; interpola {vars} */
export function t(key: string, vars?: Record<string, string | number>): string {
  let s = DICTS[current][key] ?? DICTS.pt[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  }
  return s;
}

/** nomes exibidos dos idiomas (para o seletor) */
export const LANG_LABELS: Record<Lang, string> = {
  pt: 'Português',
  en: 'English',
  fr: 'Français',
  de: 'Deutsch',
  es: 'Español',
};
