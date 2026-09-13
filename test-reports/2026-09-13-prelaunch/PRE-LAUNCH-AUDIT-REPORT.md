# Pre-Launch Audit Report

**NOT READY FOR LAUNCH. Verification remains incomplete.**

Date: 2026-09-13. Target: the current `C:/CAPSTONE` working tree, which contains pre-existing uncommitted changes. Remediation was limited to local source, tests and audit evidence; production data, credentials, cloud storage and deployments were not changed. Audit scripts and evidence are under this report's directory. These findings do not claim that production was penetrated.

## Tax and shipping clarification

The owner explicitly requested removal of tax and shipping fees. Regular checkout now ignores both submitted fields and calculates totals without them; retail already sets both to zero. Customer order details and receipt fee rows were removed. Delivery addresses/routing, deposits, discounts and existing stored order records are preserved. A03 no longer requires clarification of tax/shipping rules.

Verification: 31 backend tests passed across `core.test_prelaunch_access_guards` and `core.test_retail_pos`, including a real checkout that supplied fees but stored both as zero.

## Current remediation status ? 2026-09-13

**Code remediation is substantial but incomplete. NOT READY FOR LAUNCH.** No Daybreak application, enrollment, external attack, deployment, or secret rotation was performed. Migrations 0113 and 0114 were applied successfully to the configured PostgreSQL database. The main and retail workflows still have no payment feature; no payment gate was added.

### Tested changes

| Finding | Current result |
|---|---|
| A01 staff privilege escalation | Actor/target guards prevent driver account administration, owner modification by admins, and owner-role assignment by non-owners. Self-profile edits remain supported. Staff directory fields/warehouse readership still need a complete privacy review. |
| A02 proof tokens as sessions | Original purpose restriction retained; data APIs now validate current accounts and session state. RGB customer authentication uses the same session validator. |
| A03 invalid order totals | Tax and shipping fees are removed from new-order calculations and their customer-facing rows. Submitted fee values are ignored, including positive values. Payment-bypass classification remains withdrawn. |
| A04 signing defaults | Known Django/JWT defaults removed; missing/short private keys now stop startup. Production key strength, rotation and rollout remain **NOT VERIFIED**. |
| A05 customer directory | Customer-to-self scope retained. Full staff field/record authorization remains **NOT VERIFIED**. |
| A06 customer password modification | Drivers/warehouse staff cannot mutate customer accounts; password changes require a customer email-verification proof and strength validation. |
| A07 shared checkout | Customer ownership enforced; driver on-behalf creation denied. Existing admin and warehouse creation callers preserved. |
| A08 session lifecycle | Live activation and account fingerprint checks reject disabled, demoted, password/email/2FA-changed sessions. Per-token durable logout revocation preserves other sessions. Migration 0113 is applied. Legacy sessions will require login after rollout. |
| A09 uploads | Images must decode as supported raster formats; byte/pixel limits and decoded extensions prevent the reproduced HTML/corrupt-image acceptance. Local serving uses nosniff and sandbox headers. Full video decoding/validation and existing cloud objects remain **NOT VERIFIED**. |
| A10 private media | New non-catalog uploads are written to the configured private bucket and served through `/api/media/` only after record-level authorization. Legacy local `/uploads/` evidence is now routed through the same authorization. Existing public cloud objects require the explicit, default-preview `migrate_private_media --apply` rollout after the private bucket exists; that external migration was not run. |
| A11 reusable reset OTP | Account/purpose/code digests are consumed transactionally with the password change; reuse rejected and prior sessions invalidated. Migration 0113 is applied. |
| A12 write replay | Automatic retries removed from the shared web/Capacitor write helper. Ambiguous responses require checking the record; confirmed errors retain status/details. Endpoint-level concurrency/idempotency beyond these checks remains unverified. |
| A13 refund runtime | Replaced undefined request variable with parsed body. Four existing refund tests pass without payment-based eligibility changes. |
| A14 initial order status | Original server-side PENDING/PENDING_APPROVAL fix retained. |
| A15 tracked backups | Two identified files are removed from Git's index and ignored, with both disk files preserved at original sizes. Two historical commits still contain them, and any remote or existing clone may retain them; a coordinated history rewrite, remote force-push, clone cleanup and credential/data review remain required. |
| A16 upload collisions | Random UUID filenames and no-upsert storage writes prevent the reproduced overwrite collision. |
| A17 CORS/cookie writes | Ambient-cookie mutations remain protected by explicit origin/referrer checks. Non-debug startup now rejects wildcard hosts and missing exact CSRF/CORS origin lists; debug-only local origins are isolated. Real browser/native origins and deployment proxy configuration still need staging verification. |
| A18 invalid JSON | API middleware rejects non-object/malformed JSON before mutations. Other field-level validation/server errors from the original sweep are not claimed resolved. |
| A19 duplicate staff emails | The case-insensitive staff-email uniqueness migration is applied; concurrent constraint violations return 409. The successful migration added no accounts and deleted none. Cross-table staff/customer uniqueness races remain unverified. |
| A20 stuck loaders | Read helper stops after three attempts and releases into callers' error handling; cancellation remains supported. Full rendered outage behavior remains unverified. |
| A21 recovery routes | Public recovery pages return not-found; recovery action/endpoint no longer scan or write files. Original implementations preserved under scripts/local-recovery, outside application routes. |
| A22 release checks | Deploy workflow depends on backend tests, TypeScript, lint and focused request tests; Next no longer ignores build type failures. The local backend suite, TypeScript and lint now pass. The workflow itself has not run remotely. |
| A23 feedback | Blank messages and non-integer/out-of-range ratings rejected. Existing rated-review error copy preserved. |

Additional confirmed defect: notification or email-thread startup failure after a replacement request commits no longer reports the saved request as failed. The existing regression for this case passes. Missing legacy driver service-area assignment no longer blocks unrelated profile/password updates; role changes still require assignment.

### Verification and evidence

