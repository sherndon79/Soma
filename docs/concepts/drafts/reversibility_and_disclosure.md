# Reversibility and Disclosure

Status: draft concept

Soma should treat reversibility honestly.

Some actions can be undone. Some cannot. Some can only be mitigated after the fact. The system
should not use "reversible" as a vague reassurance when the actual action changes what another
person, service, model, or system now knows.

## Reversible Actions

Examples:

- revoke a tool grant
- disable microphone or camera access
- drop a harness module
- rollback a file edit when a prior version exists
- delete an unsent note
- stop a local process
- disable a remote bridge before context has been sent

These still need care, but the system can usually restore the prior material condition.

## Weakly Reversible Or Irreversible Actions

Examples:

- revealing sensitive information
- sending context to a remote model
- exposing camera, microphone, or screen context
- sharing memory with another agent or service
- publishing a note
- contacting another person or system
- executing external side effects
- deleting without backup
- running destructive commands

Once disclosure happens, knowledge has moved. It cannot be fully unrevealed.

## Required Safeguards

For weakly reversible or irreversible actions, Soma should require stronger safeguards before the
action:

- explicit preview
- clear recipient or destination
- clear statement of what cannot be taken back
- scope minimization
- redaction by default where appropriate
- delay or send queue for high-impact actions
- confirmation
- audit/provenance record
- containment and revocation options for future access

## Disclosure Is A Point Of No Return

Disclosure deserves special treatment.

Deleting a local record after disclosure may reduce future spread, but it does not remove what was
already learned by another human, model, service, or system.

Soma should therefore treat disclosure as a boundary-crossing action, not just a data movement.

## Principle

Prefer reversible actions.

Where reversibility is impossible, require heightened consent, preview, minimization, and
containment.
