# Agent Guidelines: Commit Messages

## Format (REQUIRED)

```bash
<type>(<scope>): <subject>

<body>
```

**Type**: `feat`, `fix`, `docs`, `refactor`, `chore`, `test`, `perf`, `style`, `ci`, `build`
**Scope**: Area affected (e.g., `cli`, `commands`, `config`)
**Subject**: Imperative mood, lowercase, < 72 chars, no period

## Examples

✅ **GOOD:**

```bash
feat(cli): add basic CLI structure and command router

- Set up Ink React CLI app with meow command parsing
- Implement command router dispatching to handlers
```

```bash
fix(sync): handle missing source files gracefully
```

❌ **BAD:**

```bash
update files
Added CLI structure
fix: add new CLI commands  # Wrong type - this is a feature
```

## Rules

1. **Always use type prefix** (`feat:`, `fix:`, etc.)
2. **Use scope** when it adds clarity (`feat(commands):`, `fix(config):`)
3. **Imperative mood**: "add feature" not "added feature"
4. **One logical change per commit**
5. **Body explains complex changes** with bullet points

## Common Mistakes

- Past tense verbs → Use imperative: "add" not "added"
- Missing type → Always start with `feat:`, `fix:`, etc.
- Vague subjects → Be specific: "add CLI router" not "update code"
- Wrong type → `feat:` for new features, `fix:` for bug fixes

# Checks

Before pushing, run `pnpm verify` (`perfekt ci`: install, commits, lint, typecheck, test and build on a clean checkout of HEAD). `prepublishOnly` runs it, then builds `dist/` in place for the publish.

<!-- synapse:code-conventions -->
## Code conventions

[Synapse](https://github.com/lekterable/synapse-ai) keeps this block identical across repos, so change its shared source, not this copy.

- TypeScript first. Use types, not interfaces.
- Write arrow functions only; no `function` declarations or expressions. Generators, and the rare case a framework needs `this`, are the exceptions.
- Write declarative code: no `for`, `for…of`, `for…in`, `while` or `do…while` loops, tests included; `forEach` only for side effects (logging, writes), never to build a value. Use `map`/`filter`/`reduce`/`find`/`flatMap`/`Object.fromEntries`/`Object.groupBy` instead of loops and mutating accumulators, and `it.each` for test tables. Sequential async work, pagination and early exits go in one small named helper built on `reduce` or recursion, so call sites stay declarative.
- Spell names out: `person`, not `p`; `(left, right)`, not `(a, b)`; `index`, not `i`.
- Use small direct exports. Name files and packages with one plain word that says what it does; use more only when one would be unclear.
- Use pnpm (with Turborepo in monorepos). The default branch is `master`.
- Use a library where custom code is risky: CLI parsing, escaping, frontmatter, schema validation. Add no new abstraction without two real callers.
- Before writing a file, open the one that already does the same job in this repo and copy its shape, names and order. If two such files disagree, say so instead of picking one.
- Validate outside data (files, API responses, env, child process output) once at the boundary with a schema, then trust the types inside.
- Write our own config and data files as JSON with a `$schema`, never YAML. Files a tool requires in YAML, such as GitHub workflows, are the exception.
- Give every CLI `--help`, `--json` output for scripts and a non-zero exit on failure. Never print secrets. Update `--help` and the README in the same change.

### Tests

- Put tests next to the code (`name.test.ts`) or in a `tests/` folder (plural: it holds many).
- Name each case by behaviour, starting with "should" or "should not": `it("should reject an expired token")`.
- Test only what can realistically break and would matter: public behaviour, tricky logic, edge cases, past bugs. Don't test trivial code, types, framework or library behaviour, or implementation details.
- Write one test per behaviour. Use a small table of cases instead of near-duplicate tests.
- Keep the suite fast: no real network, sleeps or long timeouts in unit tests. End-to-end tests only for a few critical flows.
- A bug fix adds one regression test that fails without the fix.
- Before adding a test, ask what bug it would catch. If none, don't add it. Delete tests that duplicate others.
<!-- /synapse:code-conventions -->
