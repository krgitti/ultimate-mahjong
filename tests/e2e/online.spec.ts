import { test, expect } from '@playwright/test';
import { startServer } from '../../server/main';

const PORT = 8799;

test.describe('online multiplayer UI (two real browser clients)', () => {
  let server: ReturnType<typeof startServer>;

  test.beforeAll(async () => {
    server = startServer({ port: PORT });
  });
  test.afterAll(async () => {
    server.close();
  });

  test('create room, join from a second browser, start and see the table', async ({ browser, context }) => {
    await context.addInitScript((p: number) => localStorage.setItem('umo.online.port', String(p)), PORT);
    const pageA = await context.newPage();
    await pageA.goto('/#/online');
    await pageA.getByLabel(/Seu nome/).fill('Ana');
    await pageA.getByRole('button', { name: /Criar sala/ }).click();
    await expect(pageA.getByText(/Compartilhe o código/)).toBeVisible({ timeout: 10000 });
    const code = (await pageA.locator('h1.page-title').innerText()).replace('Sala ', '').trim();
    expect(code).toMatch(/^[A-Z2-9]{4}$/);

    const pageB = await context.newPage();
    await pageB.goto('/#/online');
    await pageB.getByLabel(/Seu nome/).fill('Beto');
    await pageB.getByPlaceholder(/Código da sala/).fill(code);
    await pageB.getByRole('button', { name: /Entrar na sala/ }).click();
    await expect(pageB.getByText(/Compartilhe o código/)).toBeVisible({ timeout: 10000 });

    // A sees Beto in the lobby
    await expect(pageA.getByText(/Beto/)).toBeVisible({ timeout: 10000 });

    // host starts; both land on the table with real hands
    await pageA.getByRole('button', { name: /Começar/ }).click();
    await expect(pageA.locator('.hand-row .hand-tile')).toHaveCount(14, { timeout: 15000 });
    await expect(pageB.locator('.hand-row .hand-tile')).toHaveCount(13, { timeout: 15000 });

    // dealer (Ana) discards through the UI; Beto sees the pond update (seat 0 pond is the last box)
    await pageA.locator('.hand-row .hand-tile:not([disabled])').first().click();
    await pageA.locator('.hand-row .hand-tile.selected').click();
    await expect(pageB.locator('.pond-box').last().locator('.mini-tile').first()).toBeVisible({ timeout: 10000 });

    await pageB.close();
    await pageA.close();
  });
});
