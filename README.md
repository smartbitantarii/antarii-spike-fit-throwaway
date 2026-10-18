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
| **`ios`** | manual only | ✕ **yes — four, in the `ios-signing` environment, released by your approval** |
| **`publish-ota`** | after `ios` | **no** — publishes the build to GitHub Pages and prints the install link |
| **`OTA teardown`** | manual only | **no** — replaces the published build with an empty page |

➕ *The builds are manual deliberately: a device build is taken when someone is about to install
it, and §7 rule 2 makes a changed store invalidate every figure taken on the old one, so a build
should be a deliberate act against a known commit.*

### The four iOS secrets — the owner's, and nobody else can supply them

🔴 **Put them in the `ios-signing` ENVIRONMENT, not in the repository's secrets**, and give
that environment **required reviewers**. The repository is public — which is what keeps the macOS
runner and push protection free — so **visibility is not the control; the approval gate is.**

| Secret | What it is |
|---|---|
| `IOS_CERTIFICATE_P12_BASE64` | the **Apple Distribution** certificate + private key, as a base64 `.p12` |
| `IOS_CERTIFICATE_PASSWORD` | the password set when exporting that `.p12` |
| `IOS_PROVISIONING_PROFILE_BASE64` | an **Ad Hoc** provisioning profile for `com.smartbitit.antarii.spike`, base64, **including the iPhone's UDID** |
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

2. **developer.apple.com → Certificates** → new **Apple Distribution** certificate → upload
   `spike.csr` → download `distribution.cer`.
   ⚠ **Distribution, not Development** — an **Ad Hoc** profile requires it, and an Ad Hoc profile
   is what an over-the-air install needs. A Development certificate fails at the export step.
3. **Identifiers** → App ID `com.smartbitit.antarii.spike` → enable **NFC Tag Reading**.
   ⚠ Condition 4's NFC leg needs this, and NFC does **not** work with a wildcard App ID — it needs
   the explicit one, which we have. Enable it *before* creating the profile or the profile will not
   carry it.
4. **Devices** → register **both** phones by UDID.
5. **Profiles** → new **Ad Hoc** profile → App ID `com.smartbitit.antarii.spike` → select that certificate and
   **both** devices → download `spike.mobileprovision`.

```bash
# 6. combine the downloaded certificate with the key into a .p12
openssl x509 -in distribution.cer -inform DER -out distribution.pem -outform PEM
openssl pkcs12 -export -legacy -inkey spike.key -in distribution.pem -out spike.p12
```

> 🔴 **`-legacy` is not optional-looking boilerplate.** OpenSSL 3 exports PKCS#12 with
> **AES-256-CBC and a SHA-256 MAC**, which **macOS 14 and earlier cannot import at all**. Apple
> states macOS 15 was updated to read modern PKCS#12, and the runner is `macos-15` — but the
> failure mode if that is wrong is a **twenty-minute build that dies at the import step** with
> *“MAC verification failed … (wrong password?)”*, **a message that sends you hunting the password
> rather than the algorithm**. `-legacy` works on every macOS version, and the weaker algorithms
> are irrelevant here: the file exists for seconds inside a throwaway keychain that is destroyed
> whether the build succeeds or fails.
>
> ⚠ One report notes `-legacy` can occasionally mis-format the bag attributes. The workflow
> already guards that — it fails if `security find-identity` returns no codesigning identity
> after the import.

```powershell
# 7. base64 both, on Windows, into files you then paste from and delete
[Convert]::ToBase64String([IO.File]::ReadAllBytes("spike.p12"))          > p12.b64.txt
[Convert]::ToBase64String([IO.File]::ReadAllBytes("spike.mobileprovision")) > profile.b64.txt
```

Then add the four secrets, delete `p12.b64.txt`, `profile.b64.txt` and `spike.key`, and keep the
`.p12` **only** in whatever the owner uses for secrets — rule 5 also requires *"a second copy held
apart from the first"*.

### ⚠ Two things this does not solve

- ✅ **The iOS install route is SOLVED — over the air, decided by the owner 2026-10-18.** The run
  plan flagged it as owed: *"the signed build has to be fetched from CI and installed on the
  device, so the install route is now part of the setup"*. `publish-ota` publishes the build to
  GitHub Pages and prints an `itms-services://` link to open on the phone.
  ✅ **Probed before anything was committed to it**: iOS accepted the manifest served as
  `application/octet-stream`, which vendor sources had said would be **refused silently**. They
  were wrong, and the probe is why that is known rather than assumed.
  ➕ **Why the other routes lost.** **A Mac** — Apple Configurator needs no Xcode, but the owner's
  2019 Intel Mac does not boot, and a cloud Mac cannot help because installing needs a physical USB
  connection. **TestFlight** — needs the same distribution certificate *and* puts the build through
  Apple's pipeline, so what installs is not CI's artefact. ✕ **Third-party Windows sideloaders** —
  they **re-sign** the app, changing the artefact being measured; their entitlements feature is a
  **paid extra**, without which condition 4's NFC leg cannot run; and they want the **Apple ID
  password**, which on the account the owner's iPhone uses is a *wider* exposure than a scoped
  certificate, not a narrower one.
  ➕ **And the distribution certificate is accepted on the requirement's own reasoning**: ADR-012
  §6.6 rule 5's harm is *"a new application identity in the store"*, and **nothing is published** —
  so a compromise is revoke-and-reissue. The gate is the `ios-signing` environment's required
  reviewers, not the repository's visibility.
- **Both devices need a device lock set**, because ADR-003 §5.3.4 decided the application *"refuses
  to hold tenant data without one"* — **a phone with no passcode cannot run the spike at all.**

⚠ **And the provenance scan cannot run in CI, by design.** Rule 7's list lives at
`.git/provenance-forbidden.txt` and *"must not live in the repository"*, so no hosted runner can
ever have it. The commit-time guard is **local-only**; the secret-scanning half is server-side.
