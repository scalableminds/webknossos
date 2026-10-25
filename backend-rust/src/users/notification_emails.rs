//! NotificationEmailService: informs users by email when someone else changes
//! what they have access to or what they should work on: annotations and
//! datasets shared with their teams, annotations transferred to them, changes
//! of their team memberships and roles, and tasks manually assigned to them.
//! Changes a user makes themselves are never announced.
//!
//! The emails are assembled and sent in the background (like Play's
//! `inBackground` + `Mailer ! Send`), so failing to send them never fails the
//! actual change. Delivery goes through the shared [`MailSender`].
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use sqlx::{Acquire, FromRow, PgPool, Postgres, Transaction};

use crate::{
    mail::{Mail, MailSender, NotificationEmailSettings, templates},
    msg::notification_email as msg,
    sql::{Arg, Requester, Sql},
};

/// How long changes after an activation still count as onboarding.
const RECENT_ACTIVATION: Duration = Duration::from_secs(60 * 60);

/// One team membership (`TeamMembership`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TeamMembership {
    pub team_id: String,
    pub is_team_manager: bool,
}

impl TeamMembership {
    pub fn new(team_id: impl Into<String>, is_team_manager: bool) -> Self {
        Self {
            team_id: team_id.into(),
            is_team_manager,
        }
    }
}

/// The parts of a `User` the access-changed email depends on.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct UserAccess {
    pub is_admin: bool,
    pub is_dataset_manager: bool,
    pub is_deactivated: bool,
}

/// NotificationEmailService.accessChanges: human-readable descriptions of how
/// the team memberships and roles of a user changed. Role changes come first,
/// then team changes in the order of the new memberships, then removals.
pub fn access_changes(
    old_memberships: &[TeamMembership],
    new_memberships: &[TeamMembership],
    before: UserAccess,
    after: UserAccess,
    team_names: &HashMap<String, String>,
) -> Vec<String> {
    let team_name = |team_id: &str| {
        team_names
            .get(team_id)
            .cloned()
            .unwrap_or_else(|| team_id.to_owned())
    };
    let old_by_id: HashMap<&str, &TeamMembership> = old_memberships
        .iter()
        .map(|membership| (membership.team_id.as_str(), membership))
        .collect();
    let new_ids: HashSet<&str> = new_memberships
        .iter()
        .map(|membership| membership.team_id.as_str())
        .collect();

    let mut changes = Vec::new();
    if !before.is_admin && after.is_admin {
        changes.push(msg::NOW_ADMIN.to_owned());
    }
    if before.is_admin && !after.is_admin {
        changes.push(msg::NO_LONGER_ADMIN.to_owned());
    }
    if !before.is_dataset_manager && after.is_dataset_manager {
        changes.push(msg::NOW_DATASET_MANAGER.to_owned());
    }
    if before.is_dataset_manager && !after.is_dataset_manager {
        changes.push(msg::NO_LONGER_DATASET_MANAGER.to_owned());
    }
    for membership in new_memberships {
        let name = || team_name(&membership.team_id);
        match old_by_id.get(membership.team_id.as_str()) {
            None if membership.is_team_manager => {
                changes.push(msg::added_to_team_as_manager(name()));
            }
            None => changes.push(msg::added_to_team(name())),
            Some(old) if !old.is_team_manager && membership.is_team_manager => {
                changes.push(msg::now_team_manager(name()));
            }
            Some(old) if old.is_team_manager && !membership.is_team_manager => {
                changes.push(msg::no_longer_team_manager(name()));
            }
            Some(_) => {}
        }
    }
    changes.extend(
        old_memberships
            .iter()
            .filter(|membership| !new_ids.contains(membership.team_id.as_str()))
            .map(|membership| msg::removed_from_team(team_name(&membership.team_id))),
    );
    changes
}

/// `newTeamIds.filterNot(oldTeamIds.contains)`.
pub fn added_team_ids(old_team_ids: &[String], new_team_ids: &[String]) -> Vec<String> {
    new_team_ids
        .iter()
        .filter(|team| !old_team_ids.contains(team))
        .cloned()
        .collect()
}

