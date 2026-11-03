use crate::common;

use chrono::{DateTime, Duration, DurationRound, Utc};
use common::{TestDb, object_id};
use webknossos_backend::{
    background::pricing_plan_expiry_reminder::{
        JOB_NAME, PricingPlanExpiryReminder, PricingPlanExpiryReminderConfig, format_date_only,
    },
    background::scheduler::{JobOutcome, advisory_lock_key, try_advisory_xact_lock},
    mail::{DEFAULT_SENDER, Mail, MailSender, RecordingMailer},
};

const URI: &str = "https://wk.example";
const SUPPORT: &str = "support@wk.example";

/// An organization with an active admin (seeded by `seed_user`) on `plan`, paid until `paid_until`.
/// Returns the organization id and the admin's email.
async fn organization(
    db: &TestDb,
    plan: &str,
    paid_until: Option<DateTime<Utc>>,
    with_admin: bool,
) -> (String, String) {
    let organization_id = format!("rust-test-{}", object_id());
    let user = db
        .seed_user(&object_id(), &organization_id, with_admin)
        .await;
    sqlx::query(
        "UPDATE webknossos.organizations SET pricingPlan = $2::webknossos.PRICING_PLANS, \
         paidUntil = $3, name = $1 || ' name' WHERE _id = $1",
    )
    .bind(&organization_id)
    .bind(plan)
    .bind(paid_until)
    .execute(&db.pool)
    .await
    .unwrap();
    (organization_id, email(db, &user.multi_user_id).await)
}

async fn email(db: &TestDb, multi_user_id: &str) -> String {
    sqlx::query_scalar("SELECT email FROM webknossos.multiUsers WHERE _id = $1")
        .bind(multi_user_id)
        .fetch_one(&db.pool)
        .await
        .unwrap()
}

/// Adds a user; returns its email.
async fn add_user(db: &TestDb, organization_id: &str, is_admin: bool, extra: &str) -> String {
    let user_id = object_id();
    let user = db.seed_user(&user_id, organization_id, is_admin).await;
    if !extra.is_empty() {
        sqlx::query(&format!(
            "UPDATE webknossos.users SET {extra} WHERE _id = $1"
        ))
        .bind(&user_id)
        .execute(&db.pool)
        .await
        .unwrap();
    }
    email(db, &user.multi_user_id).await
}

async fn reminder_rows(db: &TestDb, organization_id: &str) -> Vec<(DateTime<Utc>, i32)> {
    sqlx::query_as(
        "SELECT paidUntil, leadTimeDays FROM webknossos.organization_planExpiryReminders \
         WHERE _organization = $1 ORDER BY paidUntil, leadTimeDays",
    )
    .bind(organization_id)
    .fetch_all(&db.pool)
    .await
    .unwrap()
}

/// Play's `Instant` precision.
fn millis(instant: DateTime<Utc>) -> DateTime<Utc> {
    instant.duration_trunc(Duration::milliseconds(1)).unwrap()
}

fn recipients_of(mails: &[Mail]) -> Vec<String> {
    let mut recipients: Vec<String> = mails
        .iter()
        .flat_map(|mail| mail.recipients.clone())
        .collect();
    recipients.sort();
    recipients
}