- **58 targeted backend tests passed**, using `config.settings_ci` with disposable SQLite and outbound sockets blocked: [remediation-targeted-final.log](remediation-targeted-final.log).
- **57 web request/retry tests passed**, including all four portals and browser/Capacitor-like contexts: [remediation-web.log](remediation-web.log). These are simulated contexts, not device sessions.
- **TypeScript passed** (`tsc --noEmit --incremental false`).
- **Migration checks passed:** `makemigrations core --check --dry-run` found no changes, the full graph through 0114 applied to a fresh disposable SQLite database, and migrations 0113/0114 applied successfully to the configured PostgreSQL database. `showmigrations` confirms both as applied: [migration-rehearsal.log](migration-rehearsal.log).
- Full backend suite: **400 tests, 396 passed, 0 failures, 0 errors, 4 skipped**: [prelaunch-remediation-final.log](prelaunch-remediation-final.log). The four skips require database locking support that disposable SQLite does not provide.
- **Lint: 0 errors, 0 warnings**: [lint-final.log](lint-final.log). No lint rules were disabled.
- `git diff --check` passed. Pre-existing application edits were preserved.

The earlier broad-suite import, permission-fixture, stock/empty-container, replacement, and delivery-lifecycle failures are resolved. The passing result does not replace the unverified browser, device, PostgreSQL, external-service, private-media, or deployment checks listed below.

### Required before rollout

1. Supply private random `DJANGO_SECRET_KEY` and `JWT_SECRET` values (at least 32 characters) through the protected environment. This patch deliberately stops startup when those are missing/known defaults. No environment values were overwritten here.
2. Preserve the applied **0113** and **0114** migration state in future environments. No important data was deleted to satisfy the staff-email uniqueness constraint.
3. Configure exact browser origins using `DJANGO_CSRF_TRUSTED_ORIGINS` / `DJANGO_CORS_ALLOWED_ORIGINS`, then verify web/native login, profile changes and cookie fallback in staging.
4. Provision the non-public evidence bucket, run the explicit private-media migration in the controlled rollout, and resolve **A15 historical backup exposure** through the coordinated retention/history process. The remaining A03/A18 business/input rules also require review before launch.
5. Complete PostgreSQL concurrency, authenticated cross-portal browser/device workflows, real external-service integration and responsive/performance verification.

Original audit counts and statuses below are historical; this section supersedes them. The two backup removals are staged in Git's index only; the backup bytes remain on disk. Other edits are uncommitted working-tree changes.

## Follow-up: requirements and first remediation pass

**User-confirmed requirement:** Neither the main workflow nor retail has a payment feature or paid/unpaid workflow. Do not add payment processing, payment-state enforcement, or fulfillment gates based on payment. Existing monetary totals may still require independent data-integrity validation. No Daybreak application or enrollment is part of this work.

The original A03 payment-bypass interpretation is withdrawn. Its negative-input/order-total observation remains evidence, but its business impact and severity need reassessment under the no-payment requirement. No payment behavior was added or changed in this pass.

Changes in `backend/core/views_api.py`:

- **A02: Fixed locally for token-purpose bypass.** Shared authentication rejects email-verification, pending 2FA, unknown-type and identity-less tokens. Existing proof verification is preserved. Current-account checks/session revocation remain open under A08.
- **A05: Fixed locally for cross-customer directory disclosure.** Customer directory queries and counts are limited to the authenticated customer. A complete staff directory permission/field review remains unverified.
- **A07: Partially Fixed.** Shared checkout rejects another customer's ID before record creation. Staff on-behalf permissions still need review.
- **A14: Fixed locally.** Checkout always begins PENDING with PENDING_APPROVAL; a supplied DELIVERED value cannot skip workflow steps.

**Regression result:** 17 tests passed using the disposable in-memory runner, with outbound network blocked: `core.test_prelaunch_access_guards`, `core.test_staff_auth_fallback`, and `core.test_auth_trip_feedback_flows.AuthenticationFlowTests`. Five new tests cover the repaired boundaries, proof-purpose compatibility and a successful own-account checkout. Existing login, 2FA, email verification, recovery and cookie-fallback tests passed. Browser, PostgreSQL and deployment verification were not performed in this pass.

**Remaining:** Other original findings remain open. Original logs and counts below describe the initial audit, not a fresh full-system run. No production data, deployment or secrets were changed. The launch decision remains NOT READY FOR LAUNCH.

## Original audit baseline (historical)

## Executive findings

**23 unresolved issue groups: 4 Critical, 14 High, 5 Medium, 0 Low. No fixes applied.**

Isolated probes reproduced staff self-promotion, verification-token authentication bypass, customer-directory disclosure, another customer's password modification, cross-customer checkout, client-controlled paid/free orders, inconsistent delivered status, session replay, reusable password-reset codes, unsafe uploads, duplicate writes, and a broken deposit-refund endpoint.

The current local settings use the source default for Django/OTP signing. Effective remote production configuration is **NOT VERIFIED**. The production-readiness decision also remains blocked by incomplete browser, device, PostgreSQL and external-service verification.

## Scope and test boundaries

Inventory: 20 Next.js pages, 80 Django URL patterns, 34 core model classes, 354 source API URL occurrences, and 15 syntactically detected form/submission locations. These are **inventory counts, not exhaustive coverage**. Dynamic forms, native screens, generated URLs, nested portal sections and RGB components need additional coverage.

Backend tests used the existing case-runner settings with disposable in-memory SQLite, disabled database routers, temporary uploads and blocked outbound sockets. Tests execute real Django routing, tokens and model operations; selected external email/storage/push behavior in existing tests is mocked. Core migrations are skipped by these settings. Production data integrity, PostgreSQL row locking, deployed constraints, migrations and database security policies are **NOT VERIFIED**.

Browser discovery returned no available browser. HTTP smoke checks used `https://localhost:3000` without credentials; local certificate checking was bypassed only for this self-signed localhost check. HTTP 200 does not prove browser rendering, hydration, authorization redirects or usability. Two recovery pages were inspected but not rendered because they write workspace files. No production build was run because those page components have filesystem side effects.

## Measured results

