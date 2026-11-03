# Pricing plan expiry reminder (gap G8) checkpoint

Status: DONE (2026-11-03), wired in `src/main.rs`. Owner: pricing-expiry-reminder sub-agent.

## Scala truth
`app/models/organization/PricingPlanExpiryReminderService.scala` (`IntervalScheduler`):
- `tickerEnabled = pricingPlanExpiryReminder.enabled && (leadTimesDays ++ trialLeadTimesDays).nonEmpty`;
  `conf/application.conf`: `enabled = false`, `leadTimesDays = [30, 14, 7]`, `trialLeadTimesDays = [7]`,
  `tickerInterval = 6 hours`; initial delay 5 min.
- Tick: `OrganizationDAO.findAllWithPlanExpiringBefore(now + max lead time days)` (`paidUntil IS NOT NULL AND
  paidUntil > NOW() AND paidUntil <= threshold AND pricingPlan <> 'Personal' ORDER BY paidUntil`, non-deleted
  view). Per organization (`tryAndLog`, failures are warn-logged and do not stop the others):
  `daysRemaining = now.daysUntil(paidUntil)` (ceil of ms / day); lead times = trial ones for
  `Team_Trial`/`Power_Trial`; `crossedLeadTimesDays` = lead times `>= daysRemaining`, ascending, none once
  `daysRemaining <= 0`. If any: load active owner + admins (`findMultiUsersOfOrganizationOwnerAndAdmins`; none is an
  error), then `insertPlanExpiryReminders` (`ON CONFLICT DO NOTHING`, BEFORE mailing); only when at least one row
  was inserted, info-log and send `DefaultMails.pricingPlanExpiryReminderMail` to every recipient.
- Mail: subject `WEBKNOSSOS | Your {PricingPlan.label} plan expires on {formatDateOnly(paidUntil)}`
  (`d MMMM yyyy`, English, JVM default zone), template `pricingPlanExpiryReminder.scala.html`, button
  `{http.uri}/organization/overview`, reply-to `mail.supportEmail`, from `mail.defaultSender`.

## Implementation
- `src/background/pricing_plan_expiry_reminder.rs`: `PricingPlanExpiryReminderConfig { schedule, lead_times_days,
  trial_lead_times_days }`, `config_from_values`, pure `crossed_lead_times_days`, `lead_times_days_for`,
  `days_until`, `format_date_only`; `PricingPlanExpiryReminder::{tick, tick_at(pool, now)}`, `scheduler`, `spawn`.
  The job is registered with `effective_schedule()` (Scala's `tickerEnabled`).
- DAO `pricing_plan_expiry_reminder/background_pricing_plan_expiry_reminder_dao.rs`:
  `find_all_with_plan_expiring_before` (Scala SQL), `insert_plan_expiry_reminders`
  (`INSERT ... SELECT $1, $2, UNNEST($3::INT[]) ON CONFLICT DO NOTHING`, returns `rows_affected`).
- Recipients reuse `organization::pricing::organization_pricing_dao::find_owner_and_admin_contacts` (same SQL as
  Scala, also used by the plan-upgrade mails; made `pub(crate)`). `PricingPlan::{label, is_trial}` are
  `pub(crate)`.
- Mail: the existing `mail::templates::pricing_plan_expiry_reminder` (already byte-checked against the Twirl
  template in `tests/mail.rs`), sent via the application's `MailSender` (`AppState::mailer`), so SMTP/log
  selection, default sender and additional footer are shared with all other mails.
- Lock: one transaction per tick holding `pg_try_advisory_xact_lock(advisory_lock_key("pricing-plan-expiry-reminder"))`
  = -4808420269438205693 (pinned, unique among job keys); skipped when held. The per-organization statements run
  in autocommit on the pool, so a reminder row is committed before its mail is handed to the mailer (2 pool
  connections per tick).
- `main.rs`: `AppState` is now built before the jobs are spawned so the reminder shares its `MailSender`;
  shutdown waits for the scheduler like the other jobs.

## Config (`.env.example`)
- `WK_PRICING_PLAN_EXPIRY_REMINDER_ENABLED` (default false)
- `WK_PRICING_PLAN_EXPIRY_REMINDER_INTERVAL_SECONDS` (> 0, default 21600)
- `WK_PRICING_PLAN_EXPIRY_REMINDER_INITIAL_DELAY_SECONDS` (>= 0, default 300)
- `WK_PRICING_PLAN_EXPIRY_REMINDER_LEAD_TIMES_DAYS` (comma-separated non-negative days, default `30,14,7`; empty =
  none)
- `WK_PRICING_PLAN_EXPIRY_REMINDER_TRIAL_LEAD_TIMES_DAYS` (default `7`)
- Link and reply-to: existing `WK_PUBLIC_URI` / `WK_SUPPORT_EMAIL` (`config.misc`).

## Deviations
- `paidUntil` is read truncated to milliseconds (`DATE_TRUNC('milliseconds', ...)`), matching Play's `Instant`,
  so both backends key reminder rows identically even if a `paidUntil` has microseconds. Rust-only advisory lock
  (Play has none); Play and Rust running side by side are still de-duplicated by the table's primary key.
- Negative lead times are rejected at startup (Scala accepts them; they can never be crossed).
- Unknown `pricingPlan` text is a per-organization warning (Scala would fail parsing the row and the whole tick).
- `formatDateOnly` uses the process local zone (`chrono::Local`, i.e. `TZ`/`/etc/localtime`), like the JVM default.

## Tests
- Unit (`background_pricing_plan_expiry_reminder_tests.rs`, 9): defaults, overrides, enabled-without-lead-times,
  invalid values, pinned/unique lock key, `crossed_lead_times_days`, `lead_times_days_for`, `days_until` rounding,
  `format_date_only`.
- DB (`tests/pricing_plan_expiry_reminder.rs`, 2): owner + admins mailed (not members, not deactivated admins),
  trial vs regular lead times, no-recipient org records nothing, Personal/expired/too-far/null excluded,
  partially and fully recorded orgs, second tick silent, later tick adds the 7-day reminder ("tomorrow"),
  extending `paidUntil` re-arms, millisecond keys, mail subject/from/reply-to/link; lock contention skips.