fn sorted(mut values: Vec<String>) -> Vec<String> {
    values.sort();
    values
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn reminds_owner_and_admins_once_per_lead_time() {
    let db = TestDb::new().await;
    let now = Utc::now();
    // Sub-millisecond part to check that the reminder rows use Play's millisecond precision.
    let in_10_days = now + Duration::days(10) - Duration::hours(1) + Duration::microseconds(7);

    // Team plan, 10 days left: the 30 and 14 day lead times are crossed.
    let (team, team_admin) = organization(&db, "Team", Some(in_10_days), true).await;
    let team_owner = add_user(&db, &team, false, "isOrganizationOwner = TRUE").await;
    add_user(&db, &team, false, "").await; // plain member: not notified
    add_user(&db, &team, true, "isDeactivated = TRUE").await; // deactivated admin: not notified
    // Trial, 10 days left: only the 7 day trial lead time applies, not yet crossed.
    let (trial, _) = organization(&db, "Team_Trial", Some(in_10_days), true).await;
    // Power trial, 3 days left: the 7 day trial lead time is crossed.
    let in_3_days = now + Duration::days(3) - Duration::hours(1);
    let (power_trial, power_trial_admin) =
        organization(&db, "Power_Trial", Some(in_3_days), true).await;
    // Neither owner nor admin: nothing is recorded (checked before inserting), no mail.
    let (no_admin, _) = organization(&db, "Power", Some(in_10_days), false).await;
    // Excluded by the query: Personal plan, expired, too far away, no paidUntil.
    let (personal, _) = organization(&db, "Personal", Some(in_10_days), true).await;
    let (expired, _) = organization(&db, "Team", Some(now - Duration::hours(1)), true).await;
    let (far, _) = organization(&db, "Team", Some(now + Duration::days(31)), true).await;
    let (unlimited, _) = organization(&db, "Custom", None, true).await;
    // Already reminded for 30 days: only the 14 day reminder is new, which still sends mails.
    let (partial, partial_admin) = organization(&db, "Custom", Some(in_10_days), true).await;
    sqlx::query(
        "INSERT INTO webknossos.organization_planExpiryReminders \
         (_organization, paidUntil, leadTimeDays) VALUES ($1, $2, 30)",
    )
    .bind(&partial)
    .bind(millis(in_10_days))
    .execute(&db.pool)
    .await
    .unwrap();
    // Already reminded for every crossed lead time: no mail.
    let (done, _) = organization(&db, "Team", Some(in_10_days), true).await;
    sqlx::query(
        "INSERT INTO webknossos.organization_planExpiryReminders \
         (_organization, paidUntil, leadTimeDays) VALUES ($1, $2, 30), ($1, $2, 14)",
    )
    .bind(&done)
    .bind(millis(in_10_days))
    .execute(&db.pool)
    .await
    .unwrap();

    let recorder = RecordingMailer::default();
    let config = PricingPlanExpiryReminderConfig {
        schedule: webknossos_backend::background::scheduler::JobSchedule {
            enabled: true,
            ..PricingPlanExpiryReminderConfig::default().schedule
        },
        ..PricingPlanExpiryReminderConfig::default()
    };
    let reminder = PricingPlanExpiryReminder::new(
        config,
        MailSender::new(recorder.clone()),
        URI.into(),
        SUPPORT.into(),
    );

    let outcome = reminder.tick_at(&db.pool, now).await.unwrap();
    assert_eq!(
        outcome,
        JobOutcome::Completed("Checked 6 organizations with expiring plans, reminded 3.".into())
    );
    let paid_until = millis(in_10_days);
    assert_eq!(
        reminder_rows(&db, &team).await,
        vec![(paid_until, 14), (paid_until, 30)]
    );
    assert_eq!(
        reminder_rows(&db, &power_trial).await,
        vec![(millis(in_3_days), 7)]
    );
    assert_eq!(
        reminder_rows(&db, &partial).await,
        vec![(paid_until, 14), (paid_until, 30)]
    );
    for organization_id in [&trial, &no_admin, &personal, &expired, &far, &unlimited] {
        assert!(
            reminder_rows(&db, organization_id).await.is_empty(),
            "{organization_id}"
        );
    }
    assert_eq!(reminder_rows(&db, &done).await.len(), 2);

    let mails = recorder.take();
    assert_eq!(
        recipients_of(&mails),
        sorted(vec![
            team_admin.clone(),
            team_owner.clone(),
            power_trial_admin.clone(),
            partial_admin.clone(),
        ])
    );
    let team_mail = mails
        .iter()
        .find(|mail| mail.recipients == vec![team_owner.clone()])
        .unwrap();
    assert_eq!(team_mail.from, DEFAULT_SENDER);
    assert_eq!(team_mail.reply_to, vec![SUPPORT.to_owned()]);
    assert_eq!(
        team_mail.subject,
        format!(
            "WEBKNOSSOS | Your Team plan expires on {}",
            format_date_only(paid_until)
        )
    );
    assert!(team_mail.body_html.contains("Hi Rust Test,"));
    assert!(team_mail.body_html.contains(&format!("<i>{team} name</i>")));
    assert!(team_mail.body_html.contains("— that is in 10 days."));
    assert!(
        team_mail
            .body_html
            .contains("href=\"https://wk.example/organization/overview\"")
    );
    let trial_mail = mails
        .iter()
        .find(|mail| mail.recipients == vec![power_trial_admin.clone()])
        .unwrap();
    assert!(
        trial_mail
            .subject
            .starts_with("WEBKNOSSOS | Your Power (Trial) plan expires on ")
    );
    assert!(trial_mail.body_html.contains("<i>Power (Trial)</i>"));
    assert!(trial_mail.body_html.contains("— that is in 3 days."));
    let custom_mail = mails
        .iter()
        .find(|mail| mail.recipients == vec![partial_admin.clone()])
        .unwrap();
    assert!(custom_mail.subject.contains("Your Custom plan"));

    // A second tick sends nothing.
    let outcome = reminder.tick_at(&db.pool, now).await.unwrap();
    assert_eq!(
        outcome,
        JobOutcome::Completed("Checked 6 organizations with expiring plans, reminded 0.".into())
    );
    assert!(recorder.take().is_empty());

    // Time passes: one day before expiry the 7 day lead time is crossed as well.
    let later = now + Duration::days(9);
    reminder.tick_at(&db.pool, later).await.unwrap();
    assert_eq!(
        reminder_rows(&db, &team).await,
        vec![(paid_until, 7), (paid_until, 14), (paid_until, 30)]
    );
    let mails = recorder.take();
    let team_mails: Vec<&Mail> = mails
        .iter()
        .filter(|mail| mail.recipients == vec![team_admin.clone()])
        .collect();
    assert_eq!(team_mails.len(), 1);
    assert!(team_mails[0].body_html.contains("— that is tomorrow."));

    // Extending the plan re-arms the reminders for the new expiry date.
    let extended = now + Duration::days(12);
    sqlx::query("UPDATE webknossos.organizations SET paidUntil = $2 WHERE _id = $1")
        .bind(&team)
        .bind(extended)
        .execute(&db.pool)
        .await
        .unwrap();
    reminder.tick_at(&db.pool, now).await.unwrap();
    let mails = recorder.take();
    assert_eq!(
        recipients_of(
            &mails
                .into_iter()
                .filter(|mail| mail.subject.contains("Team plan"))
                .collect::<Vec<_>>()
        ),
        sorted(vec![team_admin, team_owner])
    );
    assert_eq!(
        reminder_rows(&db, &team)
            .await
            .into_iter()
            .filter(|(paid_until, _)| *paid_until == millis(extended))
            .map(|(_, days)| days)
            .collect::<Vec<_>>(),
        vec![14, 30]
    );

    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn tick_is_skipped_while_another_instance_holds_the_lock() {
    let db = TestDb::new().await;
    let now = Utc::now();
    let (team, _) = organization(&db, "Team", Some(now + Duration::days(5)), true).await;
    let recorder = RecordingMailer::default();
    let reminder = PricingPlanExpiryReminder::new(
        PricingPlanExpiryReminderConfig::default(),
        MailSender::new(recorder.clone()),
        URI.into(),
        SUPPORT.into(),
    );

    let mut holder = db.pool.begin().await.unwrap();
    assert!(
        try_advisory_xact_lock(&mut holder, advisory_lock_key(JOB_NAME))
            .await
            .unwrap()
    );
    assert_eq!(
        reminder.tick_at(&db.pool, now).await.unwrap(),
        JobOutcome::SkippedLocked
    );
    assert!(reminder_rows(&db, &team).await.is_empty());
    assert!(recorder.take().is_empty());
    holder.rollback().await.unwrap();

    assert_eq!(
        reminder.tick_at(&db.pool, now).await.unwrap(),
        JobOutcome::Completed("Checked 1 organizations with expiring plans, reminded 1.".into())
    );
    assert_eq!(reminder_rows(&db, &team).await.len(), 3);
    assert_eq!(recorder.take().len(), 1);

    db.cleanup().await;
}
