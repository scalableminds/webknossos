# Mailchimp (G9) checkpoint

Status: DONE (2026-11-03), including the main.rs wiring.

## Scala truth
- `app/mail/MailchimpClient.scala`. Requests use basic auth (`mail.mailchimp.user`/`password`), and an empty
  `mail.mailchimp.host` makes every call a no-op.
  - `registerUser`: `PUT {host}/lists/{listId}/members/{md5}` with body
    `{"email_address","status":"subscribed","merge_fields":{"FNAME","LNAME"}}`. The tag POST follows only if the
    PUT succeeded.
  - `tagByEmailMd5`: `POST .../members/{md5}/tags` with body `{"tags":[{"name":<snake_case>,"status":"active"}]}`.
  - `tagsForMultiUser`: `GET .../members/{md5}/tags`.
  - Nothing is awaited by the callers, and failures never reach the request.
  - `SCrypt.md5` is uppercase hex.
- `app/mail/MailchimpTag.scala`: the enum name in snake case (`format`) and the reverse (`fromString`).
- `app/mail/MailchimpTicker.scala`: an `IntervalScheduler` with a 1 h interval and a 1 h initial delay. It is
  bound eagerly, so it always runs. For every non-deleted multi-user that has at least one non-deactivated user
  and was created 21 to 22 days ago (`created + 21d < now`, `!(created + 22d < now)`), it reads the member's tags.
  Unless the member already has one of the two activity tags, it adds one:
  - `was_inactive_in_weeks_two_and_three` when `MAX(lastActivity)` of the active users + 14d < now;
  - `was_active_in_weeks_two_or_three` otherwise.
  Errors for one multi-user are logged and do not stop the tick.

## Implementation
- `src/mailchimp.rs`:
  - `MailchimpConfig` (Debug redacts the password) and `config_from_values`.
  - `MailchimpTag` (`as_str`/`parse`), `subscriber_hash`, `member_body`, `tag_body`.
  - `MailchimpClient`: request builders (`put_member_request`, `post_tag_request`, `get_tags_request`), awaited
    calls (`put_member`, `tag_email`, `tags_for_email`), and the fire-and-forget `register_user` and `tag_user`.
    `tag_user` looks up the user's email on the spawned task. Both return the `JoinHandle` for tests.
  - Requests time out after 30 s. Errors are logged without the URL (`without_url`).
- `src/mailchimp/mailchimp_dao.rs`: `find_email_of_user` (`users` joined with `multiUsers_`).
- `AppState.mailchimp`: builder setter `.mailchimp(MailchimpConfig)`, wired in `from_config`.
- `src/background/mailchimp_ticker.rs` (+ `background_mailchimp_ticker_dao.rs`):
  - `run`/`run_at(pool, client, now)`, `activity_tag`, `scheduler`, `spawn`.
  - Each run holds a transaction with `pg_try_advisory_xact_lock(advisory_lock_key("mailchimp-ticker"))`
    (= 3425888693342096311, pinned in a unit test).
  - One query selects the candidates (window, active user, `MAX(lastActivity)`), and the GET and POST requests
    for each candidate are awaited in turn.
  - Spawned in `main.rs` and shut down before the pool closes.

## Call sites (all after commit, fire-and-forget)
| Tag | Rust | Condition (as in Play) |
| --- | --- | --- |
| RegisteredAsUser | `auth/browser/onboarding.rs` `register`, `create_user_in_organization` (via `CreatedAccount.mailchimp_contact`), `auth/oidc.rs` `create_user` | wkorg instance (instead of the new-user mail) |
| RegisteredAsAdmin | `onboarding.rs` `create_organization_with_admin` | wkorg instance |
| HasInvitedTeam | `onboarding.rs` `send_invites` | always (requesting user) |
| HasAnnotated | `annotation/create.rs` `create_explorational` | always |
| HasViewedPublishedDataset | `dataset/routes.rs` `read` | logged-in user and `isPublic` |
| HasUploadedOwnDataset | `remote/datastore/dataset_report.rs` `track_new_dataset`, `dataset/explore.rs` (explore+add) | `!needsConversion` |
| HasUploadedOwnDataset | `job/workers.rs` `track_status_change` | job newly succeeded and command `convert_to_wkw` (job owner) |

## Config (.env.example)
`WK_MAILCHIMP_HOST` (empty = disabled; absolute http(s) URL, trailing `/` trimmed), `WK_MAILCHIMP_LIST_ID`,
`WK_MAILCHIMP_USER`, `WK_MAILCHIMP_PASSWORD`, `WK_MAILCHIMP_TICKER_ENABLED` (true). The ticker runs every hour,
first after one hour (fixed, as in Play).

## Deliberate deviations
- The subscriber hash is computed over the lowercased address, which is what the Mailchimp API requires. Play
  hashes the stored address; registration lowercases it already, so the two differ only for mixed-case OIDC
  emails. Play's uppercase hex is kept.
- The ticker is not scheduled without a host. Play ticks hourly and loads every multi-user just to do nothing.
  `WK_MAILCHIMP_TICKER_ENABLED` is a Rust-only switch.
- The ticker selects its candidates in SQL instead of loading all multi-users. It awaits its tag POSTs inside the
  run (Play fires and forgets them) and serializes runs across instances. The window bounds are computed in
  Rust as `now - 21d` and `now - 22d` (exact durations, as in Play).
- The tags response only needs `name`. Play's `MailchimpTagResponse` also requires `date_added`.
- Host must be an absolute http(s) URL (config error otherwise).

## Tests
- Unit (`src/mailchimp/mailchimp_tests.rs`): tag formatting, MD5, bodies, URL/method/basic-auth of the built
  requests, disabled no-ops, Debug redaction, config. Ticker unit tests: lock key, 14-day cutoff.
- Integration (`tests/mailchimp.rs`, mock Mailchimp on 127.0.0.1):
  - Client calls: register then tag, a failed PUT skips the tag, an unknown tag is ignored, an unreachable host.
  - DB-backed: `/api/auth/register` (wkorg vs. not) and `/api/auth/sendInvites`.
  - DB-backed ticker over seeded multi-users: window edges, deactivated and deleted users, MAX activity across
    identities, already tagged members, the lock held elsewhere, no host.