/// `Annotation.nameOpt.getOrElse("Unnamed annotation")`.
pub fn annotation_name(name: &str) -> &str {
    if name.is_empty() {
        msg::UNNAMED_ANNOTATION
    } else {
        name
    }
}

/// What was shared with the added teams.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SharedResource {
    /// Recipients must see the annotation in their annotation list
    /// (AnnotationDAO.findUserIdsWithListAccess).
    Annotation { id: String },
    /// Recipients must be able to read the dataset
    /// (DatasetDAO.findUserIdsWithReadAccess).
    Dataset { id: String },
}

impl SharedResource {
    fn description(&self) -> String {
        match self {
            Self::Annotation { id } => format!("annotation {id} shared with teams"),
            Self::Dataset { id } => format!("dataset {id} shared with teams"),
        }
    }

    fn id(&self) -> &str {
        match self {
            Self::Annotation { id } | Self::Dataset { id } => id,
        }
    }

    /// Those of the candidate users with access to the resource. The
    /// requester-based access predicates are evaluated per candidate: the
    /// requester becomes `candidate._id`, the organization scope the
    /// candidate's organization.
    fn access_query<'a>(&'a self, user_ids: &'a [&'a str]) -> Sql<'a> {
        let candidate = Requester {
            id: Arg::Sql("candidate._id"),
            organization: Arg::Sql("candidate._organization"),
            is_admin: false,
        };
        let mut q = Sql::new("SELECT candidate._id FROM webknossos.users_ candidate JOIN ");
        match self {
            Self::Annotation { .. } => q.push("webknossos.annotations_ a ON a._id = "),
            Self::Dataset { .. } => q.push("webknossos.datasets_ d ON d._id = "),
        }
        .push_bind(self.id())
        .push(" WHERE candidate._id = ANY(")
        .push_bind(user_ids)
        .push(") AND ");
        match self {
            Self::Annotation { .. } => {
                crate::annotation::lists::push_list_grant(&mut q, candidate, true);
            }
            Self::Dataset { .. } => {
                crate::dataset::access::push_read_predicate(&mut q, candidate.id, None);
            }
        }
        q
    }
}

/// A team member who might gain access through the update.
#[derive(Clone, Debug, FromRow, PartialEq, Eq)]
pub struct Candidate {
    pub user_id: String,
    /// The added teams the user is a member of.
    pub team_ids: Vec<String>,
}

/// Who might be notified about a team share, captured before the update.
#[derive(Debug)]
pub struct PendingShareEmails {
    resource: SharedResource,
    added_team_ids: Vec<String>,
    candidates: Vec<Candidate>,
    had_access: HashSet<String>,
}

/// Candidates that have access after the update but did not before.
pub fn newly_allowed<'a>(
    candidates: &'a [Candidate],
    had_access: &HashSet<String>,
    has_access: &HashSet<String>,
) -> Vec<&'a Candidate> {
    candidates
        .iter()
        .filter(|candidate| {
            has_access.contains(&candidate.user_id) && !had_access.contains(&candidate.user_id)
        })
        .collect()
}

/// The names of the added teams the recipient is a member of, in the order
/// the teams were added. Teams deleted in the meantime are left out.
pub fn recipient_team_names(
    added_team_ids: &[String],
    recipient_team_ids: &[String],
    team_names: &HashMap<String, String>,
) -> Vec<String> {
    added_team_ids
        .iter()
        .filter(|team| recipient_team_ids.contains(team))
        .filter_map(|team| team_names.get(team).cloned())
        .collect()
}

#[derive(FromRow)]
struct Person {
    user_id: String,
    email: String,
    first_name: String,
    last_name: String,
}

impl Person {
    fn full_name(&self) -> String {
        format!("{} {}", self.first_name, self.last_name)
    }
}

/// Shared handle installed as a request extension.
#[derive(Clone)]
pub struct NotificationEmailService {
    mailer: MailSender,
    uri: Arc<str>,
    /// Users that were activated recently. The user list activates users in
    /// one request and offers to configure their teams and roles in a
    /// follow-up request, so changes shortly after the activation are still
    /// part of the onboarding, which the activation email already covers.
    /// Kept in memory only, as losing it on a restart merely causes one extra
    /// email.
    recently_activated: Arc<Mutex<HashMap<String, Instant>>>,
}

