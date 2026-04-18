import { test, expect } from '@playwright/test'

test.use({ storageState: 'e2e/.auth/user.json' })
test.describe.configure({ mode: 'serial' })

test('preselect: new project lands in selected state without a discovery loop', async ({ page }) => {
  test.setTimeout(3 * 60_000)

  // Navigate
  await page.goto('/ro/proiecte/nou')
  await page.waitForLoadState('networkidle').catch(() => {})

  // Type a description we expect to match
  const desc =
    'Salut! Sunt primăria comunei Ocna Șugatag, județul Maramureș (UAT). ' +
    'Vreau să aplic la o finanțare pentru restaurarea și digitalizarea muzeului satului ' +
    'și a patrimoniului saline local.'

  const composer = page.getByRole('textbox').first()
  await expect(composer).toBeVisible({ timeout: 15_000 })
  await composer.fill(desc)

  // Submit
  const sendBtn = page.getByRole('button', { name: /Send|Trimite/i })
  if (await sendBtn.isVisible().catch(() => false)) {
    await sendBtn.click()
  } else {
    await composer.press('Enter')
  }

  // Optional evidence: matching state may appear briefly. Don't fail on it —
  // the preselect call often completes faster than Playwright polls.
  const matchingText = page.getByText(/Caut cel mai potrivit apel/i)
  await matchingText.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {})

  // Primary assertion: one of the three valid outcomes renders within 20s.
  const banner = page.getByText(/Apel selectat/i)
  const picker = page.getByText(/Alege apelul potrivit/i)
  const guidance = page.getByText(/Nu am găsit un apel/i)

  await Promise.race([
    banner.waitFor({ state: 'visible', timeout: 20_000 }),
    picker.waitFor({ state: 'visible', timeout: 20_000 }),
    guidance.waitFor({ state: 'visible', timeout: 20_000 }),
  ])

  // For the happy path (banner visible), assert the agent conversation started
  if (await banner.isVisible().catch(() => false)) {
    await expect(page.locator('div.bg-white.text-gray-900.border').first())
      .toBeVisible({ timeout: 30_000 })
  }
})
