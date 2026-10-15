# antarii-spike-fit-throwaway

> ⚠ **This repository is DISPOSABLE and PUBLIC. It is deleted when the spike ends.**
> It is **not** a component repository, **not** the mobile client, and **must never become one**.

## What it is

The build route for the **ADR-003 fit spike** and the **ADR-005 evaluator-hosting spike**, whose
procedure is the **spike run plan** and whose specification is the **spike brief** — both held in
the private documentation repository, not here.

It exists because **ADR-012 §3a** chose *a hosted CI with macOS runners* and **excluded a
developer's own machine on GP-001**. A public repository gets those runners, branch protection and
secret-scanning push protection at **no cost**, which is the whole reason it is public.

## What must never enter it

🔴 **Nothing from the prior-project estate.** No originating organisation name, repository name,
module path or documentation path from it — **harvest rule 3 and HARVEST-003 keep these out of
Antarii entirely**, and a public history makes a leak permanent and world-readable.

🔴 **No production signing material.** The **distribution certificate never leaves the owner's
keychain**. The spike uses a **development identity created for it and separately revocable**, and
**ADR-012 §3a rule 1** applies: signing material is *received as an injected secret* and **nothing
is retained after the build**. The repository's disposability bounds the damage; it does not excuse
it.

🔴 **No tenant data, real customer data, or credentials of any kind.**

## Protections (ADR-001 §8.3 rule 7 — set at creation, never retrofitted)

| | State |
|---|---|
| Public | ✅ |
| Secret scanning | ✅ enabled |
| Secret-scanning **push protection** | ✅ enabled — server-side, so `--no-verify` cannot pass it |
| Protected `main`, no force-push, linear history | set the moment this first commit creates `main` |
| **Provenance scan** | ⚠ **present but NOT enabled** — `scripts/provenance-scan.sh` and the hooks in `.githooks/` are committed and tested, and deliberately left switched off. See below |

### ⚠ Why the provenance scan is not enabled here

**A recorded scope reading, not an oversight and not a deviation** *(2026-10-15)*:

- **ADR-001 rule 7 binds component repositories**, and **rule 5** makes a disposable spike repository **not one**.
- **Its premise does not hold either.** The scan guards the harvested estate's originating organisation and paths — and that estate is **the owner's own work, with no external organisation involved**. So a leak would be **brand hygiene, not a confidentiality breach**, and brand hygiene is **rule 6's** job, already discharged by naming the organisation `antarii`.

✅ The mechanism stays committed and tested, so **enabling it is one command** if that ever changes. The instructions below remain valid for that case.

### The provenance list is deliberately NOT in this repository

Rule 7: *"a list of forbidden strings would itself contain the very names that must appear nowhere
in Antarii."* This repository holds **the mechanism and a path**. The list is supplied locally from
the owner's own records at:

```
.git/provenance-forbidden.txt
```

`.git/` is never committed, so the list cannot leak through this history. **A missing list makes the
hook fail loudly rather than pass silently** — also rule 7.

To enable the hooks after cloning:

```bash
git config core.hooksPath .githooks
```

⚠ Rule 7 calls hooks *"the convenience layer, not the control"* — they are bypassable. The
server-side control is push protection, which is already on.