impl std::fmt::Debug for NotificationEmailService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("NotificationEmailService")
    }
}

impl NotificationEmailService {
    /// `uri` is the public WEBKNOSSOS URI used in links (`http.uri`).
    pub fn new(mailer: MailSender, uri: &str) -> Self {
        Self {
            mailer,
            uri: uri.trim_end_matches('/').into(),
            recently_activated: Arc::default(),
        }
    }

    fn settings(&self) -> NotificationEmailSettings {
        self.mailer.settings().notification_emails
    }

    fn annotation_url(&self, annotation_id: &str) -> String {
        format!("{}/annotations/{annotation_id}", self.uri)
    }

    /// Whether an annotation transferred by `issuer_id` to `new_owner_id` is
    /// announced (the new owner's activation is checked when sending).
    pub fn wants_transfer_email(&self, new_owner_id: &str, issuer_id: &str) -> bool {
        self.settings().access_changes && new_owner_id != issuer_id
    }

    /// Whether a task manually assigned by `issuer_id` is announced.
    pub fn wants_task_assigned_email(
        &self,
        assignee_id: &str,
        assignee_is_deactivated: bool,
        issuer_id: &str,
    ) -> bool {
        self.settings().manual_task_assignments
            && assignee_id != issuer_id
            && !assignee_is_deactivated
    }

    /// Records activations and decides whether a change of the user's access
    /// is announced. Only changes to users that stay active are announced.
    /// Users that were just activated already get the activation mail, so
    /// changes during their first hour after the activation are not announced
    /// separately.
    pub fn wants_access_changed_email(
        &self,
        user_id: &str,
        before: UserAccess,
        after: UserAccess,
        issuer_id: &str,
    ) -> bool {
        let recently_activated = {
            let mut activated = self
                .recently_activated
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            activated.retain(|_, at| at.elapsed() < RECENT_ACTIVATION);
            if before.is_deactivated && !after.is_deactivated {
                activated
                    .entry(user_id.to_owned())
                    .or_insert_with(Instant::now);
            }
            activated.contains_key(user_id)
        };
        let stays_active = !before.is_deactivated && !after.is_deactivated;
        self.settings().access_changes
            && user_id != issuer_id
            && stays_active
            && !recently_activated
    }

    fn send(&self, mail: Mail) {
        self.mailer.send(mail);
    }

    // -----------------------------------------------------------------------
    // Shared with teams (annotation sharedTeams, dataset allowed teams)
    // -----------------------------------------------------------------------

    /// First half of `updateAndEmailNewlyAllowedTeamMembers`, to run inside
    /// the update's transaction before the update: the members of the added
    /// teams (deactivated, unlisted and excluded users left out) and which of
    /// them already have access. Failing to determine this only skips the
    /// notification (the queries run in a savepoint), it never fails the
    /// update itself.
    pub async fn prepare_share_emails(
        &self,
        transaction: &mut Transaction<'_, Postgres>,
        resource: SharedResource,
        old_team_ids: &[String],
        new_team_ids: &[String],
        exclude: &[&str],
    ) -> Option<PendingShareEmails> {
        let added_team_ids = added_team_ids(old_team_ids, new_team_ids);
        if !self.settings().access_changes || added_team_ids.is_empty() {
            return None;
        }
        let exclude: Vec<&str> = exclude.to_vec();
        let prepared = async {
            let mut savepoint = transaction.begin().await?;
            let candidates: Vec<Candidate> = sqlx::query_as(
                "SELECT u._id AS user_id, array_agg(DISTINCT r._team ORDER BY r._team) AS team_ids
                 FROM webknossos.users_ u JOIN webknossos.user_team_roles r ON r._user = u._id
                 WHERE r._team = ANY($1) AND NOT u.isDeactivated AND NOT u.isUnlisted
                 AND NOT (u._id = ANY($2))
                 GROUP BY u._id ORDER BY u._id",
            )
            .bind(&added_team_ids)
            .bind(&exclude)
            .fetch_all(&mut *savepoint)
            .await?;
            let user_ids: Vec<&str> = candidates.iter().map(|c| c.user_id.as_str()).collect();
            let had_access: Vec<String> = if user_ids.is_empty() {
                Vec::new()
            } else {
                resource
                    .access_query(&user_ids)
                    .build_query_scalar()
                    .fetch_all(&mut *savepoint)
                    .await?
            };
            // Read-only: dropping the savepoint rolls it back.
            drop(savepoint);
            Ok::<_, sqlx::Error>((candidates, had_access))
        }
        .await;
        match prepared {
            Ok((candidates, had_access)) => Some(PendingShareEmails {
                resource,
                added_team_ids,
                candidates,
                had_access: had_access.into_iter().collect(),
            }),
            Err(error) => {
                tracing::warn!(
                    %error,
                    "Could not send notification email for {}",
                    resource.description()
                );
                None
            }
        }
    }

