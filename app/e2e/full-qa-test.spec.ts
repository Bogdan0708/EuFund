import { test, expect, Page } from '@playwright/test';

const SCREENSHOT_DIR = 'e2e/screenshots/full-qa';
const consoleErrors: string[] = [];
const networkErrors: string[] = [];

/** Helper: take a named screenshot */
async function snap(page: Page, name: string) {
  await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png`, fullPage: true });
}

/** Helper: collect console errors */
function setupConsoleCapture(page: Page) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(`[${new Date().toISOString()}] ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => {
    consoleErrors.push(`[PAGE ERROR] ${err.message}`);
  });
  page.on('requestfailed', (req) => {
    networkErrors.push(`[NETWORK FAIL] ${req.method()} ${req.url()} - ${req.failure()?.errorText}`);
  });
}

/** Helper: wait for page to settle */
async function settle(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(500);
}

/** Helper: click a button safely and log failures */
async function safeClick(page: Page, selector: string, label: string): Promise<boolean> {
  try {
    const el = page.locator(selector).first();
    if (await el.isVisible({ timeout: 2000 })) {
      await el.click({ timeout: 3000 });
      await settle(page);
      return true;
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    consoleErrors.push(`[CLICK FAIL] ${label}: ${msg}`);
  }
  return false;
}

test.describe('Full QA: Every Page & Button', () => {
  test.setTimeout(300_000); // 5 minutes for the full suite

  test('01 - Login page renders correctly', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    setupConsoleCapture(page);

    await page.goto('/ro/autentificare');
    await settle(page);
    await snap(page, '01-login-page');

    // Check key elements
    await expect(page.locator('input[placeholder="Email"]')).toBeVisible();
    await expect(page.locator('input[placeholder="Password"]')).toBeVisible();
    await expect(page.locator('button:has-text("Dev Sign In")')).toBeVisible();

    // Check OAuth buttons if present
    const oauthButtons = page.locator('button:has-text("Continue with")');
    const oauthCount = await oauthButtons.count();
    await snap(page, '01-login-oauth-buttons');

    await ctx.close();
  });

  test('02 - Dashboard page loads and renders', async ({ page }) => {
    setupConsoleCapture(page);

    await page.goto('/ro/panou');
    await settle(page);
    await snap(page, '02-dashboard-full');

    // Check heading
    const heading = page.getByRole('heading').first();
    await expect(heading).toBeVisible({ timeout: 10_000 });

    // Check sidebar nav
    await snap(page, '02-dashboard-nav');

    // Check for any error states
    const errorText = page.locator('text=/error|500|Internal Server/i');
    const errorCount = await errorText.count();
    if (errorCount > 0) {
      consoleErrors.push(`[UI ERROR] Dashboard shows error text`);
    }
  });

  test('03 - Dashboard buttons and interactions', async ({ page }) => {
    setupConsoleCapture(page);

    await page.goto('/ro/panou');
    await settle(page);

    // Test hero search input
    const searchInput = page.locator('input[type="text"], input[type="search"]').first();
    if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await searchInput.fill('test project idea');
      await snap(page, '03-dashboard-search-filled');
    }

    // Click all visible buttons on dashboard
    const buttons = page.locator('button, a[href]');
    const btnCount = await buttons.count();
    const clickedButtons: string[] = [];

    for (let i = 0; i < Math.min(btnCount, 30); i++) {
      const btn = buttons.nth(i);
      const text = await btn.textContent().catch(() => '');
      const href = await btn.getAttribute('href').catch(() => '');
      const isVisible = await btn.isVisible().catch(() => false);

      if (isVisible && text) {
        clickedButtons.push(`${text?.trim().substring(0, 40)} (${href || 'button'})`);
      }
    }

    await snap(page, '03-dashboard-buttons-inventory');
    console.log('Dashboard buttons found:', JSON.stringify(clickedButtons, null, 2));
  });

  test('04 - Navigate to Projects page', async ({ page }) => {
    setupConsoleCapture(page);

    await page.goto('/ro/proiecte');
    await settle(page);
    await snap(page, '04-projects-list');

    // Check main heading
    const heading = page.getByRole('heading').first();
    await expect(heading).toBeVisible({ timeout: 10_000 });

    // Check for project cards or empty state
    const projectCards = page.locator('[class*="card"], [class*="Card"]');
    const cardCount = await projectCards.count();
    console.log(`Projects page: ${cardCount} cards found`);

    // Check search/filter
    const searchInput = page.locator('input[type="text"], input[type="search"], input[placeholder*="Caut"]');
    if (await searchInput.first().isVisible({ timeout: 2000 }).catch(() => false)) {
      await searchInput.first().fill('test search');
      await settle(page);
      await snap(page, '04-projects-search');
    }

    // Click filter chips
    const chips = page.locator('button:has-text("Toate"), button:has-text("În lucru"), button:has-text("Depuse"), button:has-text("Aprobate")');
    for (let i = 0; i < await chips.count(); i++) {
      await chips.nth(i).click().catch(() => {});
      await page.waitForTimeout(300);
    }
    await snap(page, '04-projects-filtered');

    // Click "Create Project" button
    await safeClick(page, 'a[href*="asistent-ai"], button:has-text("Proiect"), button:has-text("Crează")', 'Create Project button');
    await snap(page, '04-projects-create-btn');
  });

  test('05 - Navigate to Documents page', async ({ page }) => {
    setupConsoleCapture(page);

    await page.goto('/ro/documente');
    await settle(page);
    await snap(page, '05-documents-full');

    const heading = page.getByRole('heading').first();
    await expect(heading).toBeVisible({ timeout: 10_000 });

    // Check search
    const searchInput = page.locator('input[type="text"], input[type="search"]').first();
    if (await searchInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await searchInput.fill('document search');
      await settle(page);
      await snap(page, '05-documents-search');
    }

    // Click filter chips
    const chips = page.locator('button:has-text("Toate"), button:has-text("Recente"), button:has-text("Distribuite"), button:has-text("Arhivate")');
    for (let i = 0; i < await chips.count(); i++) {
      await chips.nth(i).click().catch(() => {});
      await page.waitForTimeout(300);
    }
    await snap(page, '05-documents-filtered');

    // Check for file cards
    const fileCards = page.locator('[class*="card"], [class*="Card"]');
    console.log(`Documents page: ${await fileCards.count()} cards found`);
  });

  test('06 - Navigate to AI Assistant page', async ({ page }) => {
    setupConsoleCapture(page);

    await page.goto('/ro/asistent-ai');
    await settle(page);
    await snap(page, '06-ai-assistant-initial');

    // Check step progress bar
    const stepIndicator = page.locator('text=/Pas|Step|1.*7/i');
    const progressBar = page.locator('[class*="step"], [class*="progress"], [class*="Step"]');
    await snap(page, '06-ai-step-progress');

    // Check chat input
    const chatInput = page.locator('textarea, input[type="text"]').last();
    if (await chatInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await chatInput.fill('Test message');
      await snap(page, '06-ai-chat-input');
    }

    // Check canvas tabs
    const callsTab = page.locator('button:has-text("Calls"), button:has-text("Apeluri")');
    const planTab = page.locator('button:has-text("Plan")');
    const proposalTab = page.locator('button:has-text("Proposal"), button:has-text("Propunere")');

    if (await callsTab.isVisible({ timeout: 2000 }).catch(() => false)) {
      await callsTab.click();
      await snap(page, '06-ai-calls-tab');
    }
    if (await planTab.isVisible({ timeout: 2000 }).catch(() => false)) {
      await planTab.click();
      await snap(page, '06-ai-plan-tab');
    }
    if (await proposalTab.isVisible({ timeout: 2000 }).catch(() => false)) {
      await proposalTab.click();
      await snap(page, '06-ai-proposal-tab');
    }

    // Check new session button
    await safeClick(page, 'button:has-text("Sesiune"), button:has-text("New Session"), button[aria-label*="new"]', 'New Session');
    await snap(page, '06-ai-new-session');
  });

  test('07 - Navigate to Settings page', async ({ page }) => {
    setupConsoleCapture(page);

    await page.goto('/ro/setari');
    await settle(page);
    await snap(page, '07-settings-full');

    const heading = page.getByRole('heading').first();
    await expect(heading).toBeVisible({ timeout: 10_000 });

    // Check language switcher
    const langButtons = page.locator('button:has-text("RO"), button:has-text("EN")');
    for (let i = 0; i < await langButtons.count(); i++) {
      const btn = langButtons.nth(i);
      if (await btn.isVisible().catch(() => false)) {
        console.log(`Lang button: ${await btn.textContent()}`);
      }
    }

    // Check model dropdown
    const modelSelect = page.locator('select, [role="combobox"], [class*="select"]').first();
    if (await modelSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
      await snap(page, '07-settings-model-select');
    }

    // Check toggles
    const toggles = page.locator('button[role="switch"], input[type="checkbox"]');
    const toggleCount = await toggles.count();
    console.log(`Settings toggles: ${toggleCount}`);

    // Test save button
    await safeClick(page, 'button:has-text("Salvează"), button:has-text("Save")', 'Save settings');
    await snap(page, '07-settings-save');

    // Check billing button
    await safeClick(page, 'button:has-text("Billing"), button:has-text("Facturare"), a[href*="billing"]', 'Manage Billing');
    await snap(page, '07-settings-billing');
  });

  test('08 - Sidebar navigation tests', async ({ page }) => {
    setupConsoleCapture(page);

    await page.goto('/ro/panou');
    await settle(page);

    // Click each sidebar link
    const navLinks = [
      { selector: 'a[href*="/panou"]', name: 'Home/Dashboard' },
      { selector: 'a[href*="/proiecte"]', name: 'Projects' },
      { selector: 'a[href*="/documente"]', name: 'Documents' },
      { selector: 'a[href*="/asistent-ai"]', name: 'AI Assistant' },
      { selector: 'a[href*="/setari"]', name: 'Settings' },
    ];

    for (const link of navLinks) {
      await page.goto('/ro/panou');
      await settle(page);

      const el = page.locator(link.selector).first();
      if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
        await el.click();
        await settle(page);
        await snap(page, `08-nav-${link.name.toLowerCase().replace(/\s/g, '-')}`);
        console.log(`Nav to ${link.name}: ${page.url()}`);
      } else {
        consoleErrors.push(`[NAV FAIL] ${link.name} link not visible`);
      }
    }

    // Test sidebar collapse
    const collapseBtn = page.locator('button[aria-label*="collapse"], button[aria-label*="Restrânge"], button:has-text("«")');
    if (await collapseBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await collapseBtn.click();
      await settle(page);
      await snap(page, '08-sidebar-collapsed');
    }
  });

  test('09 - Command Palette (Cmd+K)', async ({ page }) => {
    setupConsoleCapture(page);

    await page.goto('/ro/panou');
    await settle(page);

    // Open command palette
    await page.keyboard.press('Meta+k');
    await page.waitForTimeout(500);
    await snap(page, '09-command-palette-open');

    // Check if it opened
    const palette = page.locator('[role="dialog"], [class*="command"], [class*="palette"]');
    if (await palette.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Type in search
      await page.keyboard.type('proiecte');
      await page.waitForTimeout(300);
      await snap(page, '09-command-palette-search');

      // Press escape to close
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    } else {
      // Try Ctrl+K for Linux
      await page.keyboard.press('Control+k');
      await page.waitForTimeout(500);
      await snap(page, '09-command-palette-ctrl-k');
    }
  });

  test('10 - Notifications panel', async ({ page }) => {
    setupConsoleCapture(page);

    await page.goto('/ro/panou');
    await settle(page);

    // Click bell icon
    const bellBtn = page.locator('button:has-text("notification"), button[aria-label*="notif"], [class*="notification"] button, button:has([class*="bell"])');
    if (await bellBtn.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await bellBtn.first().click();
      await page.waitForTimeout(500);
      await snap(page, '10-notifications-open');
    }

    // Also try the icon-based button
    const iconBtns = page.locator('button').filter({ has: page.locator('span:has-text("notifications")') });
    if (await iconBtns.first().isVisible({ timeout: 2000 }).catch(() => false)) {
      await iconBtns.first().click();
      await page.waitForTimeout(500);
      await snap(page, '10-notifications-icon');
    }
  });

  test('11 - English locale test', async ({ page }) => {
    setupConsoleCapture(page);

    for (const path of ['/en/panou', '/en/proiecte', '/en/asistent-ai']) {
      await page.goto(path).catch(() => {});
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(1000);
      await snap(page, `11-english-${path.split('/').pop()}`);
    }
  });

  test('12 - 404 page test', async ({ page }) => {
    setupConsoleCapture(page);

    await page.goto('/ro/pagina-inexistenta');
    await settle(page);
    await snap(page, '12-404-page');

    // Should show not found content
    const notFound = page.locator('text=/404|nu a fost găsită|not found/i');
    const isNotFoundVisible = await notFound.isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`404 page shows not-found content: ${isNotFoundVisible}`);
  });

  test('13 - API health checks', async ({ page }) => {
    setupConsoleCapture(page);

    // Health endpoint
    const healthRes = await page.request.get('/api/health').catch(() => null);
    console.log(`/api/health: ${healthRes?.status()}`);

    // Sessions endpoint
    const sessionsRes = await page.request.get('/api/ai/orchestrator/sessions').catch(() => null);
    console.log(`/api/ai/orchestrator/sessions: ${sessionsRes?.status()}`);

    // Projects endpoint
    const projectsRes = await page.request.get('/api/v1/projects').catch(() => null);
    console.log(`/api/v1/projects: ${projectsRes?.status()}`);

    // Organizations endpoint
    const orgsRes = await page.request.get('/api/v1/organizations').catch(() => null);
    console.log(`/api/v1/organizations: ${orgsRes?.status()}`);
  });
});

