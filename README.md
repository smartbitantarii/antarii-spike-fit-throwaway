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

## Building for a device (`.github/workflows/spike-build.yml`)

> 🔴 **This is the spike's build, not the release-path CI.** ADR-012 §6.6 rule 8 says the ADR
> does **not** decide *"the CI configuration itself, which is rule 14's revisit"*, and ADR-012 is
> still **Proposed**. What authorises this workflow is narrower: the run plan's **`O2`**, which
> found that *"GitHub's macOS runner **is** the Mac — free on a public repository, which is `D5`"*.
> **Do not copy this file into a component repository.**

**It produces an installable build, not the figures.** `M7`'s sequences `S1`–`S8` run *in the
application* on the two `SyR-210` devices, so the figures are taken after installing what this
builds. ⚠ **Both builds are `Release`, and that is not a preference** — a React Native debug build
runs with `__DEV__` true and a development bundle, so **a p95 taken from one would gate an ADR on
a number no user would ever see.**

| Job | Trigger | Needs secrets |
|---|---|---|
| **`test`** | every push and PR | **no** — and it runs **leg (ii) against a real s3mock and the real grant issuer**, refusing a silent skip |
| **`android`** | manual only | **no** — `assembleRelease` is signed with the keystore `prebuild` generates, which is enough to sideload |
| **`ios`** | manual only | ✕ **yes — four, and they are the owner's** |

➕ *The builds are manual deliberately: a device build is taken when someone is about to install
it, and §7 rule 2 makes a changed store invalidate every figure taken on the old one, so a build
should be a deliberate act against a known commit.*

### The four iOS secrets — the owner's, and nobody else can supply them

| Secret | What it is |
|---|---|
| `IOS_CERTIFICATE_P12_BASE64` | the **development** certificate + private key, as a base64 `.p12` |
| `IOS_CERTIFICATE_PASSWORD` | the password set when exporting that `.p12` |
| `IOS_PROVISIONING_PROFILE_BASE64` | a **development** provisioning profile for `com.antarii.spike`, base64, **including both device UDIDs** |
| `APPLE_TEAM_ID` | the ten-character Team ID from the membership |

🔴 **Add these in GitHub directly** — *Settings → Secrets and variables → Actions*. They must not
be pasted into a chat, a file, or a commit. ADR-012 §6.6 rule 5: *"the key is never in the
repository"*; rule 1: *"receive the signing material as an injected secret and **retain nothing
after the build**"*, which the workflow honours with a throwaway keychain destroyed in an
`if: always()` step so a **failed** run leaks nothing either. Rule 5 also requires **a second copy
held apart from the first**, the signing key being the one secret whose loss rotation cannot repair.

> ⚠ **A correction.** This section previously said *"`D5`: a **development** identity, separately
> revocable — the distribution certificate never leaves the owner's keychain."* ✕ **`D5` is the
> spike REPOSITORY**, not a signing identity, and that discipline appears **nowhere in the corpus**.
> It is no longer cited as a rule. **Which identity to use is an open question**, because an
> **Ad Hoc** profile — what an over-the-air install needs — requires an Apple **Distribution**
> certificate, as does TestFlight; only a **Development** profile uses a development certificate,
> and installing one needs a Mac.

**No Mac is needed for any of this** (`O2`), so the steps below use OpenSSL rather than Keychain
Access:

```bash
# 1. a private key and a signing request
openssl genrsa -out spike.key 2048
openssl req -new -key spike.key -out spike.csr -subj "/emailAddress=YOU/CN=Antarii Spike/C=GB"
```

2. **developer.apple.com → Certificates** → new **Apple Development** certificate → upload
   `spike.csr` → download `development.cer`.
3. **Devices** → register **both** phones by UDID.
4. **Profiles** → new **iOS App Development** profile → App ID `com.antarii.spike` → select that
   certificate and **both** devices → download `spike.mobileprovision`.

```bash
# 5. combine the downloaded certificate with the key into a .p12
openssl x509 -in development.cer -inform DER -out development.pem -outform PEM
openssl pkcs12 -export -inkey spike.key -in development.pem -out spike.p12
```

```powershell
# 6. base64 both, on Windows, into files you then paste from and delete
[Convert]::ToBase64String([IO.File]::ReadAllBytes("spike.p12"))          > p12.b64.txt
[Convert]::ToBase64String([IO.File]::ReadAllBytes("spike.mobileprovision")) > profile.b64.txt
```

Then add the four secrets, delete `p12.b64.txt`, `profile.b64.txt` and `spike.key`, and keep the
`.p12` **only** in whatever the owner uses for secrets — rule 5 also requires *"a second copy held
apart from the first"*.

### ⚠ Two things this does not solve

- **The iOS install route is still open, and the run plan already flagged it**: *"the signed build
  has to be fetched from CI and installed on the device, so the install route is now part of the
  setup"*. **Fetching the `.ipa` is easy; installing it on an iPhone from Windows has no
  first-party route** — Apple Configurator and Xcode's device window are both macOS-only. The
  realistic options are **(a) an over-the-air install** from an `itms-services://` link, **(b)
  TestFlight internal testing**, or **(c) a Mac for the install step only** (which `O2` said was not
  needed *for **building***, and installing is not building).
  ⚠ **(a) and (b) both need an Apple DISTRIBUTION certificate** — an Ad Hoc profile requires one,
  and so does App Store Connect — **so only (c) keeps a distribution certificate out of CI**.
  ✕ *Third-party Windows sideloaders are rejected: they **re-sign** the app, changing the artefact
  being measured, and free-account signing expires in about a week.*
  **An owner decision, not an assumption to make here.**
- **Both devices need a device lock set**, because ADR-003 §5.3.4 decided the application *"refuses
  to hold tenant data without one"* — **a phone with no passcode cannot run the spike at all.**

⚠ **And the provenance scan cannot run in CI, by design.** Rule 7's list lives at
`.git/provenance-forbidden.txt` and *"must not live in the repository"*, so no hosted runner can
ever have it. The commit-time guard is **local-only**; the secret-scanning half is server-side.
