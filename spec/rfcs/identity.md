# RFC: Optional Cryptographic Identity Layer for gitagent Manifests

| Field | Value |
|---|---|
| RFC | identity |
| Status | Draft |
| Author | Tymofii Pidlisnyi (aeoess) |
| Targets spec | v0.1.x (optional), v0.2 conformance suite (optional MUST) |
| Issue | https://github.com/open-gitagent/gitagent-protocol/issues/70 |
| Reference impl | Agent Passport System (Apache 2.0): https://github.com/aeoess/agent-passport-system |

## 1. Motivation

The gitagent surface (`agent.yaml` + `SOUL.md` + `RULES.md` + `DUTIES.md`) describes what an agent claims to be. It does not give downstream tools a way to verify, at runtime, that the running agent is the one the manifest describes.

For the unregulated case, git-blame plus signed git tags are enough. The repo author signed the commit, the manifest is in the commit, and trust flows transitively through the git host.

For two harder cases, that is not enough:

- **Inter-org delegation.** Org A defines an agent. Org B wants to run a child agent that operates under A's authority. There is no mechanism in the spec for B's agent to prove, to a third party, that A authorized this exact child manifest with this exact scope.
- **Regulated runtime checks.** A FINRA or EU AI Act audit asks for cryptographic proof that the agent that produced an output was the agent in the manifest, that it had authority for the action it took, and that the authority had not been revoked at the time the output was produced. Signed git tags do not bind a running agent's outputs to its manifest.

This RFC adds an **optional** seam to `agent.yaml` that lets implementations bolt on cryptographic identity without changing the canonical surface area. Manifests without the seam continue to work unchanged.

## 2. Two concerns kept separate

The RFC distinguishes two concerns that are often conflated:

1. **Provenance.** The manifest at this commit was authored by the holder of key X. Solvable today with sigstore, signed git tags, or an external attestation store. **No spec change needed.**
2. **Runtime delegation.** The running agent producing this output is acting on behalf of parent agent Y, with scope Z, signed by Y's key, not yet revoked. **This RFC adds the spec hook for this case.**

Sections 3 through 6 cover the runtime-delegation hook only. Provenance is mentioned to draw the line, not because the spec needs to address it.

## 3. The `identity` block in `agent.yaml`

Add an **optional** top-level `identity` block to `agent.yaml`:

```yaml
identity:
  public_key: ed25519:BASE64URL-ENCODED-32-BYTE-KEY
  key_fingerprint: sha256:HEX-DIGEST
  passport_uri: https://example.com/passports/agent-name.json   # optional
  signatures:                                                    # optional
    manifest:
      signer: ed25519:BASE64URL-ENCODED-PARENT-KEY
      signature: ed25519:BASE64URL-ENCODED-SIG
      scope: BASE64URL-ENCODED-SCOPE-DOC
      not_before: 2026-05-04T00:00:00Z
      not_after: 2026-08-04T00:00:00Z
```

### Field semantics

| Field | Required when `identity` is present | Description |
|---|---|---|
| `public_key` | yes | Ed25519 public key the agent signs runtime outputs with. Format: `ed25519:` prefix + base64url-encoded 32-byte key. |
| `key_fingerprint` | yes | SHA-256 hex digest of the canonical key bytes. Lets a tool compare keys without resolving `passport_uri`. |
| `passport_uri` | no | Pointer to a richer identity document for scoped delegation, revocation lists, key rotation, and cascade semantics. The richer document is implementation-defined; this RFC defines only the URI as a pointer. |
| `signatures` | no | One or more signatures over the manifest itself. The `manifest` scope is reserved and signs the canonical-bytes form of `agent.yaml` minus the `signatures` subtree itself. Other scopes are implementation-defined. |

### What the spec MUST say