test.describe('Full QA: Project Creation Flow (7 Phases)', () => {
  test.setTimeout(600_000); // 10 minutes for full AI flow

  test('14 - Start new project via AI Assistant', async ({ page }) => {
    setupConsoleCapture(page);

    // Navigate to AI assistant
    await page.goto('/ro/asistent-ai');
    await settle(page);
    await snap(page, '14-ai-start');

    // Find and fill chat input
    const chatInput = page.locator('textarea, input[type="text"]').last();
    await expect(chatInput).toBeVisible({ timeout: 10_000 });

    // Type a project idea
    const projectIdea = 'Vreau să creez un proiect de digitalizare a serviciilor publice locale din județul Timiș, cu un buget estimat de 500.000 EUR, care să vizeze transformarea digitală a primăriilor din mediul rural prin implementarea de platforme online pentru servicii cetățenești.';

    await chatInput.fill(projectIdea);
    await snap(page, '14-ai-idea-typed');

    // Submit the idea
    const sendBtn = page.locator('button[type="submit"], button:has-text("Trimite"), button:has([class*="send"]), button[aria-label*="send"]');
    if (await sendBtn.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await sendBtn.first().click();
    } else {
      // Try pressing Enter
      await chatInput.press('Enter');
    }
    await snap(page, '14-ai-idea-submitted');

    // Wait for Phase 1 (Enhance Idea) to process
    console.log('Waiting for Phase 1: Enhance Idea...');
    await page.waitForTimeout(5_000);
    await snap(page, '14-phase1-processing');

    // Wait for step indicators to update
    await page.waitForTimeout(10_000);
    await snap(page, '14-phase1-complete');

    // Check for any AI responses
    const aiMessages = page.locator('[class*="message"], [class*="chat"], [class*="assistant"]');
    const msgCount = await aiMessages.count();
    console.log(`AI messages visible: ${msgCount}`);

    // Wait for Phase 2 (Match Calls) - this should show a checkpoint
    console.log('Waiting for Phase 2: Match Calls...');
    await page.waitForTimeout(15_000);
    await snap(page, '14-phase2-matching');

    // Look for checkpoint UI (call selection)
    const checkpointOptions = page.locator('button[class*="checkpoint"], [class*="option"], [class*="select"]');
    const optionCount = await checkpointOptions.count();
    console.log(`Checkpoint options visible: ${optionCount}`);

    // Check for matched calls in canvas
    const callsTab = page.locator('button:has-text("Calls"), button:has-text("Apeluri")');
    if (await callsTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await callsTab.click();
      await page.waitForTimeout(500);
      await snap(page, '14-phase2-calls-tab');
    }

    // Try to select a call if options appear
    await page.waitForTimeout(10_000);
    await snap(page, '14-phase2-checkpoint');

    // Look for clickable call options
    const callOptions = page.locator('[class*="call"] button, [class*="match"] button, button:has-text("Selectează"), button:has-text("Select")');
    if (await callOptions.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      await callOptions.first().click();
      console.log('Selected first matched call');
      await snap(page, '14-phase2-call-selected');
    } else {
      // Check if there's a different UI for selection
      const anyClickable = page.locator('[role="button"], [class*="clickable"], [class*="select"]');
      console.log(`Other clickable elements: ${await anyClickable.count()}`);
      await snap(page, '14-phase2-no-options');
    }

    // Wait for Phase 3-5 (auto-run: Validate → Research → Knowledge)
    console.log('Waiting for Phases 3-5...');
    await page.waitForTimeout(20_000);
    await snap(page, '14-phase3-5-progress');

    // Check canvas for plan tab
    const planTab = page.locator('button:has-text("Plan")');
    if (await planTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await planTab.click();
      await page.waitForTimeout(500);
      await snap(page, '14-phase6-plan-tab');
    }

    // Wait for Phase 6 (Action Plan) checkpoint
    console.log('Waiting for Phase 6: Action Plan...');
    await page.waitForTimeout(15_000);
    await snap(page, '14-phase6-checkpoint');

    // Look for confirm button
    const confirmBtn = page.locator('button:has-text("Continuă"), button:has-text("Continue"), button:has-text("Confirm")');
    if (await confirmBtn.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      await confirmBtn.first().click();
      console.log('Confirmed action plan');
      await snap(page, '14-phase6-confirmed');
    }

    // Wait for Phase 7 (Build Project)
    console.log('Waiting for Phase 7: Build Project...');
    await page.waitForTimeout(30_000);
    await snap(page, '14-phase7-building');

    // Check proposal tab
    const proposalTab = page.locator('button:has-text("Proposal"), button:has-text("Propunere")');
    if (await proposalTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await proposalTab.click();
      await page.waitForTimeout(500);
      await snap(page, '14-phase7-proposal');
    }

    // Final state
    await page.waitForTimeout(10_000);
    await snap(page, '14-final-state');

    // Check if project was created
    const doneIndicator = page.locator('text=/complet|finalizat|done|created/i');
    const isDone = await doneIndicator.isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`Project creation completed: ${isDone}`);

    // Navigate to projects to check
    await page.goto('/ro/proiecte');
    await settle(page);
    await snap(page, '14-projects-after-creation');
  });

  test('15 - Open an existing project (if any)', async ({ page }) => {
    setupConsoleCapture(page);

    await page.goto('/ro/proiecte');
    await settle(page);

    // Click first project card
    const projectCard = page.locator('a[href*="/proiecte/"]').first();
    if (await projectCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      const href = await projectCard.getAttribute('href');
      console.log(`Opening project: ${href}`);
      await projectCard.click();
      await settle(page);
      await snap(page, '15-project-detail');

      // Test all tabs
      const tabs = ['Overview', 'Documents', 'Tasks', 'Timeline',
                     'Prezentare', 'Documente', 'Activități', 'Cronologie'];
      for (const tab of tabs) {
        const tabBtn = page.locator(`button:has-text("${tab}")`);
        if (await tabBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
          await tabBtn.click();
          await page.waitForTimeout(300);
          await snap(page, `15-project-tab-${tab.toLowerCase()}`);
        }
      }

      // Test Share button
      await safeClick(page, 'button:has-text("Share"), button:has-text("Distribuie")', 'Share');
      await snap(page, '15-project-share');

      // Test AI Resume/Start buttons
      await safeClick(page, 'button:has-text("Resume AI"), button:has-text("Start AI"), a[href*="asistent-ai"]', 'AI button');
      await snap(page, '15-project-ai-btn');
    } else {
      console.log('No projects found to open');
      await snap(page, '15-no-projects');
    }
  });
});

