# Customer prompt queue

Standalone browser chats admit up to three waiting prompts, independently of the
active admission or running turn. Ordinary Enter/send and the explicit draft
action share this FIFO. Desktop draft boxes and explicit Team runs retain their
existing transports; Team API owns its separate slot queue.

Queue state lives in browser session storage, scoped by authenticated account ID
and conversation ID. It survives reload in that tab. It is not a server-durable
or cross-device queue. Old unscoped desktop draft keys are not imported into a
customer account. Admission must persist successfully before the composer clears
its text or files. The browser cannot queue while its storage quota is exhausted.

The mounted composer dispatches only after runtime hydration, automatic entry
preparation, and the authoritative send gate permit it. Pending questions block
dispatch. Leaving the conversation or switching accounts stops local dispatch;
waiting prompts resume when that authorized conversation is reopened. Every
admission and dispatch revalidates the current model/context budget from item 02.
Core still validates fully assembled requests.

The active admission is retained separately until the server acknowledges it.
Confirmed rejection or local validation failure leaves it visible for retry or
removal and blocks later prompts. An active-turn 409 waits for a runtime release
instead of retrying continuously. Accepted prompts are represented by the normal
conversation history; subsequent model/turn failures follow its existing error
handling rather than automatically replaying a turn.

Core currently assigns canonical message/turn IDs and does not expose a client
idempotency nonce for this send API. Network/5xx ambiguity, or a sending marker
restored by a new page, therefore pauses that prompt without automatic retry.
The customer checks history and removes the marker before continuing. This avoids
duplicating a turn that may already have been accepted. No queue contents are
logged by this implementation.

Implementation dependencies: item 02 prompt admission and item 10 entry/runtime
readiness. Existing ChatFileRef and session reference shapes are preserved.
