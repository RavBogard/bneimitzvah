# Service draft / modal integration design review — 2026-10-16

**Provisional source-only review; runtime acceptance is pending integration and focused reproduction.** Reviewed frozen UI `dd28b2b29df42f1f5f1256390b2fe28a955090c8` and its parent `243d133` only. Later moving progress/editor files in the UI checkout are excluded. No source edits, browser/DB run, new detector or visual redesign occurred. Applied the already-loaded Impeccable audit principles only to changed task-flow accessibility and modal lifecycle.

## Frozen change

The commit adds tutor Reading / Service parts tabs, keeps both panels mounted, adds a dialog-open MutationObserver that reveals the owning tab, and a CSS fallback displaying a hidden panel containing an open dialog. The new browser case exercises tab relationships and arrow/Home navigation, mounted material/draft preservation, Start/lift return focus, ordinary service guard reveal, cancel and discard. It does not test workspace concealment or a service guard raised from the retained reading editor sheet. ServicePlanEditor itself is unchanged in this commit; ReadingEditor and the shared helper also retain their previously reviewed implementation.

The mounted-panel approach preserves service selection and unsent work rather than remounting on every tab click. Closed tab panels remain hidden, and tab buttons have reciprocal aria-controls/aria-labelledby, roving tabindex and selected state. Those source facts do not replace browser evidence.

## Consequential source risks

1. **Service guard bypasses global concealment.** In `service-learning/editor.tsx`, the effect keyed only by `leaving` calls showModal/close directly. The provider hides/inerts the whole workspace while checking access. Tab auto-reveal and `.page-tab-panel[hidden]:has(dialog[open])` affect only the inner tab panel, so cannot remove a service prompt from the top layer during that global check. The shared `useWorkspaceModal` already handles this boundary for the other dialogs. This is a confirmed source gap; whether the exact user sequence visibly blocks the page remains to be reproduced.
2. **Changing only the service hook is insufficient.** ReadingPanel currently opens its sheet when `sheetOpen && !work.departure`. It knows nothing about the service guard's `leaving` decision. After a conceal/resume, both logical states can still be true, so independent reopening can place the reading editor above the unresolved service decision. Do not rely on child/parent effect ordering, CSS tab reveal or a second showModal call to establish the intended order.
3. **Focus needs a rightful visible destination.** The service guard has no explicit opener restoration. When a hidden Service parts panel is auto-revealed, its original reading control may now be hidden. A guard invoked from the reading editor instead needs its retained editor/control restored after cancellation. Restoring a disconnected, concealed, inert, hidden-panel or closed-dialog control would be incorrect. Current source alone does not prove either runtime outcome.

## Minimal adaptation recommended

Preserve the existing single-active-modal contract. Publish only the service guard's logical active state to ReadingPanel through the existing component path; suspend the physical reading sheet while either `work.departure` or the service decision is active. Retain `sheetOpen`, reading drafts and service selections. Use the shared conceal-aware hook for the service dialog. Do not add a generic modal stack or duplicate authority state.

Capture the real opener before suspension, as the existing reading departure component does. On Keep editing/cancel, resume the retained sheet and its rightful visible control when that was the caller; otherwise focus a usable service control in the now-selected Service parts panel. Restore only after the workspace and destination are visible. Clear the active signal during guard cleanup/unmount and resolve canceled pending decisions without recreating stale dialogs. Failed access/session/relationship checks must clear/unmount work, not resume it. Existing service pause/clear/settle and generation checks remain the authority boundary; tab state is presentation only.

Guards remain sequential through the provider's existing registered guard loop. A service decision followed by a work decision must each own the physical modal while pending; no new guard order or unsent-work semantics is proposed. Preserve confirm's skipOwnGuard behavior and current pending operation protections.

## Focused integration matrix

- Ordinary tabs: retain the new frozen keyboard/ARIA, hidden panel, Start/lift focus and draft/material assertions; retain existing child/student/parent behavior. No broad screenshot redo.
- Dirty service plus reading editor: trigger reading confirmation/departure, assert service prompt is the sole visible/open modal and Service parts is revealed. Keep editing/Escape preserves both exact drafts and restores the rightful usable editor or service focus. Discard continues the original action once, with no unrequested write.
- Same authority: hold actual access recheck while that service decision is pending; assert all dialogs leave the modal top layer during concealment. Resume with the decision and drafts intact, the reading sheet physically suspended, and keyboard-accessible decision controls. Then cancel/discard and verify final focus and request counts.
- Multiple unsent streams: retain an unsent/unknown work note as well as a service selection; exercise sequential service/work decisions, including cancellation at the later guard. Neither prompt may be buried or bypassed, and unknown work must not be silently replayed/discarded.
- Failed authority: expire session or revoke the selected relationship during a held check. Assert no stale dialog/text/choice resumes, no private material or queued write appears, and a new rightful context starts clean. An independent tab remains independent.
- Pending operations: preserve existing held prepare/confirm/reload protections and immediate/repeated Escape assertions; ensure the new service-active signal cannot close a pending editor or introduce an idle Escape trap. Reuse prior native closedBy/fallback evidence for identical code rather than claiming cross-browser testing.

Author should own the bounded repair and normal runtime case after the calendar clean checkpoint; coordinate any distinct reviewer test ownership and the exclusive fixture before execution. No runtime failure, final severity score, browser acceptance or new source approval is asserted by this design review.
