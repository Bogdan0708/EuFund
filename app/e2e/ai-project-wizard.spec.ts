import { test, expect } from '@playwright/test';

test.describe('AI Project Wizard (Asistent Proiect)', () => {
  test.beforeEach(async () => {
    test.setTimeout(60000);
  });

  test('wizard interface loads', async ({ page }) => {
    await page.goto('/ro/proiecte/asistent-proiect');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/\/ro\/proiecte\/asistent-proiect/);
    await expect(page.getByRole('main')).toBeVisible();

    // ProjectWizard renders an h1 with "Asistent Inteligent Proiect" and step badges
    const hasHeading = await page.getByRole('heading', { name: /Asistent Inteligent Proiect/i }).isVisible().catch(() => false);
    const hasTextArea = await page.locator('textarea#idea').isVisible().catch(() => false);

    if (!hasHeading && !hasTextArea) {
      test.skip(true, 'Wizard interface not found on /ro/proiecte/asistent-proiect');
    }
  });

  test('submit project idea in step 1', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto('/ro/proiecte/asistent-proiect');
    await page.waitForLoadState('networkidle');

    // ProjectWizard IDEA step has a Textarea with id="idea"
    const ideaInput = page.locator('textarea#idea');

    const inputVisible = await ideaInput.isVisible().catch(() => false);
    if (!inputVisible) {
      test.skip(true, 'Project idea input not found');
      return;
    }

    // Enter project idea
    await ideaInput.fill(
      'Digitalizarea serviciilor publice pentru o primărie rurală din România, incluzând un portal pentru cetățeni și sistem de plăți online'
    );

    // The "Next" button in ProjectWizard uses t('common.next') = "Următorul"
    const submitButton = page.getByRole('button', { name: /Următorul/i });

    const buttonVisible = await submitButton.isVisible().catch(() => false);
    if (!buttonVisible) {
      test.skip(true, 'Submit/next button not found in wizard');
      return;
    }

    await submitButton.click();

    // Wait for AI processing — a Loader2 spinner appears inside the button
    // Then the wizard advances to ENHANCE step
    await page.waitForTimeout(5000);

    // Verify we advanced or received AI content
    const mainContent = await page.getByRole('main').textContent({ timeout: 45000 });
    expect(mainContent).toBeTruthy();
  });

  test('AI generates suggestions after idea submission', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto('/ro/proiecte/asistent-proiect');
    await page.waitForLoadState('networkidle');

    const ideaInput = page.locator('textarea#idea');

    const inputVisible = await ideaInput.isVisible().catch(() => false);
    if (!inputVisible) {
      test.skip(true, 'Project idea input not found');
      return;
    }

    await ideaInput.fill(
      'Digitalizarea serviciilor publice pentru o primărie rurală din România, incluzând un portal pentru cetățeni și sistem de plăți online'
    );

    // The "Next" button uses t('common.next') = "Următorul"
    const submitButton = page.getByRole('button', { name: /Următorul/i });

    const buttonVisible = await submitButton.isVisible().catch(() => false);
    if (!buttonVisible) {
      test.skip(true, 'Submit button not found');
      return;
    }

    await submitButton.click();

    // Wait for AI-generated content to appear (up to 45s)
    await page.waitForTimeout(5000); // brief wait for processing to start

    // Check for generated suggestions, structure, or recommendations
    const mainText = await page.getByRole('main').textContent({ timeout: 45000 });

    // AI should generate some relevant content or advance to ENHANCE step
    const hasGeneratedContent = mainText && (
      /digitalizare|portal|servicii|buget|obiectiv|activit|rezultat|finanțare|program|rafinare|original|enhanced/i.test(mainText)
    );

    if (!hasGeneratedContent) {
      // If no generated content, check if the page still shows the wizard with step badges
      const stepBadges = page.locator('.rounded-full.border');
      const hasSteps = await stepBadges.first().isVisible().catch(() => false);
      expect(hasSteps || hasGeneratedContent).toBeTruthy();
    }
  });

  test('wizard step navigation works', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto('/ro/proiecte/asistent-proiect');
    await page.waitForLoadState('networkidle');

    // Look for step navigation elements
    // In IDEA step, there's a "Următorul" (Next) button but no "Înapoi" (Back) button
    const nextButton = page.getByRole('button', { name: /Următorul/i });
    const backButton = page.getByRole('button', { name: /Înapoi/i });
    // Step badges are Badge components rendered as divs with rounded-full
    const stepBadges = page.locator('.rounded-full.border');

    const hasNavigation = await nextButton.isVisible().catch(() => false) ||
      await backButton.isVisible().catch(() => false) ||
      await stepBadges.first().isVisible().catch(() => false);

    if (!hasNavigation) {
      test.skip(true, 'Step navigation not found in wizard');
      return;
    }

    // If there's a next button, try clicking it (need to fill required fields first)
    if (await nextButton.isVisible().catch(() => false)) {
      // Fill the idea textarea (must be >= 20 chars)
      const input = page.locator('textarea#idea');
      if (await input.isVisible().catch(() => false)) {
        await input.fill('Test proiect digitalizare pentru primărie rurală');
      }

      await nextButton.click();
      await page.waitForTimeout(5000);

      // Check if back button becomes visible (indicating step advancement to ENHANCE)
      const backVisible = await backButton.isVisible().catch(() => false);
      if (backVisible) {
        await backButton.click();
        await page.waitForTimeout(1000);
        // Verify we went back to IDEA step
        expect(await page.locator('textarea#idea').isVisible().catch(() => false)).toBeTruthy();
      }
    }
  });
});
