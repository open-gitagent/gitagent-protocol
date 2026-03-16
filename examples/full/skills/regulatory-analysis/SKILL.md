---
name: regulatory-analysis
description: "Analyzes documents and processes against FINRA, SEC, Federal Reserve, and CFPB regulatory frameworks. Identifies compliance gaps, classifies findings by severity, and recommends remediation. Use when performing compliance audits, regulatory reviews, gap analyses, or verifying policy adherence to financial regulations."
license: proprietary
allowed-tools: search-regulations
metadata:
  author: gitagent-examples
  version: "1.0.0"
  category: compliance
  risk_tier: high
  regulatory_frameworks: finra,sec,federal_reserve,cfpb
---

# Regulatory Analysis

## Instructions
When analyzing a document or process for regulatory compliance:

1. **Identify scope** — Determine which regulatory frameworks apply (FINRA, SEC, Fed, CFPB)
2. **Map to rules** — Identify specific rules, notices, and guidance documents relevant to the subject
3. **Assess compliance** — Evaluate the subject against each applicable requirement
4. **Classify findings** — Rate each finding by severity (CRITICAL, HIGH, MEDIUM, LOW, INFORMATIONAL)
5. **Recommend remediation** — Provide specific, actionable steps to address each finding
6. **Assess confidence** — Rate your confidence in each finding (HIGH, MEDIUM, LOW)
7. **Validate citations** — Verify all cited rules exist and are current before finalizing

## Regulatory Priority Order
When multiple frameworks apply, prioritize in this order:
1. SEC rules and regulations (federal statute)
2. FINRA rules (SRO requirements)
3. Federal Reserve supervisory guidance
4. CFPB guidance and circulars

## Output Format
```
## Regulatory Analysis Report

### Subject: [Description]
### Date: [ISO 8601]
### Analyst: compliance-analyst v1.0.0
### Confidence: [Overall confidence level]

### Applicable Frameworks
- [List of applicable regulatory frameworks with specific rules]

### Findings

#### CRITICAL
- **[Finding Title]** — [Framework] Rule/Section [Number]
  - Issue: [Description]
  - Evidence: [What was observed]
  - Remediation: [Specific steps]
  - Confidence: [HIGH/MEDIUM/LOW]

#### HIGH
[Same format]

#### MEDIUM
[Same format]

#### LOW
[Same format]

### Summary
[1-2 paragraph summary of overall compliance posture]

### Disclaimer
This analysis is for informational purposes only and does not constitute legal advice.
```

### Example Finding

```
#### CRITICAL
- **Inadequate Suitability Disclosure** — FINRA Rule 2111
  - Issue: Customer account agreement lacks suitability questionnaire for complex products
  - Evidence: Section 4.2 references "suitable investments" without defining suitability criteria or risk tolerance assessment
  - Remediation: Add suitability assessment form per FINRA Rule 2111.05 (Supplementary Material) before account opening
  - Confidence: HIGH
```
