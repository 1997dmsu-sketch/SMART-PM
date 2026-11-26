# Signed lease remote door worker

This local Node 20+ worker processes explicitly requested ordinary Hikvision
`open` commands, once per task. It has no inbound listener, photo workflow or
command retry. An explicit opt-in outbound polling mode keeps the worker ready
for new tenant clicks. Automatic eligibility created after a confirmed signed
lease never opens a door.

The implementation is an offline development candidate. No deployment, real
credentials, device operation or physical unlock acceptance is included.

## Local setup

Install the locked SDK dependencies in this directory with `npm ci`. The default
SDK resolution boundary is this worker's own `node_modules`. An explicit
`sdkModulePath` may choose another local installation root; ancestor fallback,
outside symlinks and SDK versions other than `@cloudbase/node-sdk` 3.18.7 are
rejected. No SDK is imported or initialized merely by importing this module,
running help or checking local configuration.

Copy `worker-config.example.json` to `worker.local.json` in this directory. Fill
the explicit workerId, cloudEnv, deviceKey, expectedModel, allowedDoorNos and
local device settings from the separately maintained trusted setup. There are
no default room, device, model, door or lease values. Every blank example value
fails validation. The local file is Git ignored by this directory's `.gitignore`.

Supply the worker token through `SIGNED_REMOTE_WORKER_TOKEN` (32–256 nonspace
characters), the device credentials through `SIGNED_REMOTE_DEVICE_USERNAME`
and `SIGNED_REMOTE_DEVICE_PASSWORD`, and cloud credentials through
`TENCENTCLOUD_SECRETID` / `TENCENTCLOUD_SECRETKEY` or the documented local SDK
credential environment. Environment variable names can be customized in the
local configuration. Never put actual tokens, addresses, certificate paths,
passwords or certificate bytes in committed files or delivery artifacts.

The device origin must be a bare HTTPS origin. `certificatePath` selects a
bounded ordinary local public certificate, used by the secured existing client
for SPKI pinning before HTTP bytes are sent. The worker always passes
`developmentTls:false`: normal CA/hostname validation also applies. A matching
pin does not make a self-signed or hostname-invalid certificate trusted. Use a
properly trusted certificate/Node trust setup; this worker has no TLS bypass.

## Explicit commands

```text
node tools/signed-remote-worker/claim-and-open.mjs
node tools/signed-remote-worker/claim-and-open.mjs --check-config
node tools/signed-remote-worker/claim-and-open.mjs --execute-once
node tools/signed-remote-worker/claim-and-open.mjs --execute-loop
```

The first command prints usage without loading configuration or contacting
anything. `--check-config` only reads local configuration; it does not initialize
the SDK or read the device certificate. `--config <local-file>` selects an
explicit configuration file. `--execute-once` processes at most one task.
`--execute-loop` starts foreground outbound polling, with a one-second pause
between serialized iterations. Start that mode once to keep the local worker
available for new tenant requests; it does not require a manual command for
each tenant click. The two execution flags and `--check-config` are mutually
exclusive. Neither execution mode is run during offline testing or packaging.

Polling never requeues or reopens a consumed task. Idle iterations and transient
cloud unavailability wait for the next poll; worker credential/configuration
errors or unsafe local preparation stop the process. Unknown device outcomes
retain their one-shot result while the loop can process other new tasks, subject
to the cloud's grant singleflight gate. SIGINT/SIGTERM stop further polling and
stop an in-flight task before its begin/open boundary when possible. A request
already sent cannot be recalled; the worker finishes recording its outcome.
No service, startup entry or scheduled task is created by these commands.

## Execution and results

`claimOpen` → strict task/target/deadline validation → read local certificate →
GET `/ISAPI/System/deviceInfo` and verify the actual model → deadline check →
one `beginOpen` with a fresh server revalidation → exact snapshot and final
deadline validation → one logical PUT to
`/ISAPI/AccessControl/RemoteControl/door/<doorNo>` with fixed `<cmd>open</cmd>` →
one `reportOpen`. Tasks cannot provide arbitrary URLs, methods, XML, credentials
or another command. The selected door must match the server task and local
`allowedDoorNos`. Model verification is an actual GET, not a config echo.

Task DTO is exactly `{taskId,claimId,revision,deviceKey,doorNo,expectedModel,
validFrom,validUntil,expiresAt,contractId,doorBindingId}`; all date fields are
epoch milliseconds, with `validUntil` exclusive. `beginOpen` changes revision
by exactly one and no other field. Missing/extra/changed fields, a mismatched
target or an elapsed deadline stop execution. Missing/unknown begin receipt
never authorizes a device request and is not fabricated into a device report.
The authoritative cloud state eventually expires; it is never requeued.

The existing client's Digest 401 challenge exchange can involve an initial
unauthenticated request and one authenticated HTTP request for this one logical
open. No transport timeout, 5xx, malformed response, crash, lost begin/report or
unknown result triggers a second logical open. A consumed claim is also refused
if returned twice in the same process. Consumed claims are retained in a Map
until their immutable task deadline, then removed; expired tasks are validated
and rejected before they can execute again. This bounds long-running local
bookkeeping without making an expired claim eligible. The cloud's one-shot
begin and terminal states provide cross-process exclusion; the local Map alone
does not.

The secured client receives the task's absolute `expiresAt` (which never
exceeds the exclusive lease end). Both each HTTP send and the TLS pin-success
socket handoff recheck that same absolute deadline, including Digest 401's
authenticated send. A late timer or a slow TLS handshake cannot extend it.
Already transmitted bytes cannot be recalled or used to prove physical release.

HTTP 200 alone is not success. A complete supported XML/JSON ResponseStatus
must contain statusCode 1, statusString `OK` and subStatusCode `ok`, without
contradictory error fields. Invalid, duplicate, ambiguous or unsupported
responses become `unknown`; explicit consistent device rejection codes 2–7
become `failed`. `device_confirmed` means the device accepted the command;
physical lock release remains unconfirmed. Reports contain only the closed
status and code (`1`, `2`–`7`, or null), never raw response bodies or secrets.
If local provider cleanup fails, the worker still attempts the one truthful
device report, then exposes `CLEANUP_FAILED`, stops polling and exits nonzero.
An earlier preparation/begin failure keeps its own safe code and adds the
cleanup failure flag. Cleanup never rewrites a known device outcome, creates a
device report without a valid begin, or causes another open attempt.

Offline tests: `node --require ./tests/support/d-network-fakes.cjs --require
./tests/support/d-network-guard.cjs --test tests/signed-remote-worker.test.cjs`.
The fake and guard must precede business import in that order. When an outer
test runner has already installed the guard, this suite keeps that guard in
place and does not install fakes over it.
