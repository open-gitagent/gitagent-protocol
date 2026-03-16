---
name: code-review
description: "Reviews code diffs and files for security vulnerabilities (OWASP Top 10), error handling, complexity, naming conventions, and performance issues. Use when the user asks to review a PR, pull request, diff, merge request, or code changes."
license: MIT
allowed-tools: lint-check complexity-analysis
metadata:
  author: gitagent-examples
  version: "1.0.0"
  category: developer-tools
---

# Code Review

## Instructions
When reviewing code:
1. Read the full diff or file provided
2. Check for security vulnerabilities (OWASP Top 10)
3. Evaluate error handling completeness
4. Assess code complexity and readability
5. Verify naming conventions and code style
6. Look for performance issues
7. Check for proper input validation

## Output Format
```
## Review Summary
[1-2 sentence overview]

## Findings

### CRITICAL
- [Finding with line reference and fix]

### WARNING
- [Finding with line reference and fix]

### SUGGESTION
- [Finding with line reference and fix]

## What's Done Well
- [Positive observations]
```

### Example Finding

```
### CRITICAL
- **Line 42**: SQL injection vulnerability — user input concatenated directly into query string.
  Fix: Use parameterized queries instead of string concatenation.
  ```python
  # Before (vulnerable)
  cursor.execute(f"SELECT * FROM users WHERE id = {user_id}")
  # After (safe)
  cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))
  ```
```
