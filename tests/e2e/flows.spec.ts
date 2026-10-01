import { test, expect } from '@playwright/test';
import fs from 'fs';

test.describe('Ultimate Mahjong Online — essential flows', () => {
  test('home renders and navigation works', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Bem-vindo à mesa')).toBeVisible();
    await page.getByRole('button', { name: 'Aprender', exact: true }).first().click();
    await expect(page.getByText(/Tutoriais interativos/i)).toBeVisible();
    await page.getByRole('button', { name: 'Estatísticas', exact: true }).first().click();
    await expect(page.getByText('Melhor pontuação')).toBeVisible();
    await page.getByRole('button', { name: 'Início', exact: true }).first().click();
    await expect(page.getByText('Bem-vindo à mesa')).toBeVisible();
  });

  test('solitaire: board renders, hint pair can be removed, counter updates', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Jogar Solitaire/ }).click();
    // board with 144 tiles
    await expect(page.locator('button[data-tile-id]')).toHaveCount(144, { timeout: 20000 });
    await expect(page.getByText('Pares:')).toContainText('72');
    // modo ampliado (mobile): tabuleiro vira navegável
    await page.getByRole('button', { name: /Ampliar tabuleiro/ }).click();
    await expect(page.locator('.board-wrap.scrollable')).toHaveCount(1);
    await page.getByRole('button', { name: /Ajustar tabuleiro/ }).click();
    await expect(page.locator('.board-wrap.scrollable')).toHaveCount(0);
    // ask for a hint and remove the highlighted pair
    await page.getByTitle(/Dica/).click();
    const glowing = page.locator('button.hint-glow');
    await expect(glowing).toHaveCount(2);
    const ids = await glowing.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.tileId));
    await page.locator(`button[data-tile-id="${ids[0]}"]`).click();
    await page.locator(`button[data-tile-id="${ids[1]}"]`).click();
    await expect(page.getByText('Pares:')).toContainText('71');
    await expect(page.locator('button[data-tile-id]')).toHaveCount(142);
    // undo restores
    await page.getByTitle(/Desfazer/).click();
    await expect(page.locator('button[data-tile-id]')).toHaveCount(144);
  });

  test('solitaire: exportar e assistir replay (item 10.2)', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Jogar Solitaire/ }).click();
    await expect(page.locator('button[data-tile-id]')).toHaveCount(144, { timeout: 20000 });

    // joga 2 pares com a dica
    for (let i = 0; i < 2; i++) {
      await page.getByTitle(/Dica/).click();
      const ids = await page
        .locator('button.hint-glow')
        .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.tileId));
      await page.locator(`button[data-tile-id="${ids[0]}"]`).click();
      await page.locator(`button[data-tile-id="${ids[1]}"]`).click();
    }
    await expect(page.getByText('Pares:')).toContainText('70');

    // exporta o replay (.json baixado)
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /⬇ Replay/ }).click(),
    ]);
    const file = '/tmp/sol-replay.json';
    await download.saveAs(file);
    const json = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(json.format).toBe('umo-replay-v1');
    expect(json.rulesetId).toBe('solitaire');
    expect(json.moves).toHaveLength(2);

    // assiste: tabuleiro reconstruído (144 peças) e passo a passo até o fim
    await page.getByRole('button', { name: /Assistir/ }).click();
    await page.locator('input[type=file]').setInputFiles(file);
    await expect(page.getByText(/Jogada 0\/2/)).toBeVisible({ timeout: 10000 });
    await expect(page.locator('button[data-tile-id]')).toHaveCount(144);
    await page.getByRole('button', { name: '⏭' }).click();
    await page.getByRole('button', { name: '⏭' }).click();
    await expect(page.getByText(/Jogada 2\/2/)).toBeVisible();
    await expect(page.locator('button[data-tile-id]')).toHaveCount(140);
    // sair volta ao jogo ao vivo, intacto
    await page.getByRole('button', { name: /Sair do replay/ }).click();
    await expect(page.getByText('Pares:')).toContainText('70');
  });

  test('traditional: hand starts, human discards, event log records it', async ({ page }) => {
    await page.goto('/#/traditional');
    // human hand has 14 tiles as dealer
    await expect(page.locator('.hand-row .hand-tile')).toHaveCount(14, { timeout: 15000 });
    const first = page.locator('.hand-row .hand-tile').first();
    await first.click(); // select
    await page.getByRole('button', { name: /Descartar/ }).click();
    // the discard appears in the human pond and the log grows
    await expect(page.locator('.pond-box').last().locator('.mini-tile').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.event-log div').first()).toBeVisible({ timeout: 15000 });
  });

  test('tutorial blocks a wrong move and guides the right one', async ({ page }) => {
    await page.goto('/#/learn');
    await page.getByRole('button', { name: /Tutorial de Solitaire/ }).click();
    await expect(page.getByText('Peças livres')).toBeVisible();
    // click a BLOCKED (but visible) tile -> coach explains, tile is not selected.
    // The red dragons sit on layer 0 with neighbours on both sides: blocked yet clickable.
    const blocked = page.locator('button.tile.blocked[aria-label*="Dragão Vermelho"]').first();
    await blocked.click();
    await expect(page.locator('.tut-blocked-msg')).toBeVisible();
    await expect(page.locator('button.tile.selected')).toHaveCount(0);
    // click a free tile -> step 1 completes and the coach advances to step 2
    const free = page.locator('button.tile.free').first();
    await free.click();
    await expect(page.getByText('Pares iguais')).toBeVisible();
  });

  test('traditional tutorial: full scripted playthrough to a TSUMO win', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/#/learn');
    await page.getByRole('button', { name: /Tutorial de Mahjong Tradicional/ }).click();
    await expect(page.getByText('Os naipes')).toBeVisible();

    // step 1: click one tile of each numbered suit
    await page.locator('.hand-tile[aria-label*="de Caracteres"]').first().click();
    await page.locator('.hand-tile[aria-label*="de Círculos"]').first().click();
    await page.locator('.hand-tile[aria-label*="de Bambus"]').first().click();
    await expect(page.getByText('Compra e descarte')).toBeVisible({ timeout: 10000 });

    // step 2: discard the 1-man
    await page.locator('.hand-tile[aria-label="1 de Caracteres"]').click();
    await page.getByRole('button', { name: /Descartar 1 de Caracteres/ }).click();

    // step 3: wait for bot discard, then call CHOW
    const chow = page.getByRole('button', { name: /Chow com/ });
    await expect(chow).toBeVisible({ timeout: 20000 });
    await chow.click();

    // step 4: discard the lone 5-sou
    await expect(page.getByRole('button', { name: /Descartar 5 de Bambus/ })).toBeVisible({ timeout: 10000 });
    await page.locator('.hand-tile[aria-label="5 de Bambus"]').first().click();
    await page.getByRole('button', { name: /Descartar 5 de Bambus/ }).click();

    // steps 5-6: opponents pass; we draw the winning 5-sou -> TSUMO
    const tsumo = page.getByRole('button', { name: /TSUMO/ });
    await expect(tsumo).toBeVisible({ timeout: 40000 });
    await tsumo.click();

    // step 7: scoring breakdown is shown
    await expect(page.getByText('Pontuação (fan)')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Simples (sem terminais/honras)', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Jogar partida completa/ })).toBeVisible();
  });

  test('PWA: manifest servido e válido (item 9.6)', async ({ page }) => {
    const res = await page.request.get('/manifest.webmanifest');
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.name).toBe('Ultimate Mahjong Online');
    expect(json.display).toBe('standalone');
    const sw = await page.request.get('/sw.js');
    expect(sw.status()).toBe(200);
    const icon = await page.request.get('/icon.svg');
    expect(icon.status()).toBe(200);
  });

  test('responsive: no horizontal overflow on a phone viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 720 });
    await page.goto('/');
    await expect(page.getByText('Bem-vindo à mesa')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(2);
    await page.goto('/#/solitaire');
    await expect(page.locator('button[data-tile-id]').first()).toBeVisible({ timeout: 20000 });
    const overflow2 = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow2).toBeLessThanOrEqual(2);
  });
});
