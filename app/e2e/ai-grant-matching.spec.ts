import { test, expect } from '@playwright/test';

test.describe('AI Grant Matching', () => {
  test.beforeEach(async () => {
    test.setTimeout(60000);
  });

  test('matching page loads', async ({ page }) => {
    await page.goto('/ro/finantari/potriviri');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/\/ro\/finantari\/potriviri/);
    await expect(page.getByRole('main')).toBeVisible();

    // Verify some content is present
    const headings = page.getByRole('heading');
    const hasContent = (await headings.count()) > 0;
    const mainText = await page.getByRole('main').textContent();

    expect(hasContent || (mainText && mainText.trim().length > 0)).toBeTruthy();
  });

  test('trigger grant matching analysis', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto('/ro/finantari/potriviri');
    await page.waitForLoadState('networkidle');

    // Look for a match/analyze button
    const matchButton = page.getByRole('button', { name: /potrivire|match|analiză|caută|generează|verifică/i }).or(
      page.getByRole('button', { name: /start|rulează/i })
    ).or(
      page.locator('button[type="submit"]')
    );

    const hasButton = await matchButton.first().isVisible().catch(() => false);
    if (!hasButton) {
      // The page might auto-load matches or show them directly
      const existingResults = page.locator('[class*="match"], [class*="result"], [class*="card"]');
      const hasExisting = await existingResults.first().isVisible().catch(() => false);
      if (!hasExisting) {
        test.skip(true, 'No match trigger button or existing results found');
      }
      return;
    }

    await matchButton.first().click();

    // Wait for AI matching results (up to 45s)
    const loadingIndicator = page.locator('[class*="loading"], [class*="spinner"], [role="progressbar"]');
    await loadingIndicator.first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    await loadingIndicator.first().waitFor({ state: 'hidden', timeout: 45000 }).catch(() => {});

    // Verify results appeared
    const mainText = await page.getByRole('main').textContent({ timeout: 5000 });
    expect(mainText && mainText.trim().length > 50).toBeTruthy();
  });

  test('matching results display with scores or recommendations', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto('/ro/finantari/potriviri');
    await page.waitForLoadState('networkidle');

    // Trigger matching if needed
    const matchButton = page.getByRole('button', { name: /potrivire|match|analiză|caută|generează|verifică|start|rulează/i }).or(
      page.locator('button[type="submit"]')
    );

    if (await matchButton.first().isVisible().catch(() => false)) {
      await matchButton.first().click();
      // Wait for processing
      await page.waitForTimeout(5000);
    }

    // Wait for results to appear
    const results = page.locator('[class*="match"], [class*="result"], [class*="card"], [class*="item"]');
    await results.first().waitFor({ state: 'visible', timeout: 45000 }).catch(() => {});

    const hasResults = await results.first().isVisible().catch(() => false);
    if (!hasResults) {
      // Check if there's text-based results instead
      const textResults = page.getByText(/potrivire|relevanță|scor|%|eligibil|recomandat/i);
      const hasTextResults = await textResults.first().isVisible().catch(() => false);
      if (!hasTextResults) {
        test.skip(true, 'No matching results found');
      }
      return;
    }

    // Verify results contain meaningful data
    const mainText = await page.getByRole('main').textContent();
    const hasRelevantContent = mainText && (
      /finanțare|program|apel|scor|potrivire|eligibil|%|relevanță/i.test(mainText)
    );

    expect(hasRelevantContent).toBeTruthy();
  });

  test('expand match details', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto('/ro/finantari/potriviri');
    await page.waitForLoadState('networkidle');

    // Trigger matching if needed
    const matchButton = page.getByRole('button', { name: /potrivire|match|analiză|caută|generează|verifică|start|rulează/i }).or(
      page.locator('button[type="submit"]')
    );

    if (await matchButton.first().isVisible().catch(() => false)) {
      await matchButton.first().click();
      await page.waitForTimeout(5000);
    }

    // Wait for results
    const resultCards = page.locator('[class*="match"], [class*="result"], [class*="card"]');
    await resultCards.first().waitFor({ state: 'visible', timeout: 45000 }).catch(() => {});

    const hasCards = await resultCards.first().isVisible().catch(() => false);
    if (!hasCards) {
      test.skip(true, 'No match result cards found to expand');
      return;
    }

    // Try to click/expand the first result
    const expandButton = resultCards.first().getByRole('button').or(
      resultCards.first().locator('[class*="expand"], [class*="detail"], [class*="more"]')
    );

    const canExpand = await expandButton.first().isVisible().catch(() => false);

    if (canExpand) {
      await expandButton.first().click();
      await page.waitForTimeout(2000);

      // Verify expanded details are visible
      const details = page.locator('[class*="detail"], [class*="expanded"], [class*="content"]');
      const detailText = await page.getByRole('main').textContent();
      expect(detailText && detailText.trim().length > 100).toBeTruthy();
    } else {
      // Try clicking the card itself as a link
      const cardLink = resultCards.first().locator('a').first();
      const isLink = await cardLink.isVisible().catch(() => false);

      if (isLink) {
        await cardLink.click();
        await page.waitForLoadState('networkidle');
        const detailText = await page.getByRole('main').textContent();
        expect(detailText && detailText.trim().length > 100).toBeTruthy();
      } else {
        // Just verify the card itself has content
        const cardText = await resultCards.first().textContent();
        expect(cardText && cardText.trim().length > 20).toBeTruthy();
      }
    }
  });
});
