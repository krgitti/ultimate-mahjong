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

    // item 11.3: QR do convite gerado localmente (data URL, sem serviço externo)
    await pageA.getByRole('button', { name: /🔳 QR/ }).first().click();
    const qrImg = pageA.locator('img[alt*="QR"]');
    await expect(qrImg).toBeVisible({ timeout: 10000 });
    const src = await qrImg.getAttribute('src');
    expect(src?.startsWith('data:image/png')).toBe(true);
    await pageA.getByRole('button', { name: /Fechar QR/ }).click();
    await expect(qrImg).toHaveCount(0);

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

  test('item 11.4: espectador entra, conversa no chat e os jogadores recebem', async ({ context }) => {
    await context.addInitScript((p: number) => localStorage.setItem('umo.online.port', String(p)), PORT);

    // A cria a sala e começa (1 humano + 3 bots)
    const pageA = await context.newPage();
    await pageA.goto('/#/online');
    await pageA.getByLabel(/Seu nome/).fill('Host');
    await pageA.getByRole('button', { name: /Criar sala/ }).click();
    await expect(pageA.getByText(/Compartilhe o código/)).toBeVisible({ timeout: 10000 });
    const code = (await pageA.locator('h1.page-title').innerText()).replace('Sala ', '').trim();
    await pageA.getByRole('button', { name: /Começar/ }).click();
    await expect(pageA.locator('.hand-row .hand-tile')).toHaveCount(14, { timeout: 15000 });

    // B entra como espectador
    const pageB = await context.newPage();
    await pageB.goto('/#/online');
    await pageB.getByLabel(/Seu nome/).fill('Visitante');
    await pageB.getByPlaceholder(/Código da sala/).fill(code);
    await pageB.getByRole('button', { name: /Assistir/ }).click();
    // espectador vê a mesa (o input do chat só existe na visão da mesa)
    await expect(pageB.getByLabel('Mensagem do chat')).toBeVisible({ timeout: 15000 });

    // espectador manda mensagem e os dois lados veem com o selo 👁
    await pageB.getByLabel('Mensagem do chat').fill('boa mesa!');
    await pageB.getByRole('button', { name: 'Enviar' }).click();
    await expect(pageB.getByText('👁 Visitante')).toBeVisible({ timeout: 10000 });
    await expect(pageB.getByText('boa mesa!')).toBeVisible();
    await expect(pageA.getByText('👁 Visitante')).toBeVisible({ timeout: 10000 });
    await expect(pageA.getByText('boa mesa!')).toBeVisible();

    await pageB.close();
    await pageA.close();
  });
});
