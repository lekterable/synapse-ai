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
