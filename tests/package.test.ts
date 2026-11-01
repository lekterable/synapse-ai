import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

type Manifest = { scripts: Record<string, string> }

describe('package', () => {
  // `verify` (perfekt ci) builds in a temporary worktree, so publishing must
  // build dist/ here too, or npm ships whatever dist/ was built last.
  it('should rebuild dist in this folder before publishing', async () => {
    const manifest: Manifest = JSON.parse(
      await readFile(join(process.cwd(), 'package.json'), 'utf8'),
    )
    const steps = manifest.scripts.prepublishOnly
      .split('&&')
      .map((step) => step.trim())
    expect(steps).toEqual(['pnpm -s verify', 'pnpm -s build'])
  })
})