    /// Second half of `updateAndEmailNewlyAllowedTeamMembers`, after the
    /// update was committed: notifies the candidates who gained access.
    pub fn send_share_emails(
        &self,
        pool: &PgPool,
        pending: Option<PendingShareEmails>,
        sharer_id: &str,
    ) {
        let Some(pending) = pending else {
            return;
        };
        if pending.candidates.is_empty() {
            return;
        }
        let (service, pool, sharer_id) = (self.clone(), pool.clone(), sharer_id.to_owned());
        tokio::spawn(async move {
            let description = pending.resource.description();
            if let Err(error) = service.share_emails(&pool, pending, &sharer_id).await {
                tracing::warn!(%error, "Could not send notification email for {description}");
            }
        });
    }

    async fn share_emails(
        &self,
        pool: &PgPool,
        pending: PendingShareEmails,
        sharer_id: &str,
    ) -> Result<(), sqlx::Error> {
        let PendingShareEmails {
            resource,
            added_team_ids,
            candidates,
            had_access,
        } = pending;
        let user_ids: Vec<&str> = candidates.iter().map(|c| c.user_id.as_str()).collect();
        let has_access: HashSet<String> = resource
            .access_query(&user_ids)
            .build_query_scalar::<String>()
            .fetch_all(pool)
            .await?
            .into_iter()
            .collect();
        let recipients = newly_allowed(&candidates, &had_access, &has_access);
        if recipients.is_empty() {
            return Ok(());
        }
        let team_names = team_names(pool, &added_team_ids).await?;
        let sharer_name = person(pool, sharer_id).await?.full_name();
        let recipient_ids: Vec<&str> = recipients.iter().map(|r| r.user_id.as_str()).collect();
        let people: HashMap<String, Person> = people(pool, &recipient_ids)
            .await?
            .into_iter()
            .map(|person| (person.user_id.clone(), person))
            .collect();
        // The resource as it is named in the emails.
        enum Named {
            Annotation {
                name: String,
                dataset_name: String,
                url: String,
            },
            Dataset {
                name: String,
                url: String,
            },
        }
        let named = match &resource {
            SharedResource::Annotation { id } => {
                let (name, dataset_name): (String, String) = sqlx::query_as(
                    "SELECT a.name, d.name FROM webknossos.annotations_ a
                     JOIN webknossos.datasets_ d ON d._id = a._dataset WHERE a._id = $1",
                )
                .bind(id)
                .fetch_one(pool)
                .await?;
                Named::Annotation {
                    name,
                    dataset_name,
                    url: self.annotation_url(id),
                }
            }
            SharedResource::Dataset { id } => Named::Dataset {
                name: sqlx::query_scalar("SELECT name FROM webknossos.datasets_ WHERE _id = $1")
                    .bind(id)
                    .fetch_one(pool)
                    .await?,
                // The dataset name is left out, as it may contain characters
                // that are not valid in a URL path.
                url: format!("{}/datasets/{id}/view", self.uri),
            },
        };
        let mail = |recipient: &Person, teams: &[String]| match &named {
            Named::Annotation {
                name,
                dataset_name,
                url,
            } => templates::annotation_shared(
                &recipient.full_name(),
                &recipient.email,
                &sharer_name,
                annotation_name(name),
                dataset_name,
                teams,
                url,
            ),
            Named::Dataset { name, url } => templates::dataset_shared(
                &recipient.full_name(),
                &recipient.email,
                &sharer_name,
                name,
                teams,
                url,
            ),
        };
        for recipient in recipients {
            let Some(person) = people.get(&recipient.user_id) else {
                continue;
            };
            let teams = recipient_team_names(&added_team_ids, &recipient.team_ids, &team_names);
            self.send(mail(person, &teams));
        }
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Annotation transferred
    // -----------------------------------------------------------------------

    /// After an annotation was transferred to `new_owner_id`. Deactivated
    /// users cannot log in, so there is nothing for them to act on.
    pub fn send_annotation_transferred_email(
        &self,
        pool: &PgPool,
        annotation_id: &str,
        annotation_name: &str,
        dataset_id: &str,
        new_owner_id: &str,
        issuer_id: &str,
    ) {
        if !self.wants_transfer_email(new_owner_id, issuer_id) {
            return;
        }
        let service = self.clone();
        let pool = pool.clone();
        let [
            annotation_id,
            annotation_name,
            dataset_id,
            new_owner_id,
            issuer_id,
        ] = [
            annotation_id,
            annotation_name,
            dataset_id,
            new_owner_id,
            issuer_id,
        ]
        .map(str::to_owned);
        tokio::spawn(async move {
            let result = async {
                let is_deactivated: bool = sqlx::query_scalar(
                    "SELECT isDeactivated FROM webknossos.users_ WHERE _id = $1",
                )
                .bind(&new_owner_id)
                .fetch_one(&pool)
                .await?;
                if is_deactivated {
                    return Ok(());
                }
                let recipient = person(&pool, &new_owner_id).await?;
                let issuer = person(&pool, &issuer_id).await?;
                let dataset_name: String =
                    sqlx::query_scalar("SELECT name FROM webknossos.datasets_ WHERE _id = $1")
                        .bind(&dataset_id)
                        .fetch_one(&pool)
                        .await?;
                service.send(templates::annotation_transferred(
                    &recipient.full_name(),
                    &recipient.email,
                    &issuer.full_name(),
                    self::annotation_name(&annotation_name),
                    &dataset_name,
                    &service.annotation_url(&annotation_id),
                ));
                Ok::<_, sqlx::Error>(())
            }
            .await;
            if let Err(error) = result {
                tracing::warn!(
                    %error,
                    "Could not send notification email for annotation {annotation_id} transferred to user {new_owner_id}"
                );
            }
        });
    }

    // -----------------------------------------------------------------------
    // Access changed
    // -----------------------------------------------------------------------

    /// After the team memberships or roles of `user_id` were updated.
    #[allow(clippy::too_many_arguments)]
    pub fn send_access_changed_email(
        &self,
        pool: &PgPool,
        user_id: &str,
        before: UserAccess,
        old_memberships: Vec<TeamMembership>,
        after: UserAccess,
        new_memberships: Vec<TeamMembership>,
        issuer_id: &str,
    ) {
        if !self.wants_access_changed_email(user_id, before, after, issuer_id) {
            return;
        }
        let service = self.clone();
        let pool = pool.clone();
        let (user_id, issuer_id) = (user_id.to_owned(), issuer_id.to_owned());
        tokio::spawn(async move {
            let result = async {
                let mut team_ids: Vec<String> = old_memberships
                    .iter()
                    .chain(&new_memberships)
                    .map(|membership| membership.team_id.clone())
                    .collect();
                team_ids.sort();
                team_ids.dedup();
                let team_names = team_names(&pool, &team_ids).await?;
                let changes = access_changes(
                    &old_memberships,
                    &new_memberships,
                    before,
                    after,
                    &team_names,
                );
                if changes.is_empty() {
                    return Ok(());
                }
                let recipient = person(&pool, &user_id).await?;
                let issuer = person(&pool, &issuer_id).await?;
                let organization_name: String = sqlx::query_scalar(
                    "SELECT o.name FROM webknossos.users_ u
                     JOIN webknossos.organizations_ o ON o._id = u._organization WHERE u._id = $1",
                )
                .bind(&user_id)
                .fetch_one(&pool)
                .await?;
                service.send(templates::access_changed(
                    &recipient.full_name(),
                    &recipient.email,
                    &issuer.full_name(),
                    &organization_name,
                    &changes,
                    &format!("{}/dashboard", service.uri),
                ));
                Ok::<_, sqlx::Error>(())
            }
            .await;
            if let Err(error) = result {
                tracing::warn!(
                    %error,
                    "Could not send notification email for access of user {user_id} changed"
                );
            }
        });
    }

    // -----------------------------------------------------------------------
    // Task assigned
    // -----------------------------------------------------------------------

    /// After a task was manually assigned; `annotation_id` is the created
    /// task annotation.
    pub fn send_task_assigned_email(
        &self,
        pool: &PgPool,
        task_id: &str,
        annotation_id: &str,
        assignee_id: &str,
        assignee_is_deactivated: bool,
        issuer_id: &str,
    ) {
        if !self.wants_task_assigned_email(assignee_id, assignee_is_deactivated, issuer_id) {
            return;
        }
        let service = self.clone();
        let pool = pool.clone();
        let [task_id, annotation_id, assignee_id, issuer_id] =
            [task_id, annotation_id, assignee_id, issuer_id].map(str::to_owned);
        tokio::spawn(async move {
            let result = async {
                let recipient = person(&pool, &assignee_id).await?;
                let issuer = person(&pool, &issuer_id).await?;
                let (project_name, task_type_summary): (String, String) = sqlx::query_as(
                    "SELECT p.name, tt.summary FROM webknossos.tasks_ t
                     JOIN webknossos.projects_ p ON p._id = t._project
                     JOIN webknossos.taskTypes_ tt ON tt._id = t._taskType
                     WHERE t._id = $1",
                )
                .bind(&task_id)
                .fetch_one(&pool)
                .await?;
                service.send(templates::task_assigned(
                    &recipient.full_name(),
                    &recipient.email,
                    &issuer.full_name(),
                    &project_name,
                    &task_type_summary,
                    &service.annotation_url(&annotation_id),
                ));
                Ok::<_, sqlx::Error>(())
            }
            .await;
            if let Err(error) = result {
                tracing::warn!(
                    %error,
                    "Could not send notification email for task {task_id} assigned to user {assignee_id}"
                );
            }
        });
    }
}

/// TeamDAO.findAllByIds (global): names of the live teams among `team_ids`.
async fn team_names(
    pool: &PgPool,
    team_ids: &[String],
) -> Result<HashMap<String, String>, sqlx::Error> {
    Ok(sqlx::query_as::<_, (String, String)>(
        "SELECT _id, name FROM webknossos.teams_ WHERE _id = ANY($1)",
    )
    .bind(team_ids)
    .fetch_all(pool)
    .await?
    .into_iter()
    .collect())
}

const PERSON: &str =
    "SELECT u._id AS user_id, m.email, m.firstName AS first_name, m.lastName AS last_name
    FROM webknossos.users u JOIN webknossos.multiUsers_ m ON m._id = u._multiUser";

/// The multi user (name and email) of a user.
async fn person(pool: &PgPool, user_id: &str) -> Result<Person, sqlx::Error> {
    Sql::new(PERSON)
        .push(" WHERE u._id = ")
        .push_bind(user_id)
        .build_query_as()
        .fetch_one(pool)
        .await
}

async fn people(pool: &PgPool, user_ids: &[&str]) -> Result<Vec<Person>, sqlx::Error> {
    Sql::new(PERSON)
        .push(" WHERE u._id = ANY(")
        .push_bind(user_ids)
        .push(")")
        .build_query_as()
        .fetch_all(pool)
        .await
}

#[cfg(test)]
mod tests;
