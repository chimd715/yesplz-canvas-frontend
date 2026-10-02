# Customer PR screenshot evidence

These are genuine screenshots from actual local Chrome sessions, captured with a deterministic mock model. Before runs frontend main `384312e2` with compatibility Core `093ff64a` and fresh isolated data. The original Core main was not executed; this is a frontend visual comparison, not the full old server stack. After runs the integrated frontend production code `47414036`, Core `093ff64a` and root runtime `d728bb7e`. Later test and documentation commits do not change that production behavior.

Credential inputs, unrelated conversation rows and baseline server-path fields are masked. Only newly created dummy fixture chats and generated documents are visible. Screenshots do not prove server encryption, model-channel isolation, retained database records or model budgets; focused server/protocol tests supply that evidence. Live model inference and hosted rollout were not exercised.

The baseline already offered a separate Upload from device action and a downward history arrow. Its default Add files action opened a server picker. No literal Resume or Start workspace control was observed in this baseline. After waiting for history hydration, browser Back/sidebar reopening succeeded in the baseline too; its screenshot is navigation context, not a reproduced durable empty-chat defect. Session expiry and archive timing screenshots are contextual before images. See each item's observations and limits below.

| Item | Before                                                        | After                                          |
| ---- | ------------------------------------------------------------- | ---------------------------------------------- |
| 01   | [Before](before/chat/server-file-picker.png)                  | [After](after/chat/browser-attachments.png)    |
| 02   | [Before](before/chat/long-prompt-before-guard.png)            | [After](after/chat/prompt-limit.png)           |
| 03   | [Before](before/chat/conversation-controls.png)               | [After](after/tools/secret-masked-dialog.png)  |
| 04   | [Before](before/chat/inline-questions.png)                    | [After](after/tools/question-first-step.png)   |
| 05   | [Before](before/history/sidebar-archive-only.png)             | [After](after/chat/delete-dialog.png)          |
| 06   | [Before](before/history/sidebar-archive-only.png)             | [After](after/chat/archive-applied.png)        |
| 07   | [Before](before/chat/generated-file-no-auto-preview.png)      | [After](after/tools/document-preview.png)      |
| 08   | [Before](before/chat/manual-draft-box.png)                    | [After](after/chat/prompt-queue.png)           |
| 09   | [Before](before/home/login-context.png)                       | [After](after/chat/auth-renewed.png)           |
| 10   | [Before](before/chat/conversation-controls.png)               | [After](after/chat/direct-conversation.png)    |
| 11   | [Before](before/chat/permission-picker.png)                   | [After](after/chat/model-menu.png)             |
| 12   | [Before](before/chat/separate-thinking-activity.png)          | [After](after/tools/expanded-activity.png)     |
| 13   | [Before](before/history/brand-click-remains-conversation.png) | [After](after/home/direct-chat.png)            |
| 14   | [Before](before/home/developer-home.png)                      | [After](after/home/direct-chat.png)            |
| 15   | [Before](before/home/developer-home.png)                      | [After](after/home/direct-chat.png)            |
| 16   | [Before](before/history/back-reopen-context.png)              | [After](after/chat/restored-session.png)       |
| 17   | [Before](before/chat/dollar-skills-no-popup.png)              | [After](after/chat/skill-menu.png)             |
| 18   | [Before](before/history/scroll-before-top-jump.png)           | [After](after/history/10-history-up-arrow.png) |

## Baseline observations and limits

### Item 01

Add files opened Select a file on the server. The alternative Upload from device already existed.

This proves the inconsistent customer entry point; do not claim every baseline attachment entry used the server picker. Browser drag/drop was not exercised on the baseline.

### Item 02

A harmless 273012-character unsent input kept Send enabled.

The input was never sent. This is frontend guard evidence; original Core335 provider limits were not executed.

### Item 03

The baseline composer showed attachment/draft/permission controls and no dedicated secure-secret modal entry.

Generic before context only. No secret was entered. Encryption and no-LLM handling cannot be demonstrated by this still image.

### Item 04

The mock model invoked two questions, shown together inside the message history.

Actual baseline UI with current local mock/Core compatibility, not a cloud-model request.

### Item 05

The real conversation menu exposed Archive and no Delete.

Database retention semantics are not visible in the screenshot.

### Item 06

The baseline Archive action is visible in the real conversation menu.

Context only. A delayed archive-list response bug was not reproduced; no fabricated stale row is shown.

### Item 07

Actual local Write produced mock-preview.html; its file-tree entry was visible while the right side stayed in Files rather than opening the preview.

Current Core093 handled Write/publication. This demonstrates baseline FE384 display behavior, not original Core335 artifact behavior.

### Item 08

Using Save to Draft box displayed one harmless draft and Manual send.

This depicts the original manual draft workflow; maximum queue capacity and active-turn automatic submission were not measured in the baseline.

### Item 09

A fresh unauthenticated browser context displayed the actual baseline login screen.

Context only, not proof of premature logout. Authentication server is current Core093, so original expiry behavior was not executed.

### Item 10

The original native conversation entry displayed the actual empty chat/composer.

No Resume summary page was observed for this native fixture. No ACP CLI/runtime or fabricated summary page was used.

### Item 11

The composer exposed Default, Auto Edit, and YOLO permission choices. The home screen also exposed a permission control.

The fixture was initialized in YOLO for safe deterministic tool execution; customer-visible selectable modes are genuine original FE UI.

### Item 12

Actual mock reasoning appeared in a separate expandable Thought complete row; tool Write appeared in a separate View Steps group.

The baseline already grouped tool steps and retained this completed reasoning. Do not claim this still image proves disappearing activity or that all baseline activity was ungrouped.

### Item 13

Clicking the visible Build Your Own brand left the hash route at /conversation/8651cb5d.

The action/unchanged route is recorded in ignored capture notes; a still image alone does not show navigation timing.

### Item 14

The actual native home showed a separate home composer, project chooser, developer agent choices, and suggestions.

Context only. No literal Start workspace button was observed on this native route; do not invent that before state.

### Item 15

The actual home displayed Build Your Own, Claude Code, Codex CLI, Hermes, and More pills.

The visible fourth pill was Hermes on this recorded SHA. Do not label it Gemini in the screenshot caption.

### Item 16

After native history was loaded, Back to /guid and sidebar reopen displayed all 13 persisted rows.

Context only: the durable blank-history bug was not reproduced. A transient zero row count before async history loading was corrected and is not claimed as bug proof.

### Item 17

Typing $ in the actual composer showed no skills popup.

The baseline attachment menu already had Selected skills; this evidence specifically concerns dollar-triggered selection.

### Item 18

A real wheel scroll reached top352 of height2289 (viewport937); the original downward scroll-to-bottom control is visible, with no new upward endpoint control.

Do not claim the original UI lacked all arrows. This screenshot depicts the new top-jump gap; original database pagination costs were not measured.