- `public_key` MUST be Ed25519 in v0.1.x. Other algorithms are reserved for future RFCs and MUST be specified by a separate RFC before being accepted.
- `key_fingerprint` MUST be the SHA-256 of the raw 32-byte key material, not of the prefixed string form.
- `passport_uri` MUST resolve over HTTPS or be retrievable via a runtime-configured resolver. Spec does not constrain the document format at the URI.
- If `signatures.manifest` is present, the signature MUST verify against either the parent's `public_key` (if the parent is also a gitagent manifest with an `identity` block) or against a key resolved through `passport_uri`. Verification MUST happen at the canonical-bytes representation of the manifest with the `signatures` subtree removed and keys sorted lexicographically.

### Verification semantics

Verification semantics live in the spec. Enforcement lives in the runtime. The spec says:

> If `identity.public_key` is set, signed runtime outputs claiming to be from this agent MUST verify against that key. Signatures over the manifest itself, when present at `identity.signatures.<scope>`, MUST verify against either an in-tree parent key or a key resolvable through `identity.passport_uri`.

Each runtime decides how to enforce: refuse to load the agent on signature failure, log and continue, sandbox the agent, or some other policy.

## 4. Two-deep delegation example

Org A operates a research agent. Org A authorizes Org B to run a child trading agent under A's authority, scoped to a specific instrument set and a daily spend cap.

### Parent manifest (`agents/research-agent/agent.yaml`)

```yaml
name: research-agent
version: 1.0.0
description: Equity research agent

identity:
  public_key: ed25519:7Pz3Q...redacted
  key_fingerprint: sha256:a4b1...redacted
```

### Child manifest (`agents/trading-child/agent.yaml`)

```yaml
name: trading-child
version: 0.2.0
description: Trading child agent operating under research-agent authority

identity:
  public_key: ed25519:Cm9k4...redacted
  key_fingerprint: sha256:8d7e...redacted
  signatures:
    manifest:
      signer: ed25519:7Pz3Q...redacted        # research-agent's key
      signature: ed25519:k2pX9...redacted
      scope: |
        instruments: [equity]
        max_daily_spend_usd: 50000
        max_per_trade_usd: 5000
        valid_until: 2026-12-31T23:59:59Z
      not_before: 2026-05-04T00:00:00Z
      not_after: 2026-12-31T23:59:59Z
```

### Verification flow

A third-party tool that loads `trading-child`:

1. Reads `identity.public_key` and `identity.key_fingerprint`.
2. Checks for `identity.signatures.manifest`. Found.
3. Resolves the `signer` key: in this case, it matches `research-agent`'s `identity.public_key` in the same repo's `agents/research-agent/agent.yaml`. Tool MAY also resolve the key through `passport_uri` if the parent lives in another repo.
4. Computes the canonical-bytes form of `trading-child/agent.yaml` with the `signatures` subtree removed.
5. Verifies the signature against the canonical bytes, the `signer` key, and the `scope` document.
6. Confirms the current time is within `not_before` / `not_after`.
7. Checks revocation status (Section 5).

If any step fails, the runtime decides what to do.

### Beyond two-deep

The same pattern composes recursively. A grandchild agent's `signatures.manifest.signer` resolves to its parent, whose own `signatures.manifest.signer` resolves to its parent, and so on. Spec does not cap chain depth; a runtime MAY. APS, as one reference, caps at depth 8 by default.

## 5. Revocation

Implementations MUST agree on at least one revocation surface so that two implementations resolving the same `passport_uri` reach the same revocation decision.

### Required behavior

If `identity.passport_uri` is set:

- The document at the URI MUST be retrievable over HTTPS.
- The document MUST be JSON.
- The document MUST contain a top-level `revoked` boolean.
- If `revoked` is `true`, the document MUST contain `revoked_at` (RFC 3339 timestamp) and SHOULD contain `revocation_reason` (free-form string).
- The document MAY contain a `revocation_list` array of revoked subordinate key fingerprints (for cascade revocation of children whose `signatures.manifest.signer` matches a revoked key).

### Freshness

Implementations MUST cap the cache age at 24 hours. The document MAY include `cache_max_age_seconds` to request a shorter cap. Implementations SHOULD honor it; they MUST NOT exceed 24 hours.

### Cascade

When a parent key is revoked, all child manifests whose `signatures.manifest.signer` equals the revoked key MUST be treated as revoked, transitively. Runtime decides whether to refuse to load, sandbox, or warn.

