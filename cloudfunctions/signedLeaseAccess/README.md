# Signed lease access

This independent cloud function records already confirmed signing facts and
atomically creates remote-door eligibility for the verified canonical resident,
real room, bound door and explicit lease. It does not generate or legally sign a
contract, does not collect money and does not require a photo/face task.

The deployment owns its local copies of the canonical identity and private
phone-proof helpers; it never imports a sibling cloud function at runtime.
Client events are flat `{action,...fields}`. Identities/roles are taken from
trusted WX context and server records. The authenticated admin backend calls the
same service with its own verified administrator actor, through the management
SDK transaction adapter. Tenant request fields cannot supply an actor or lease.

Private collection names and proposed client-deny rules are in
`docs/deployment/signed-lease-access/client-rules.json` in the repository.
`indexes.json` describes proposed query indexes, not deployed indexes. Never
allow direct client writes to these collections. Actual rules, IAM, SDK
transactions, indexes, cloud deployment and device behavior have not been
validated against a live environment by this implementation.

Before use, the authorized administrator explicitly configures the program
singleton (`remote_unlock_program/program`), a real `rooms.houseId` to door
binding and a separately controlled worker record. Config booleans are real
booleans, with missing config disabled; no room/lease/device defaults are added.
A confirmed signed lease creates its grant/index/audit in the same transaction.
Updates and revocation require the current revision. `getAdminRecord` is the
admin-only, whitelisted point-read interface for current facts and revisions;
it never returns worker hashes, credentials or identity proof documents.

A tenant `requestOpen` creates a queued command, not a successful opening. The
local worker prepares a pinned/trusted device connection and reads its model,
then performs a fresh cloud `beginOpen` authorization immediately before the
one logical ordinary open. Task lifetime is at most 30 seconds and ends no later
than the lease. Same request IDs never requeue and concurrent in-flight commands
are restricted. Executing results that time out remain unknown and are never
reclaimed for execution; an audited administrator disposition does not assert
physical success. A later authenticated device receipt is retained even after
lease expiry. Revocation blocks new authorization; it cannot undo a command
that already passed execution authorization or was sent to the device.

The tenant has no extra gate-access application or second approval after
signing. Human handling of an unknown hardware result is an exception path,
not a normal eligibility approval. `device_confirmed` means the device accepted
the ordinary command, never that the physical lock released.

No real configuration, deployment, device access or platform upload is performed
by importing this module, its tests or this documentation.