| Check | Result | Qualification |
|---|---|---|
| Backend discovered suite | 356: 308 passed, 40 failures, 7 errors, 1 skipped | Three failed module imports count as errors; their test bodies were not executed |
| Node web tests, per-file limit | 19 files: 14 passed, 4 failed, 1 timeout | Completed files: 95 tests, 89 passed, 6 failed; timeout file lacks a final result |
| Bun follow-up | 14 passed across 2 files | Resolves Node import-runner failures for driver eligibility and portal scope |
| Driver mobile | 15 tests passed | Helper tests, not a device session |
| Customer mobile | 15 tests passed; 0 new copy drift | Helpers and source-copy parity |
| TypeScript | Web, driver and customer checks exited 0 | No runtime/build guarantee |
| ESLint | 41 errors, 25 warnings | `src` and both mobile `src` directories, using root config |
| Python syntax | 194 backend files parsed; 0 syntax errors | Does not detect undefined names at runtime |
| HTTP page smoke | 13 returned 200; 5 returned 307; 2 not executed | No DOM interaction or visual checks |
| Endpoint access matrix | 80 routes, 6 GET caller contexts, anonymous empty POST | Detail IDs deliberately nonexistent; status-only checks |
| Write validation sweep | 528 requests; 111 HTTP 500s across 45 route/method pairs | Empty objects/arrays, four role contexts; each request rolled back |

Narrow positive controls: owner/admin/warehouse/driver/customer logins succeeded with disposable accounts. Remember-me tokens lasted 720 hours and auth cookies were HttpOnly. Expired tokens returned 401. Verified-email registration returned 201, followed by auth/me=200; duplicate registration returned 409. Other-customer detail access returned 403. Checkout rejected zero, negative and fractional quantities. Repeated checkout with the same requestId returned the same order. These successes do not override the failures below.

## Coverage of all requested areas

| Area | Performed | Remaining |
|---|---|---|
| 1. Authentication/account management | Five roles; registration, duplicate, expiry, remember-me, logout/reset/replay, proof/2FA tokens | Real mailbox/OAuth, browser inactivity and full recovery UX **NOT VERIFIED** |
| 2. Forms/input validation | Source inventory, 528 write probes, JSON/quantity/upload tests and existing policies | Every field/boundary of every rendered form **NOT VERIFIED** |
| 3. Database/data integrity | Disposable CRUD tests, constraint review, backup counts | Production duplicate/orphan scans, PostgreSQL transactions/migrations/concurrency **NOT VERIFIED** |
| 4. APIs | 80-route matrix; source URL inventory; malformed payload and retry tests | Every payload/response contract and dynamic frontend call **NOT VERIFIED** |
| 5. Role security | Five roles plus anonymous; escalation, IDOR and token-purpose probes | Complete populated-record actor/target/action matrix **NOT VERIFIED** |
| 6. Security | Auth, secrets, origins, uploads and privacy review/probes | Git history, all bundles/logs, production TLS/CORS, SQLi fuzzing and push-endpoint SSRF **NOT VERIFIED** |
| 7. Navigation/routing | 20-route inventory; 18 HTTP page checks; portal-scope tests | Every menu/link/button/modal/tab, hydration and browser redirects **NOT VERIFIED** |
| 8. Critical workflows | Existing delivery/inventory/deposit/replacement/POS suites; real checkout and registration probes | Full authenticated browser cross-portal lifecycle **NOT VERIFIED**; delivery regression failed |
| 9. Loading/error states | Retry wrappers and middleware inspected/executed | Rendered empty/error/offline states and accessibility **NOT VERIFIED** |
| 10. Slow/unstable internet | Mock transport failures, delayed recovery and lost post-commit response | Real throttled browser/device connections **NOT VERIFIED** |
| 11. Concurrency | Deterministic upload collision, repeat writes and uniqueness checks | Parallel PostgreSQL stock/approval/trip/payment operations **NOT VERIFIED** |
| 12. Responsive/mobile | Source/type/helper checks | Viewports, zoom, portrait/landscape, clipping and critical mobile usability **NOT VERIFIED** |
| 13. Browser compatibility | HTTP smoke and browser-like VM helpers | Chromium/Firefox/Safari/WebView interaction **NOT VERIFIED** |
| 14. Device permissions | Existing mocked native/location/notification/offline checks | Actual allow/deny/block/regrant camera/GPS/push **NOT VERIFIED** |
| 15. Performance | Query/prefetch and cache/retry code inspected | Representative query budgets, load, memory and prolonged-use profiling **NOT VERIFIED** |
| 16. Upload/download | MIME spoof, corrupted 6 MiB upload, public serving, collision, storage tests | Actual cloud policies, every video/receipt/download and camera export **NOT VERIFIED** |
| 17. Business rules | Checkout ownership/financial/status/quantity/idempotency; existing inventory/POS/mixed-case tests | Every state transition and production race **NOT VERIFIED** |
| 18. Privacy | Customer directory, account access, uploads, token-storage source and backups | Actual browser caches, private cloud policy and retention **NOT VERIFIED** |
| 19. Regression | Backend/web/mobile suites; type/lint; targeted follow-ups | No fixes applied; no issue marked Fixed; failures need triage |
| 20. Code review | Syntax/import diagnostics, inventories, development routes and deploy gates | Exhaustive line review, dependency/CVE and production build checks **NOT VERIFIED** |

## Critical issues

### A01 â€” Staff can promote themselves and modify other staff accounts

- **Severity / status:** Critical / Unfixed.
- **Affected / roles:** Account administration, `PUT/DELETE /api/users/{id}`; driver, warehouse, admin and owner.
- **Reproduction:** Log in as a driver. PUT own user ID with `{"roleId":"SUPER_ADMIN"}`. PUT an administrator ID with `{"isActive":false}`.
- **Expected:** Only authorized administrators can grant roles or administer another account; owner protections apply.
- **Actual:** Both returned 200; database stored SUPER_ADMIN and disabled the administrator.
- **Root cause:** `_require_staff` verifies token type; `user_detail` lacks actor/target checks for these operations. Staff list/detail reads also lack a narrower role gate.
- **Impact:** Administrative takeover, unauthorized security-setting changes and denial of account access.
- **Fix:** Centralize explicit actor-role/target checks, independently protecting role, activation, deletion and security settings.
- **Files:** `backend/core/views_api.py:2079,7097,7207`.
- **Evidence:** **DIRECTLY VERIFIED**, `driver_self_promotes`, `driver_disables_admin` in [probes.json](probes.json).

