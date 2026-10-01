import { test, expect, type Page } from '@playwright/test';
import { startServer } from '../../server/main';

const PORT = 8798;

/**
 * item 10.1: uma mão INTEIRA online por WebSocket, do começo ao placar.
 * 1 navegador humano + 3 bots do servidor (ticker 400 ms). O humano joga de
 * verdade pela UI: descarta peças legais e decide claims; o teste termina
 * quando o log da mesa registra o resultado da mão (vitória com fan/pontos
 * ou empate por muro esgotado). O painel de resultado é efêmero (a próxima
 * mão começa em ~6 s), por isso a âncora é o log.
 *
 * Importante: a mesa re-renderiza a cada broadcast (400 ms), então cliques
 * com verificação de estabilidade do Playwright esperariam até o timeout —
 * usamos cliques force com timeout curto e leituras de DOM via evaluate
 * (que não bloqueiam).
 */
test.describe('online: mão completa (item 10.1)', () => {
  let server: ReturnType<typeof startServer>;

  test.beforeAll(async () => {
    server = startServer({ port: PORT });
  });
  test.afterAll(async () => {
    server.close();
  });

  test('joga uma mão inteira pela UI até o placar', async ({ context }) => {
    test.setTimeout(300_000);
    await context.addInitScript((p: number) => localStorage.setItem('umo.online.port', String(p)), PORT);
    const page: Page = await context.newPage();
    page.setDefaultTimeout(4000);
    await page.goto('/#/online');

    await page.getByLabel(/Seu nome/).fill('Cara');
    await page.getByRole('button', { name: /Criar sala/ }).click();
    await expect(page.getByText(/Compartilhe o código/)).toBeVisible({ timeout: 10_000 });

    // 1 humano + 3 bots
    await page.getByRole('button', { name: /Começar/ }).click();
    await expect(page.locator('.hand-row .hand-tile')).toHaveCount(14, { timeout: 15_000 });

    const handDone = /venceu|Empate — muro esgotado/;
    const deadline = Date.now() + 240_000;
    let discards = 0;
    let done = false;

    /** lê o estado relevante da mesa de uma vez, sem esperas */
    const read = () =>
      page.evaluate(() => {
        const logs = document.querySelectorAll('.event-log');
        const log = logs.length ? (logs[logs.length - 1].textContent ?? '') : '';
        const vis = (el: Element) => !!(el as HTMLElement).offsetParent;
        const btns = [...document.querySelectorAll('button')].filter(vis);
        const text = (b: Element) => (b.textContent ?? '').trim();
        return {
          log,
          hasTsumo: btns.some((b) => text(b).includes('TSUMO')),
          hasPass: btns.some((b) => text(b) === 'Passar'),
          legalTiles: [...document.querySelectorAll('.hand-row .hand-tile')].filter(
            (el) => !(el as HTMLButtonElement).disabled
          ).length,
        };
      });

    const clickByText = (exact: string) =>
      page.evaluate((label) => {
        const btn = [...document.querySelectorAll('button')].find(
          (b) => (b.textContent ?? '').trim() === label && !!(b as HTMLElement).offsetParent
        );
        if (btn) (btn as HTMLButtonElement).click();
      }, exact);

    const clickLegalTile = () =>
      page.evaluate(() => {
        const legal = [...document.querySelectorAll('.hand-row .hand-tile')].filter(
          (el) => !(el as HTMLButtonElement).disabled
        );
        if (legal.length) (legal[0] as HTMLButtonElement).click();
      });

    while (Date.now() < deadline) {
      const st = await read();
      if (handDone.test(st.log)) {
        done = true;
        break;
      }
      // claims: aceitar vitória própria, passar no resto
      if (st.hasTsumo) {
        await clickByText('🏆 TSUMO!');
      } else if (st.hasPass) {
        await clickByText('Passar');
      } else if (st.legalTiles > 0) {
        // vez do humano: seleciona e descarta a primeira peça legal
        await clickLegalTile();
        await page.waitForTimeout(100);
        const sel = page.locator('.hand-row .hand-tile.selected');
        if ((await sel.count()) > 0) {
          await sel.first().click({ force: true, timeout: 2000 }).catch(() => undefined);
          discards++;
        }
      }
      await page.waitForTimeout(220);
    }

    // a mão terminou com um resultado real (vitória OU muro esgotado)
    expect(done).toBe(true);
    const log = await page.locator('.event-log').last().innerText();
    expect(log).toMatch(handDone);
    expect(log).toMatch(/draw/);
    expect(log).toMatch(/discard/);
    // o humano descartou de verdade durante a mão (dealer: >= 1 descarte)
    expect(discards).toBeGreaterThan(0);

    await page.close();
  });
});
