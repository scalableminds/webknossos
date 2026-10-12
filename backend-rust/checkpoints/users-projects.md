# Users + projects (batch M5)

## Status
- Status: DONE (2026-10-09). Both routes implemented and verified.
- Done:
  - `PATCH /users/:id` (`UserController.update`) in `src/users.rs` (`update`, `membership_updates`, `assert_users_can_be_added`, `msg`, `READ_ACCESS_PREDICATE`); tests `tests/users_update.rs` (4 tests).
  - `POST /projects/:id/transferActiveTasks` (`ProjectController.transferActiveTasks`) in `src/projects.rs` (`transfer_active_tasks`); test `tests/projects_transfer.rs`.
  - Both routes are registered by the existing `users::router` / `projects::router`; no `src/lib.rs` change was needed.
- In-flight: none.
- Next step: none for this batch. MIGRATION_STATUS.md not regenerated (coordinator owns it).
- Verification: the new tests pass with `--include-ignored`; the full suite passes (197 passed, 0 failed, `--no-fail-fast -- --include-ignored`); clippy is clean for these files (at the time, `src/jobs.rs` from another agent failed `clippy::wrong_self_convention`).

## PATCH /users/:id contract
- Check order follows Play: target read access (UserDAO.readAccessQ: team manager of a shared team, admin of the org, or self), else 404 `User “<id>” could not be found or accessed.`; not-self and not editable -> 403 notAllowed; team-manager-only changes -> 403; admin-only (`isActive=false`, `isAdmin` or `isDatasetManager` change) need the org admin -> 403 notAllowed; email change: only self (else 400 notAllowed), password required and checked (400 `Incorrect email or password…`), address unused among live multiusers (400 Email.taken); self-deactivation 403; deactivation with active task annotations 400 `Cannot deactivate user with active tasks. Task ids are: a;b`; reactivation checks the user limit (400 usersUserLimitReached); last admin / last owner 400; names: other users only by an org admin (400 `Only admins can change the names of other users.`), never on wkorg instances (400 `On this webknossos instance, users may only change their own names.`, uses `BrowserAuthConfig.is_wkorg_instance`); requested teams must exist (404 `Team “<id>” could not be found or accessed.`); manager rights in another organization's team -> 403 adminNotPossibleBy.
- Teams: memberships of teams the requester cannot manage are kept unchanged; requested memberships of teams it cannot manage are ignored. Names and experience keys are trimmed; experience domains are added to `experienceDomains` for the user's organization. Email change sets `isEmailVerified=false` and `emailChangeDate`, and affects every organization of the multiuser. `lastTaskTypeId: null` keeps the previous value (Play `orElse`).
- Response: the existing public user JSON (`users::document`).
- Activation (deactivated -> active) sends `WEBKNOSSOS | Account activated` to the new email after commit, through the `MailSender` extension (plain-text body).

## POST /projects/:id/transferActiveTasks contract
- Project not readable (team member, owner or org admin) -> 404 `Project “<id>” could not be found or accessed.`; requester not manager/admin of the project team -> 403 notAllowed; transferee not readable by the requester -> 400 `User “<id>” could not be found or accessed.`. For every active `Task` annotation of the project: requester read access (400 `Annotation could not be found or accessed.`), transferee dataset read access (400 `Cannot transfer annotation to a user who has no access to the dataset.`), requester update access (400 `No update access.`), then `_user` is replaced. Response 200 with an empty body (Play `Ok`).

## Known gaps / deliberate deviations
- Both routes run in one transaction (Play wrote step by step): failures leave nothing changed. For PATCH, the organization row is locked first (serializes admin/owner/user-limit invariants with onboarding), then the user and multiuser rows.
- `checkTeamManagerOnlyUpdates`: Play discards the Boolean result, so it never rejects; here it is enforced (changing experiences or the team set requires being a team manager/admin of the user, or the user having no teams). Team lists are compared as sets, so a resent unchanged object in another order still passes.
- A team manager who removes the user from all teams they manage: Play fails in the experiences update with 400 `No update access.` after partially writing; here the same 400 rolls everything back.
- Old memberships of deleted teams make Play's filter fail with 400 `You do not have permission to administrate this team.`; mirrored (team deletion removes memberships, so this should not occur).
- Duplicate team ids in the request hit the primary key (409 here, Play 400 SQL failure). Email taken by a deleted multiuser hits the UNIQUE constraint (409 here).
- Experience-key collisions after trimming resolve deterministically (sorted keys, the last one wins), whereas Play's map order is unspecified.
- Activation mail: plain text with a link to `BrowserAuthConfig.public_uri`, sent after commit (Play queues it before writing). No SMTP transport (log-only default mailer).
- Active task ids in the deactivation error are ordered by annotation creation (Play gives no order).
- No Mailchimp or other external side effects exist in these Play actions.
- As elsewhere in the crate, authentication is checked before the JSON body (Play parses the body first) and JSON errors use `Invalid JSON request body.`.