### A02 â€” Verification and 2FA challenge tokens are accepted as sessions

- **Severity / status:** Critical / Unfixed.
- **Affected / roles:** Shared authentication/data APIs; unregistered email verifier, staff awaiting 2FA, all data owners.
- **Reproduction:** Use an email-confirmation `verificationToken` as Bearer on GET `/api/customers`. Alternatively log in to a 2FA-enabled staff account and use `challengeToken` before verifying the OTP.
- **Expected:** Proof/challenge JWTs work only on their intended confirmation endpoint.
- **Actual:** Email-proof token fetched customers with 200. Real 202 login challenge fetched customers, orders and auth/me with 200 before OTP verification.
- **Root cause:** `_payload/_require_auth` accept any decoded JWT; shared endpoints lack session-purpose validation. `auth_me` has a success fallback for other types.
- **Impact:** Authentication/2FA bypass and potentially unscoped data disclosure.
- **Fix:** Require allowed session type, current account and resource authorization on data APIs; enforce distinct token purposes.
- **Files:** `backend/core/views_api.py:_payload,_require_auth,auth_me,customers_collection,orders_collection`.
- **Evidence:** **DIRECTLY VERIFIED**, `email_proof_as_session`, `two_factor_challenge_as_session`. Only outbound OTP delivery was mocked for the challenge.

### A03 ? Order totals require reassessment under the no-payment requirement

- **Severity / status:** Needs reassessment / Needs Verification. Original Critical payment-bypass classification withdrawn following the owner's clarification.
- **Affected:** Order creation and recorded totals; main and retail workflows have no payment feature.
- **Original evidence:** The isolated checkout probe supplied negative tax/shipping values and a legacy paymentStatus field. It observed a zero stored total. This does not establish a payment bypass in the intended product.
- **Root cause of observed total:** Request-supplied amounts participate in the calculation and the result is clamped to zero.
- **Impact:** Correctness of recorded order totals requires independent validation against intended pricing, tax, shipping and discount rules. Do not infer payment-processing or paid/unpaid requirements.
- **Recommended fix:** Establish the applicable amount rules and validate those fields accordingly. Do not add payment features or payment-based delivery gates.
- **Files:** `backend/core/views_api.py:orders_collection,_create_order_from_checkout_payload`.
- **Evidence:** Original `checkout_client_financial_fields` probe retained; business impact remains unverified.

### A04 â€” Known signing defaults remain usable

- **Severity / status:** Critical / Unfixed.
- **Affected / roles:** OTP/password recovery and JWT configuration; all roles.
- **Reproduction:** In isolated current settings compare Django/OTP signing configuration to the source fallback without printing it; derive a current reset OTP and reset a disposable account. Separately unset JWT_SECRET only inside the probe process and issue a source-default-signed staff token.
- **Expected:** Startup fails when required strong secrets are absent; public defaults cannot sign authentication material.
- **Actual:** Local Django/OTP signing uses the source default. Reset succeeded. With JWT_SECRET absent, a default-signed token accessed users with 200. The current local JWT_SECRET itself is configured.
- **Root cause:** Hardcoded signing fallbacks; OTP inherits Django SECRET_KEY.
- **Impact:** Known-default deployments allow recovery-code derivation or token forgery. Remote production configuration **NOT VERIFIED**; no production compromise claimed.
- **Fix:** Require strong distinct secrets at startup; rotate any used defaults and invalidate affected sessions/proofs.
- **Files:** `backend/config/settings.py:SECRET_KEY`; `backend/core/auth.py:_jwt_secret`; `backend/core/views_api.py:_otp_secret,_stateless_otp_for_bucket`.
- **Evidence:** **DIRECTLY VERIFIED**, `configuration_properties`, `password_reset_otp_replay`, `missing_jwt_secret_accepts_session`. Secret values omitted.

## High issues

### A05 â€” Customer directory exposes other customers

- **Severity / status:** High / Unfixed.
- **Affected / roles:** GET `/api/customers`; all customers.
- **Reproduction:** Create two customers; log in as the first and request the collection.
- **Expected:** Only authorized staff see the directory; customer access is limited to their own required data.
- **Actual:** 200 with the other customer and fields for email, phone, address, coordinates, discounts, spending and security settings. The other-customer detail correctly returned 403.
- **Root cause:** Collection starts from all customers after checking only token presence.
- **Impact:** Bulk personal/commercial information disclosure.
- **Fix:** Restrict directory roles, scope queries and use role-specific response fields.
- **Files:** `backend/core/views_api.py:7366,7453`.
- **Evidence:** **DIRECTLY VERIFIED**, `customer_lists_other_customers`, `customer_other_detail_guard`.

### A06 â€” Driver can reset another customer's password

- **Severity / status:** High / Unfixed.
- **Affected / roles:** PUT `/api/customers/{id}`; driver and arbitrary customer.
- **Reproduction:** As driver PUT another customer ID with a policy-compliant password.
- **Expected:** Authorized, verified password-change/recovery process.
- **Actual:** 200 and password changed without current password or OTP.
- **Root cause:** Every staff token passes the ownership gate; password is updated directly.
- **Impact:** Customer account takeover and unauthorized profile/security modifications.
- **Fix:** Separate profile administration from verified password recovery and restrict actors.
- **Files:** `backend/core/views_api.py:customer_detail`.
- **Evidence:** **DIRECTLY VERIFIED**, `driver_resets_other_customer_password`.

### A07 â€” Shared checkout permits another customer's order

- **Severity / status:** High / Unfixed.
- **Affected / roles:** POST `/api/orders`; customer A and customer B.
- **Reproduction:** As A submit valid checkout with `customerId=B` through the shared endpoint.
- **Expected:** Customer ownership always comes from the session.
- **Actual:** 201 and an order persisted for B. The `/api/customer/orders` wrapper enforces ownership, but this route bypasses it.
- **Root cause:** Shared handler prefers supplied customerId over authenticated ID.
- **Impact:** Unauthorized orders and related financial/notification records under another identity.
- **Fix:** Enforce ownership within shared creation logic and authorize staff on-behalf operations.
- **Files:** `backend/core/views_api.py:orders_collection,customer_orders`.
- **Evidence:** **DIRECTLY VERIFIED**, `shared_checkout_other_customer`.

