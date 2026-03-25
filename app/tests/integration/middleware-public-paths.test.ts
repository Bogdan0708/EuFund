import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

describe('Middleware public paths', () => {
  it('treats /ro/inregistrare as public', () => {
    const middlewareSrc = fs.readFileSync(
      path.resolve(__dirname, '../../src/middleware.ts'), 'utf-8'
    )
    expect(middlewareSrc).toContain('/ro/inregistrare')
    expect(middlewareSrc).toContain('/en/inregistrare')
    expect(middlewareSrc).toContain('/ro/resetare-parola')
    expect(middlewareSrc).toContain('/en/resetare-parola')
  })
})