test.describe('Full QA: Error & Edge Cases', () => {
  test.setTimeout(120_000);

  test('16 - Test API error responses', async ({ page }) => {
    setupConsoleCapture(page);
    await page.goto('/ro/panou');
    await settle(page);

    // Get CSRF token
    const csrfCookie = (await page.context().cookies()).find(c => c.name === 'csrf-token');
    const csrf = csrfCookie?.value || '';

    // Test invalid project ID
    const badProject = await page.request.get('/api/v1/projects/invalid-uuid').catch(() => null);
    console.log(`GET /projects/invalid-uuid: ${badProject?.status()}`);

    // Test create project without body
    const noBody = await page.request.post('/api/v1/projects', {
      headers: { 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
      data: {},
    }).catch(() => null);
    console.log(`POST /projects empty: ${noBody?.status()}`);

    // Test orchestrator message without body
    const noMsg = await page.request.post('/api/ai/orchestrator/message', {
      headers: { 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
      data: {},
    }).catch(() => null);
    console.log(`POST /orchestrator/message empty: ${noMsg?.status()}`);

    // Test generate-proposal with invalid data
    const badProposal = await page.request.post('/api/ai/generate-proposal', {
      headers: { 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
      data: { invalid: true },
    }).catch(() => null);
    console.log(`POST /generate-proposal invalid: ${badProposal?.status()}`);

    // Test match-grants with invalid data (10s timeout — can hang on AI auth)
    const badMatch = await Promise.race([
      page.request.post('/api/ai/match-grants', {
        headers: { 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
        data: {},
      }),
      new Promise<null>((r) => setTimeout(() => r(null), 10_000)),
    ]).catch(() => null);
    console.log(`POST /match-grants empty: ${badMatch?.status() ?? 'timeout'}`);
  });

  test('17 - Console errors summary', async ({ page }) => {
    // Navigate through all pages once more to capture any console errors
    const pages = ['/ro/panou', '/ro/proiecte', '/ro/documente', '/ro/asistent-ai', '/ro/setari'];

    for (const url of pages) {
      setupConsoleCapture(page);
      await page.goto(url).catch(() => {});
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(1000);
    }

    // Log all collected errors
    console.log('\n========== CONSOLE ERRORS ==========');
    for (const err of consoleErrors) {
      console.log(err);
    }
    console.log('\n========== NETWORK ERRORS ==========');
    for (const err of networkErrors) {
      console.log(err);
    }
    console.log('====================================');
  });
});