### A08 â€” Sessions survive logout and sensitive account changes

- **Severity / status:** High / Unfixed.
- **Affected / roles:** JWT lifecycle; all roles.
- **Reproduction:** Save a token; log out and replay it. Disable/demote the account or reset its password and replay the old session.
- **Expected:** Revoked sessions fail; current account status and permissions apply.
- **Actual:** Logout=200 then users=200. Disabled account: auth/me=401 but users=200. Demoted token still accessed users. Old customer session remained usable after reset.
- **Root cause:** JWT claims are trusted without revocation/current-account checks; logout clears cookies only.
- **Impact:** Former or compromised sessions remain usable for their remaining lifetime, up to the measured 720-hour remember-me duration.
- **Fix:** Check live account/role and revocable session state/version; invalidate on logout and sensitive changes.
- **Files:** `backend/core/auth.py`; `backend/core/views_api.py:_require_auth,_require_staff,auth_logout,auth_password_reset_reset`.
- **Evidence:** **DIRECTLY VERIFIED**, replay/deactivated/demoted probes. Expired JWT control returned 401.

### A09 â€” Image uploads permit active HTML and corrupted large files

- **Severity / status:** High / Unfixed.
- **Affected / roles:** Image/evidence upload and serving; customer uploader and content viewers.
- **Reproduction:** Upload inert `audit.html` labeled `image/png` to customer-avatar; anonymously GET its URL. Also upload 6 MiB of non-image bytes labeled image/png.
- **Expected:** Reject undecodable/mismatched files; enforce bounds; never serve active content as an image.
- **Actual:** Both uploads returned 200. HTML retained `.html`, served as `text/html`, publicly cached for one year.
- **Root cause:** MIME prefix trusted, decode failures preserve bytes, extension retained, no endpoint input-size cap.
- **Impact:** Stored active-content/XSS attack surface and storage/memory abuse. Browser script execution **NOT VERIFIED**; payload was inert.
- **Fix:** Verify formats by decoding, reject invalid inputs, bound bytes/pixels/videos, choose verified extensions and isolate untrusted content.
- **Files:** `backend/core/views_api.py:_handle_image_upload,_store_upload`; `backend/core/image_compression.py`; `backend/config/urls.py`.
- **Evidence:** **DIRECTLY VERIFIED**, `spoofed_image_upload`, `invalid_6mb_image`.

### A10 â€” Private evidence uses public file serving

- **Severity / status:** High / Unfixed.
- **Affected / roles:** POD, damage/replacement evidence and profile/license media; drivers/customers.
- **Reproduction:** Inspect the common `/uploads/{path}` view and private upload folders; request a synthetic file's exact URL without a session.
- **Expected:** Private records require authorization or short-lived scoped access.
- **Actual:** Common view has no auth/ownership check and adds one-year public caching. Object storage constructs public URLs and bucket creation requests public=true.
- **Root cause:** Public catalog assets and private evidence share the public serving model.
- **Impact:** URL holders can retrieve/retain private evidence. Actual production bucket policy and real files **NOT VERIFIED**; no private customer files retrieved.
- **Fix:** Separate public/private storage, authorize downloads and apply appropriate expiring access/cache policy.
- **Files:** `backend/config/urls.py:serve_cached_upload`; `backend/core/object_storage.py:public_url,ensure_bucket`; upload handlers.
- **Evidence:** **CODE VERIFIED**; common-route anonymous retrieval directly verified with synthetic content in A09.

### A11 â€” Reset OTP remains reusable after success

- **Severity / status:** High / Unfixed.
- **Affected / roles:** Password recovery; staff/customer accounts.
- **Reproduction:** Reset disposable customer's password with a valid code; reuse that code immediately for a different password.
- **Expected:** Successful reset consumes the proof once.
- **Actual:** Both requests returned 200.
- **Root cause:** Stateless bucket validation has no consumed-challenge state.
- **Impact:** A copied reset code can regain control after legitimate recovery.
- **Fix:** Persist purpose/account-scoped challenges, consume atomically and invalidate earlier proofs.
- **Files:** `backend/core/views_api.py:_is_valid_stateless_otp,auth_password_reset_reset`.
- **Evidence:** **DIRECTLY VERIFIED**, `password_reset_otp_replay`.

### A12 â€” Ambiguous write failures replay non-idempotent actions

- **Severity / status:** High / Unfixed.
- **Affected / roles:** Web/Capacitor API writes; all portal roles.
- **Reproduction:** Run `probe_write.mjs`, simulating a commit followed by response loss. Submit identical real checkout requests twice without requestId.
- **Expected:** Uncertain responses cannot silently duplicate transactions.
- **Actual:** Wrapper invoked simulated commit twice. Two checkouts returned 201 with different orders; with requestId, replay returned the same order (201 then 200).
- **Root cause:** Unbounded retry on network/malformed/server failures is applied broadly to writes; checkout requestId is optional.
- **Impact:** Duplicate orders/actions and retries that may outlive the originating screen.
- **Fix:** Require durable idempotency for retryable creates, replay only safe operations and expose cancellation/reconciliation.
- **Files:** `src/lib/api-write.ts`, `src/lib/client-auth.ts`; `backend/core/views_api.py:orders_collection`; `Order.request_id`.
- **Evidence:** **DIRECTLY VERIFIED**, [write-probe.log](write-probe.log), repeated-checkout probes. Transport was simulated; production wrapper and separate real API requests were executed.

### A13 â€” Deposit-refund API references an undefined variable

