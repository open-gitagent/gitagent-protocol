---
name: document-review
description: "Reviews financial documents (prospectuses, ADVs, marketing materials) for FINRA 2210 compliance, required disclosures, and balanced presentation. Use when reviewing financial statements, audit documents, regulatory filings, or when the user mentions compliance checks, financial audits, or document verification."
license: proprietary
allowed-tools: search-regulations generate-report
metadata:
  author: gitagent-examples
  version: "1.0.0"
  category: compliance
  risk_tier: high
---

# Document Review

## Instructions
When reviewing a financial document:

1. **Classify the document** — Determine document type (prospectus, ADV, customer agreement, marketing material, etc.)
2. **Identify applicable rules** — Map to FINRA 2210 (communications), SEC disclosure requirements, etc.
3. **Check required elements** — Verify all required disclosures, disclaimers, and content are present
4. **Assess accuracy** — Flag potentially misleading, exaggerated, or promissory statements
5. **Check balance** — Per FINRA 2210, ensure risks and benefits are presented in a balanced manner
6. **Review formatting** — Verify required prominence of disclosures

## Key Checks
- [ ] All required disclosures present
- [ ] No misleading or exaggerated claims
- [ ] Balanced presentation of risks and benefits
- [ ] Proper disclaimers included
- [ ] Correct classification (correspondence/retail/institutional)
- [ ] Principal pre-approval status verified (if retail communication)

## Output Format

For each finding, produce:

```
### [SEVERITY] — [Rule Reference]
- **Issue**: [What was found]
- **Location**: [Section/page reference]
- **Recommended action**: [Specific fix]
```

### Example Finding

```
### WARNING — FINRA 2210(d)(1)(A)
- **Issue**: Performance claim "consistently outperforms the market" lacks supporting data and time period
- **Location**: Page 2, paragraph 3
- **Recommended action**: Add specific time period, benchmark comparison, and standardized performance data per SEC Rule 482
```
