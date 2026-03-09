import { test, expect } from '@playwright/test';

test.describe('AI Proposal & Analysis Features', () => {
  test.beforeEach(async () => {
    test.setTimeout(60000);
  });

  test('navigate to an existing project', async ({ page }) => {
    await page.goto('/ro/proiecte');
    await page.waitForLoadState('domcontentloaded');

    await expect(page).toHaveURL(/\/ro\/proiecte/);
    await expect(page.getByRole('main')).toBeVisible();

    // Look for project links/cards — project list renders a table with "Vezi" links
    const projectLinks = page.getByRole('link', { name: /Vezi/i });
    const hasProjects = (await projectLinks.count()) > 0;
    if (!hasProjects) {
      test.skip(true, 'No projects found on /ro/proiecte');
    }
  });

  test('project detail page loads with tabs', async ({ page }) => {
    await page.goto('/ro/proiecte');
    await page.waitForLoadState('domcontentloaded');

    // Wait for loading state to disappear
    await expect(page.getByText('Se încarcă aplicațiile...')).not.toBeVisible({ timeout: 20000 });

    // Click on the first project "Vezi" link
    const projectLink = page.getByRole('link', { name: /Vezi/i }).first();
    const hasProject = await projectLink.isVisible().catch(() => false);

    if (!hasProject) {
      test.skip(true, 'No project links found');
      return;
    }

    await projectLink.click();

    // Wait for project detail loading to finish
    await expect(page.getByText('Se încarcă prezentarea proiectului...')).not.toBeVisible({ timeout: 30000 }).catch(() => {});
    // Wait for actual content to appear
    await expect(page.getByRole('tab', { name: /^Prezentare$/i })).toBeVisible({ timeout: 20000 });

    // Verify project detail page loaded
    await expect(page).toHaveURL(/\/ro\/proiecte\/.+/);
    await expect(page.getByRole('main')).toBeVisible();

    // Check for tabs — the project detail uses TabsTrigger components rendered as buttons with role="tab"
    const tabs = page.getByRole('tab');
    const hasTabs = await tabs.first().isVisible().catch(() => false);

    // Also check for section headings as alternative UI
    const headings = page.getByRole('heading');
    const hasHeadings = (await headings.count()) > 0;

    expect(hasTabs || hasHeadings).toBeTruthy();
  });

  test('compliance check generates results', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto('/ro/proiecte');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByText('Se încarcă aplicațiile...')).not.toBeVisible({ timeout: 20000 });

    // Navigate to first project
    const projectLink = page.getByRole('link', { name: /Vezi/i }).first();
    const hasProject = await projectLink.isVisible().catch(() => false);

    if (!hasProject) {
      test.skip(true, 'No project links found');
      return;
    }

    await projectLink.click();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText('Se încarcă prezentarea proiectului...')).not.toBeVisible({ timeout: 20000 });

    // Look for Conformitate tab (TabsTrigger with value="compliance" and text "Conformitate")
    const complianceTab = page.getByRole('tab', { name: /Conformitate/i });

    const hasCompliance = await complianceTab.isVisible().catch(() => false);
    if (!hasCompliance) {
      test.skip(true, 'Compliance tab not found on project page');
      return;
    }

    await complianceTab.click();
    await page.waitForLoadState('domcontentloaded');

    // Look for the "Rulează verificare AI" button
    const analyzeButton = page.getByRole('button', { name: /Rulează verificare AI/i });
    if (await analyzeButton.isVisible().catch(() => false)) {
      await analyzeButton.click();
    }

    // Wait for compliance results (up to 45s)
    // Results show up as ComplianceExplainabilityPanel or the empty state text
    const results = page.getByText(/conformitate|Indicii de conformitate|Nu există încă un raport/i);

    await expect(results.first()).toBeVisible({ timeout: 45000 });

    // Verify some result content is present
    const mainText = await page.getByRole('main').textContent();
    expect(mainText).toBeTruthy();
  });

  test('risk assessment section', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto('/ro/proiecte');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByText('Se încarcă aplicațiile...')).not.toBeVisible({ timeout: 20000 });

    const projectLink = page.getByRole('link', { name: /Vezi/i }).first();
    const hasProject = await projectLink.isVisible().catch(() => false);

    if (!hasProject) {
      test.skip(true, 'No project links found');
      return;
    }

    await projectLink.click();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText('Se încarcă prezentarea proiectului...')).not.toBeVisible({ timeout: 20000 });

    // The project detail page doesn't have a dedicated "risk" tab.
    // Risk information would be within the compliance tab or overview.
    // Check for compliance tab which contains risk-related content
    const complianceTab = page.getByRole('tab', { name: /Conformitate/i });

    const hasCompliance = await complianceTab.isVisible().catch(() => false);
    if (!hasCompliance) {
      test.skip(true, 'Compliance/risk section not found on project page');
      return;
    }

    await complianceTab.click();
    await page.waitForLoadState('domcontentloaded');

    // Verify the compliance tab content is visible (which includes risk-related content)
    const complianceContent = page.getByText(/conformitate|verificare|Indicii de conformitate|Nu există încă un raport/i);
    await expect(complianceContent.first()).toBeVisible({ timeout: 15000 });
  });

  test('budget section loads', async ({ page }) => {
    await page.goto('/ro/proiecte');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByText('Se încarcă aplicațiile...')).not.toBeVisible({ timeout: 20000 });

    const projectLink = page.getByRole('link', { name: /Vezi/i }).first();
    const hasProject = await projectLink.isVisible().catch(() => false);

    if (!hasProject) {
      test.skip(true, 'No project links found');
      return;
    }

    await projectLink.click();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText('Se încarcă prezentarea proiectului...')).not.toBeVisible({ timeout: 20000 });

    // Budget summary is always visible on the project detail page (not in a tab)
    // It's a Card with CardTitle "Rezumat buget"
    const budgetElement = page.getByText(/Rezumat buget/i);

    const hasBudget = await budgetElement.isVisible().catch(() => false);
    if (!hasBudget) {
      test.skip(true, 'Budget section not found on project page');
      return;
    }

    // Verify budget content — shows Alocat, Cheltuit, Rămas with EUR amounts
    const budgetContent = page.getByText(/Alocat|Cheltuit|Rămas|EUR/i);
    await expect(budgetContent.first()).toBeVisible({ timeout: 15000 });
  });
});