### What revocation does NOT specify

- The wire format for revocation announcements (push channel, WebHook, gossip protocol).
- The trust model for the revocation document host (PKI, key pinning, content addressing).
- The economic or governance mechanism that decides when to revoke.

These are runtime decisions, not spec decisions.

## 6. Non-goals

To keep scope tight:

- **Wire format of signed runtime outputs.** This RFC does not specify how an agent transmits a signed output to a downstream tool. That is the runtime's or target framework's job.
- **Mandatory adoption.** The `identity` block is optional in v0.1.x. A v0.2 conformance test suite MAY require it for specific compliance profiles (for example, a financial-services profile), but mandatory adoption is a separate v0.2 conversation.
- **PKI infrastructure.** This RFC does not specify how implementations distribute, rotate, or rotate-back trust roots. Sigstore, ACME-style enrollment, key pinning, and ledger anchoring are all valid implementation choices.
- **Runtime enforcement details.** The spec says MUST verify. The runtime decides what happens when verification fails (refuse to load, sandbox, log and continue, escalate to human).
- **Quantum-resistant variants.** Reserved for a future RFC. Current Ed25519 commitment is explicit.
- **Sub-agent topology.** The example uses `agents/<name>/agent.yaml`, which is the existing v0.1.0 pattern. This RFC does not propose changes to sub-agent layout.

## 7. Cross-walk to Agent Passport System

APS is one reference implementation that satisfies this RFC's primitives. The mapping:

| `agent.yaml` field | APS primitive |
|---|---|
| `identity.public_key` | `Passport.publicKey` (Ed25519, JWK or raw 32-byte form) |
| `identity.key_fingerprint` | SHA-256 of the canonical key bytes; same definition |
| `identity.passport_uri` | URL where `Passport` JSON is served, plus the APS `RevocationCertificate` endpoint |
| `identity.signatures.manifest.signer` | The parent passport's `publicKey` |
| `identity.signatures.manifest.signature` | An APS `DelegationGrant.signature` over the canonical scope |
| `identity.signatures.manifest.scope` | An APS `DelegationGrant.scope` document, base64url-encoded |
| `identity.signatures.manifest.not_before` / `not_after` | `DelegationGrant.validityWindow` start and end |

APS's revocation cert maps to Section 5's required JSON shape via a thin adapter (~30 lines). The richer APS document at `passport_uri` is a superset of what this RFC requires; gitagent runtimes that only consume the RFC's required fields will work against any APS endpoint without further changes.

This RFC does not prescribe APS. Other implementations are equally valid as long as they satisfy Sections 3 through 5.

## 8. Open questions

These are explicitly left for follow-up RFCs:

1. **Multi-signature authority.** Some compliance profiles require m-of-n approvers for delegation. The current `signatures` map is a multi-signature carrier (`signatures.<scope>` can hold multiple entries), but threshold semantics need their own RFC.
2. **Agent-to-tool delegation.** Sub-agents are covered. Agents delegating to MCP tools, sub-skills, or external services are not. Treating tools as first-class signing parties is plausible but expands scope.
3. **Cross-repo parent resolution.** When the parent manifest lives in a different repo than the child, the resolver protocol matters. This RFC says `passport_uri` resolves; it does not specify a discovery protocol.
4. **Conformance test vectors.** A v0.2 conformance suite would benefit from byte-match-verifiable test vectors covering canonical-bytes representation of `agent.yaml` minus `signatures`, signature verification with reference Ed25519 inputs, and revocation document parsing. APS publishes its own conformance suite (`aeoess/aps-conformance-suite`) and could contribute compatible vectors.

## 9. Backwards compatibility

The `identity` block is additive and optional. Existing `agent.yaml` files validate against the v0.1.x schema unchanged. Tools that do not understand the `identity` block ignore it. This RFC does not change any existing field.

## 10. Acknowledgments

Thanks to **shreyas-lyzr** for the substantive review on issue #70 that shaped Sections 3, 5, and 6, and for the framing distinction in Section 2.

— Tymofii Pidlisnyi (aeoess)