- **Severity / status:** High / Unfixed.
- **Affected / roles:** POST `/api/customer/orders/{id}/deposit-refund`; customer.
- **Reproduction:** Authenticated customer POST `{}` for any ID; existing valid paid/undelivered-order regression also exercises this path.
- **Expected:** Parse/validate input, then validate eligibility or apply refund.
- **Actual:** Isolated HTTP request returned 500 before order lookup. Source reads `body = requested_body`; the variable is undefined.
- **Root cause:** Missing request-body initialization.
- **Impact:** Deposit-refund workflow unavailable; web wrapper can keep retrying its 500.
- **Fix:** Parse validated body, then re-test ownership, refund limits, transactions and retries.
- **Files:** `backend/core/views_api.py:11539`; `backend/core/test_order_deposit_refund.py`.
- **Evidence:** **DIRECTLY VERIFIED**, `deposit_refund_runtime`. Full-suite error rendering also encountered a Python/Django incompatibility; separate HTTP probe establishes the failure.

### A14 â€” Checkout accepts delivered status before approval

- **Severity / status:** High / Unfixed.
- **Affected / roles:** Customer checkout; customer, warehouse and driver workflows.
- **Reproduction:** Submit valid checkout with `status="DELIVERED"` before approval/trip creation.
- **Expected:** Server-enforced pending initial state and authorized transitions.
- **Actual:** 201 with `status=DELIVERED`, `request_status=PENDING_APPROVAL`.
- **Root cause:** Initial order status comes from request data.
- **Impact:** Contradictory records and premature delivery state affecting downstream rules/reports.
- **Fix:** Set initial state server-side; enforce approval/inventory/payment/trip prerequisites for transitions.
- **Files:** `backend/core/views_api.py:_create_order_from_checkout_payload`.
- **Evidence:** **DIRECTLY VERIFIED**, `checkout_delivered_without_approval`.

### A15 â€” Account-bearing database backups are tracked

- **Severity / status:** High / Unfixed.
- **Affected / roles:** Repository/distributed artifacts; represented staff/customers.
- **Reproduction:** Locate backups with git ls-files; open SQLite read-only and count tables/password fields; inspect ZIP member names without disclosing records.
- **Expected:** No unsanitized account snapshots or password material in source distribution.
- **Actual:** Tracked SQLite has 3 users, 2 customers, 12 orders and 5 nonempty account-password fields. Tracked ZIP includes User, Customer, LocationLog and Order binary exports.
- **Root cause:** Database backup artifacts committed with source.
- **Impact:** Repository readers may obtain account/data snapshots. Whether records are real, synthetic, current or historically exposed **NOT VERIFIED**.
- **Fix:** Establish provenance; sanitize/remove through an approved retention/history process and rotate affected real credentials if needed. Do not delete important backups blindly.
- **Files:** `backend/db.sqlite3.bak`; `backend/db_backups/mixed-case-pre-0083-restore-test-20260715-053431Z.zip`.
- **Evidence:** **DIRECTLY VERIFIED** metadata/counts/archive inspection; [secret-scan.json](secret-scan.json). No record values disclosed.

### A16 â€” Same-millisecond uploads overwrite each other

- **Severity / status:** High / Unfixed.
- **Affected / roles:** Shared uploads, including POD/evidence; simultaneous uploaders.
- **Reproduction:** Freeze clock to one millisecond; invoke `_store_upload_bytes` twice with same folder/prefix/extension and different synthetic bytes.
- **Expected:** Independent uploads have unique keys and cannot replace one another.
- **Actual:** Same URL returned; first file replaced with second payload.
- **Root cause:** Timestamp-only filenames; local overwrite and bucket x-upsert=true.
- **Impact:** Lost/misattributed evidence or images under concurrency.
- **Fix:** Collision-resistant random object IDs and distinct idempotent-retry semantics.
- **Files:** `backend/core/views_api.py:_store_upload_bytes`; `backend/core/object_storage.py:upload_bytes`.
- **Evidence:** **DIRECTLY VERIFIED** deterministic collision. Multi-host load test **NOT VERIFIED**.

### A17 â€” Credentialed CORS is unrestricted; cookie writes lack CSRF checks

- **Severity / status:** High / Unfixed.
- **Affected / roles:** Backend origin policy; cookie-authenticated users.
- **Reproduction:** Preflight users API with untrusted Origin and PUT. Then supply staff cookie and PUT profile change with that Origin and no CSRF token, using enforce_csrf_checks=True.
- **Expected:** Allowlisted credentialed origins and protected cookie-authenticated changes.
- **Actual:** Origin reflected; credentials allowed; cookie mutation returned 200 without CSRF proof.
- **Root cause:** Allow-all CORS default plus credential support, csrf_exempt mutations and cookie authentication.
- **Impact:** Cross-origin read/write exposure where cookies are sent, particularly same-site siblings. SameSite=Lax limits ordinary cross-site cookie delivery; universal browser exploitation **NOT VERIFIED**.
- **Fix:** Explicit trusted origins and CSRF/origin validation for cookie mutations; verify native/sibling-origin cases.
- **Files:** `backend/config/settings.py:CORS_ALLOW_ALL_ORIGINS`; `backend/core/auth.py:extract_token`; API decorators.
- **Evidence:** **DIRECTLY VERIFIED** server behavior: CORS and cookie probes. Remote deployment policy **NOT VERIFIED**.

### A22 â€” Regression failures and absent release gates prevent sign-off

- **Severity / status:** High / Unfixed.
- **Affected / roles:** QA/deploy and critical workflows; all roles.
- **Reproduction:** Run recorded backend/web/mobile/type/lint commands; inspect deployment workflow and Next config.
- **Expected:** Representative critical-flow tests pass and release gates enforce them.
- **Actual:** Backend 40 failures/7 errors; Node failures/timeout; lint 41 errors/25 warnings. Deploy workflow has no test/lint/typecheck gate; Next ignores build-time type errors. Typechecks themselves passed.
- **Root cause:** Mixture of outdated expectations, harness/import incompatibilities and actual defects; validation is not a deployment prerequisite.
- **Impact:** Warehouse, delivery, replacement, deposit and account flows cannot receive reliable launch sign-off.
- **Fix:** Triage every retained failure against intended behavior, repair actual defects and stale tests appropriately, complete missing PostgreSQL/browser/device runs and enforce accepted release gates.
- **Files:** `backend/core/test_*.py`, `backend/core/tests.py`, `scripts/*.test.mjs`, `.github/workflows/deploy.yml`, `next.config.ts`; evidence logs.
- **Evidence:** **DIRECTLY VERIFIED** checks. Individual assertion failures are not automatically separate application bugs; see ledger interpretation below.

