import { chromium } from 'playwright-core'

const exe = '/home/dmitry/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'
const url = process.argv[2] || 'http://localhost:5174/'

const browser = await chromium.launch({ executablePath: exe })
const page = await browser.newPage()

const errors = []
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[console.error] ${m.text()}`)
})
const rpcs = []
page.on('response', (r) => {
  if (r.url().includes('TodoService')) rpcs.push(`${r.status()} ${r.url().split('/').pop()}`)
})

const step = async (label, fn) => {
  rpcs.length = 0
  await fn()
  await page.waitForTimeout(600)
  console.log(`\n# ${label}`)
  console.log('  rpc:', rpcs.join(', ') || '(none)')
}

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(800)

const count = () => page.locator('.item').count()
const titles = () => page.locator('.item .title').allInnerTexts()

console.log('# initial render')
console.log('  items:', await count())
console.log('  kit label present:', (await page.locator('.rf-label').first().innerText().catch(() => '')) || '(none)')

// validation error
await step('add with empty title (expect validation error)', async () => {
  await page.locator('.card', { hasText: 'Add todo' }).locator('button', { hasText: 'Add' }).click()
})
console.log('  field error:', (await page.locator('.rf-error').first().innerText().catch(() => '(none)')))

// successful create
const before = await count()
await step('add valid todo', async () => {
  const add = page.locator('.card', { hasText: 'Add todo' })
  await add.locator('input').first().fill('Buy milk')
  await add.locator('button', { hasText: 'Add' }).click()
})
console.log('  items:', before, '->', await count())
console.log('  titles:', JSON.stringify(await titles()))

// toggle first
await step('toggle first todo', async () => {
  await page.locator('.item').first().locator('input[type=checkbox]').click()
})
console.log('  done count:', await page.locator('.item .done').count())

// edit last
await step('open edit on last todo', async () => {
  await page.locator('.item').last().locator('button', { hasText: 'edit' }).click()
})
const editCard = page.locator('.card', { hasText: 'Edit #' })
console.log('  edit form visible:', await editCard.isVisible())
await step('edit title and save', async () => {
  await editCard.locator('input[name=title]').fill('Buy oat milk')
  await editCard.locator('button', { hasText: 'Save' }).click()
})
console.log('  titles:', JSON.stringify(await titles()))

// delete last
const beforeDel = await count()
await step('delete last todo', async () => {
  await page.locator('.item').last().locator('button', { hasText: 'delete' }).click()
})
console.log('  items:', beforeDel, '->', await count())

console.log('\n=== errors ===')
console.log(errors.filter((e) => !e.includes('favicon')).join('\n') || '(none)')

await browser.close()
