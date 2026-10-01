/**
 * Convite por link (item 8.4): a URL carrega o código da sala em `?sala=CODE`
 * e a rota `#online`, então quem abrir o link cai direto no Multiplayer com o
 * código preenchido (e entra sozinho se já tiver um nome salvo na aba).
 */

export function inviteLink(base: string, code: string): string {
  const u = new URL(base);
  u.searchParams.set('sala', code);
  u.hash = '#online';
  return u.toString();
}

/** lê `?sala=CODE` de uma query string ('' quando ausente) */
export function roomFromSearch(search: string): string {
  return new URLSearchParams(search).get('sala') ?? '';
}

/**
 * Copia para a área de transferência. Usa a Clipboard API quando disponível
 * (contexto seguro) e cai no fallback de textarea+execCommand; devolve false
 * se nenhum caminho funcionar (a UI mostra o texto para cópia manual).
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* tenta o fallback */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