## Medium issues

### A18 â€” Invalid JSON shapes trigger widespread server errors

- **Severity / status:** Medium / Unfixed.
- **Affected / roles:** Form/API validation; all roles and anonymous callers.
- **Reproduction:** POST `[]`, `null`, `42` or a JSON string to auth/login; run the validation matrix.
- **Expected:** Controlled 4xx validation without mutation.
- **Actual:** All four login shapes returned 500; malformed syntax returned 400. Sweep: 111 server errors across 45 route/method pairs; not necessarily all one root cause.
- **Root cause:** `_json_body` accepts any JSON type while callers assume dict; other conversions/runtime defects need case triage.
- **Impact:** Server failures and stuck/retrying forms.
- **Fix:** Enforce object bodies and field schemas centrally; triage every remaining matrix 500.
- **Files:** `backend/core/views_api.py:370`; handlers in [validation-matrix.json](validation-matrix.json).
- **Evidence:** **DIRECTLY VERIFIED**. Detail IDs were nonexistent; this is not every field of every valid record.

### A19 â€” Staff duplicate prevention is not database-enforced

- **Severity / status:** Medium / Unfixed.
- **Affected / roles:** Staff registration/account integrity; staff and administrators.
- **Reproduction:** In disposable DB create two User records with same email and ADMIN role.
- **Expected:** Database constraint protects the intended duplicate policy under concurrency.
- **Actual:** Both persisted. Customer email uniqueness/409 control passed.
- **Root cause:** User.email nonunique; no email/role constraint; application conflict query is not atomic uniqueness enforcement.
- **Impact:** Ambiguous login/recovery and concurrent duplicate staff accounts. PostgreSQL API race **NOT VERIFIED**.
- **Fix:** Confirm cross-role email policy, add matching normalized uniqueness through a reviewed migration and handle conflicts safely.
- **Files:** `backend/core/models.py:User.Meta`; account conflict/creation handlers.
- **Evidence:** **DIRECTLY VERIFIED** current-model SQLite constraint gap; production schema drift **NOT VERIFIED**.

### A20 â€” Persistent failures keep loaders pending indefinitely

- **Severity / status:** Medium / Unfixed.
- **Affected / roles:** Read recovery/loading states; all web portals, analogous mobile paths.
- **Reproduction:** Use retrying-api-read tests with repeated transport/server errors; keep upstream unavailable instead of eventually returning success.
- **Expected:** Visible offline/error/reconnecting state with cancellation/retry controls.
- **Actual:** Unbounded retry keeps caller promise pending; interceptor deliberately retains existing loading state.
- **Root cause:** Recovery is coupled to an unresolved loader without a terminal attempt budget.
- **Impact:** Persistent outage can appear as a stuck screen. Exact rendered behavior **NOT VERIFIED**.
- **Fix:** Explicit reconnecting state, cancellation/manual retry and bounded attempts or separate background recovery.
- **Files:** `src/lib/retrying-api-read.ts`, `src/lib/client-auth.ts` and helper tests.
- **Evidence:** **CODE/helper VERIFIED**; browser outage UX **NOT VERIFIED**.

### A21 â€” Recovery pages mutate the filesystem during rendering

- **Severity / status:** Medium / Unfixed.
- **Affected / roles:** `/restore`, `/restore-now`, recovery server action; visitors/operators.
- **Reproduction:** Inspect components; rendering copies Git lost-found blobs or scans/writes JSON into fixed workspace paths. Do not execute on the shared workspace.
- **Expected:** Public application rendering does not perform development recovery/file writes.
- **Actual:** No component authorization guards, hardcoded Windows paths and raw errors; `/restore` is force-dynamic. `/restore-now` can also execute during build/render.
- **Root cause:** Temporary recovery tooling remains in deployable app routes.
- **Impact:** Unintended file changes, scanning workload and internal-path disclosure. Deployment reachability **NOT VERIFIED**.
- **Fix:** Move required recovery functionality into explicit local operator tooling, preserving recovery data.
- **Files:** `src/app/restore/page.tsx`, `src/app/restore-now/page.tsx`, `src/app/actions.ts`, `src/app/api/restore/route.ts`, `next.config.ts`.
- **Evidence:** **CODE VERIFIED; execution NOT VERIFIED** to preserve files. `/api/restore` is shadowed by configured beforeFiles API rewrite; do not assume its external handler is reachable.

### A23 â€” Feedback accepts blank messages and out-of-range ratings

- **Severity / status:** Medium / Unfixed.
- **Affected / roles:** POST `/api/feedback`; customer and feedback/report consumers.
- **Reproduction:** As a customer POST `{}`; separately POST `{"rating":-1,"message":"Audit review"}` and a rating of 999.
- **Expected:** Reject empty feedback and enforce the application's five-star rating range on the backend.
- **Actual:** All three returned 201. Stored message was empty for the first; ratings -1 and 999 were retained for the others.
- **Root cause:** Message is required only when a rating is supplied, and rating is persisted without a range validator.
- **Impact:** Empty records and invalid review data can distort reporting and disagree with client display logic.
- **Fix:** Require meaningful feedback, validate optional ratings as integers within the supported range and retain ownership/duplicate safeguards.
- **Files:** `backend/core/views_api.py:feedback_collection`; `mobile/customer-app/src/screens/feedback/feedback-screen.tsx` displays a five-star range.
- **Evidence:** **DIRECTLY VERIFIED**, `feedback_validation_empty`, `feedback_validation_-1`, `feedback_validation_999` in probes.json.

## Regression failure ledger and interpretation

Every backend FAIL/ERROR is retained in [backend-tests.log](backend-tests.log) and [backend-failures.json](backend-failures.json). No failing test was silently treated as a pass.

- Three modules fail imports: discount threshold, glass deposits, mixed-case backend guards. Their remaining bodies were not executed.
- Several fleet/warehouse assertions expect administrator writes now forbidden by `_require_warehouse_operator`. Reconcile policy; do not weaken authorization to satisfy an obsolete test.
- Trip tests expect automatic completion while current code requires driver confirmation. Some creation fixtures fail service-area checks. Neither mismatch establishes passing intended end-to-end behavior.
- Mixed-case compatibility now uses category/size; one failing test changes only a packaging profile. Intended semantics need reconciliation.
- Valid staff reset-code test returns 429 after the preceding invalid attempt, including an isolated rerun. This is not evidence of cross-portal OTP acceptance.
- Deposit-refund failure has independent runtime proof (A13), despite Python 3.14/Django error-rendering noise in the full suite.
- Replacement notification-failure and missing CONSUME_EMPTY transaction assertions remain unresolved. Their traces are retained; correct commit/rollback is not assumed.
- Two Node import failures passed under Bun. Portal-data harness lacks `require`; navigation harness expects a timer it did not find. These are unresolved harness/expectation failures, not confirmed broken auth/map screens.
- Portal-fetch-retry failed to complete within a 40-second process limit. An earlier unbounded run remained pending and was stopped; the bounded aggregate run emitted one-shot/malformed-write timeouts. Incomplete tests are not counted as passes.
- Lint includes a hook-name diagnostic for `useCurrentLocation`, which inspection shows is an async context callback, not a React hook. Lint totals alone do not prove runtime crashes.

## Security scan scope and privacy

[secret-scan.json](secret-scan.json) contains locations, variable names/presence, archive metadata and aggregate counts only. Tracked-text credential-URL hits were test/example values, not verified live credentials. Local `.env` is untracked and contains configured credentials; no values appear here. The limited tracked-text scan found no private-key/JWT/provider-secret-pattern matches. **This does not prove the repository is secret-free:** history, all binaries, ignored logs and generated frontend/APK bundles were not comprehensively scanned. Account backups and signing defaults are separate findings.

Frontend Bearer tokens are stored in sessionStorage and remembered tokens in localStorage, established by source inspection without reading user browser storage. This increases the consequences of active-content injection. No real personal records, passwords, tokens, keys or coordinates are included in this report.

## Requested totals and remaining issues

- **Critical 4; High 14; Medium 5; Low 0.** All 23 unresolved; zero Fixed/Partially Fixed.
- **Security/unsafe configuration groups: 14:** A01,A02,A03,A04,A05,A06,A07,A08,A09,A10,A11,A14,A15,A17. Evidence levels and production conditions remain explicit.
- **Broken/unsafe flows:** privilege assignment, proof-token authentication, customer privacy/passwords, checkout ownership/financial/status rules, session invalidation, OTP reuse, deposit refund, write recovery and evidence handling.
- **Broken/missing pages:** no missing page confirmed among 18 HTTP-tested routes; two unsafe recovery pages. Rendered behavior **NOT VERIFIED**.
- **Failed API interactions:** 111 server-error outcomes among 528 validation requests across 45 route/method pairs; not 111 distinct defects.
- **Permission/access problems:** A01,A02,A05,A06,A07,A08,A10,A17; signing default A04 undermines authentication when used.
- **Responsive/mobile problems:** none directly measured; **NOT VERIFIED**, not a clean bill of health.
- **Data integrity risks:** A03,A07,A12,A13,A14,A16,A19,A23; unresolved inventory/replacement regressions.
- **Remaining unresolved:** every listed issue; production conditions of A04/A10/A17 and backup provenance A15 require explicit confirmation.

## Reproduction and evidence

Run from `C:/CAPSTONE`; supplied API runners select disposable settings and block outbound sockets. Do not substitute production settings.

```powershell
.venv/Scripts/python.exe test-reports/2026-09-13-prelaunch/run_backend.py
.venv/Scripts/python.exe test-reports/2026-09-13-prelaunch/probe_backend.py
.venv/Scripts/python.exe test-reports/2026-09-13-prelaunch/run_web.py
node --experimental-strip-types test-reports/2026-09-13-prelaunch/probe_write.mjs
bun test src/lib/driver-eligibility.test.ts src/lib/portal-scope.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js src mobile/driver-app/src mobile/customer-app/src --format json
```

Both mobile projects were checked with `npm test` and `npm run typecheck` from their respective directories. Additional evidence: [endpoint-matrix.json](endpoint-matrix.json), [validation-matrix.json](validation-matrix.json), [http-routes.json](http-routes.json), [inventory.json](inventory.json), [web-test-results.json](web-test-results.json), [lint.json](lint.json), and adjacent logs. Expected 401/403/404/405 outcomes are not automatically defects; 200 alone is not proof of correct scope.

Per-request authorization and upload recommendations align with the [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) and [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html). Findings themselves are based on local source/probes, not external references.

## LAUNCH BLOCKERS

Original blocker inventory follows. The follow-up above supersedes A02, A03, A05, A07 and A14 statuses; all other blockers remain open:

- **A01 Critical:** staff self-escalation/account control.
- **A02 Critical:** verification/2FA token authentication bypass.
- **A03 Needs Verification:** order-total rules require reassessment; payment-bypass classification withdrawn.
- **A04 Critical:** usable known signing defaults; deployed configuration must be established.
- **A05 High:** other-customer directory disclosure.
- **A06 High:** driver modification of customer passwords.
- **A07 High:** cross-customer shared checkout.
- **A08 High:** missing session revocation/current-account checks.
- **A09 High:** active/corrupt upload acceptance.
- **A10 High:** public serving of private evidence; production policy must be established.
- **A11 High:** reusable reset OTPs.
- **A12 High:** unsafe write replay.
- **A13 High:** broken deposit-refund endpoint.
- **A14 High:** delivered-before-approval checkout.
- **A15 High:** tracked account backups; provenance/sanitization must be established.
- **A16 High:** upload overwrite collisions.
- **A17 High:** unrestricted credentialed origins and missing cookie-CSRF defenses; production policy must be established.
- **A22 High:** unresolved regression failures and incomplete release verification.

The five Medium findings also remain open for triage. Beyond defect remediation, sign-off requires representative PostgreSQL tests, complete authenticated cross-portal browser workflows, real email/OAuth/push/storage checks, responsive/device/browser/permission coverage, and concurrency/performance verification. Re-test each fix and related flows. **Do not mark this system READY FOR LAUNCH on the current evidence.**

### NOT READY FOR LAUNCH
