//! OrganizationController pricing routes: upgrade requests, pricing status
//! and plan updates (`models.organization.{PricingPlan, UpgradeRequest,
//! OrganizationPlanUpdate, PricingPlanFeatures}`).
mod organization_pricing_dao;

use axum::{
    Router,
    extract::State,
    response::Response,
    routing::{get, post},
};
use chrono::{DateTime, Duration, Utc};
use serde::Deserialize;
use serde_json::{Map, Value, json};

use crate::{
    AppState,
    auth::AuthUser,
    error::{ApiError, ApiResult},
    extract::Json,
    mail::{Mail, MailSender, templates},
    system::application_info::{MiscState, ok_empty},
};

pub(crate) mod messages {
    pub const PRICING_UPDATES_ONLY_ADMIN: &str = "You do not have permission to request any changes to your organization WEBKNOSSOS plan. Please contact an organization admin.";
    pub const LIST_PLAN_UPDATES_ONLY_ADMIN: &str =
        "Only organization admins can list plan updates.";
    pub const CREDIT_ORDERS_ONLY_OWNER: &str = "You do not have permission to order WEBKNOSSOS credits for your organization. Please contact the organization owner.";
    pub const UPGRADE_REQUEST_EMPTY: &str = "The upgrade request does not contain any changes.";
    pub const UPGRADE_REQUEST_INVALID_AMOUNT: &str = "All requested amounts must be positive.";
    pub const UPGRADE_REQUEST_INVALID_PLAN: &str =
        "Only an upgrade to the Team or Power plan can be requested.";
    pub const UPGRADE_REQUEST_AI_ADDON_NOT_AVAILABLE: &str =
        "The AI Add-on is already active or requires at least the Team plan.";
    pub fn upgrade_request_note_too_long(max_length: usize) -> String {
        format!("The note of the upgrade request must not be longer than {max_length} characters.")
    }
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/pricing/upgradeRequest", post(upgrade_request))
        .route("/pricing/status", get(status))
        .route("/pricing/updatePlan", post(update_plan))
        .route("/pricing/planUpdates", get(plan_updates))
}

// ---------------------------------------------------------------------------
// PricingPlan

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[allow(non_camel_case_types)]
pub(crate) enum PricingPlan {
    Personal,
    Team,
    Power,
    Team_Trial,
    Power_Trial,
    Custom,
}

impl PricingPlan {
    pub(crate) fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "Personal" => Self::Personal,
            "Team" => Self::Team,
            "Power" => Self::Power,
            "Team_Trial" => Self::Team_Trial,
            "Power_Trial" => Self::Power_Trial,
            "Custom" => Self::Custom,
            _ => return None,
        })
    }

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Personal => "Personal",
            Self::Team => "Team",
            Self::Power => "Power",
            Self::Team_Trial => "Team_Trial",
            Self::Power_Trial => "Power_Trial",
            Self::Custom => "Custom",
        }
    }

    /// Mirrors PLAN_TO_RANK in the frontend's pricing_plan_utils.ts.
    fn tier_rank(self) -> u8 {
        match self {
            Self::Personal => 0,
            Self::Team | Self::Team_Trial => 1,
            Self::Power | Self::Power_Trial | Self::Custom => 2,
        }
    }

    fn is_upgrade(previous: Self, new: Self) -> bool {
        new.tier_rank() > previous.tier_rank()
    }

    fn label(self) -> &'static str {
        match self {
            Self::Team_Trial => "Team (Trial)",
            Self::Power_Trial => "Power (Trial)",
            other => other.as_str(),
        }
    }

    fn ai_addon_label(self) -> &'static str {
        match self {
            Self::Team | Self::Team_Trial => "Team AI",
            Self::Power | Self::Power_Trial => "Power AI",
            _ => "AI Add-on",
        }
    }

    fn feature_highlights(self) -> Option<&'static [&'static str]> {
        const TEAM: &[&str] = &[
            "Collaborative Annotation",
            "Project Management",
            "Dataset Management and Access Control",
            "More users and storage",
            "Eligible for the AI Add-on and AI model training",
            "Priority Email Support",
        ];
        const POWER: &[&str] = &[
            "Segmentation Proof-Reading Tool",
            "Eligible for the AI Add-on and AI model training",
        ];
        match self {
            Self::Team | Self::Team_Trial => Some(TEAM),
            Self::Power | Self::Power_Trial => Some(POWER),
            _ => None,
        }
    }
}

/// PricingPlanFeatures.unlockedBy: plan label and the highlights of every
/// gained tier (deduplicated), or None for non-upgrades and Custom.
fn unlocked_features(
    previous: PricingPlan,
    new: PricingPlan,
) -> Option<(&'static str, Vec<&'static str>)> {
    new.feature_highlights()?;
    if !PricingPlan::is_upgrade(previous, new) {
        return None;
    }
    let mut highlights: Vec<&'static str> = Vec::new();
    for tier in [PricingPlan::Team, PricingPlan::Power] {
        if tier.tier_rank() > previous.tier_rank() && tier.tier_rank() <= new.tier_rank() {
            for highlight in tier.feature_highlights().unwrap_or_default() {
                if !highlights.contains(highlight) {
                    highlights.push(highlight);
                }
            }
        }
    }
    Some((new.label(), highlights))
}

fn parse_ai_plan(value: &str) -> Option<&'static str> {
    match value {
        "Team_AI" => Some("Team_AI"),
        "Power_AI" => Some("Power_AI"),
        _ => None,
    }
}

/// Formatter.formatCount with TextUtils.pluralize.
fn format_count(count: i32, singular: &str) -> String {
    if count == 1 {
        format!("{count} {singular}")
    } else {
        format!("{count} {singular}s")
    }
}

fn invalid_json() -> ApiError {
    ApiError::bad_request(crate::msg::request::INVALID_JSON_BODY)
}

// ---------------------------------------------------------------------------
// POST /pricing/upgradeRequest

const MAX_NOTE_LENGTH: usize = 10000;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpgradeRequest {
    plan: Option<PricingPlan>,
    users: Option<i32>,
    #[serde(rename = "storageTB")]
    storage_tb: Option<i32>,
    ai_addon: Option<bool>,
    credits: Option<i32>,
    extend_years: Option<i32>,
    note: Option<String>,
}

impl UpgradeRequest {
    fn has_valid_amounts(&self) -> bool {
        [self.users, self.storage_tb, self.credits, self.extend_years]
            .into_iter()
            .flatten()
            .all(|amount| amount > 0)
    }

    fn describe(&self, current_plan: PricingPlan) -> Vec<String> {
        let effective_plan = self.plan.unwrap_or(current_plan);
        [
            self.plan.map(|plan| {
                format!(
                    "Upgrade from {} to {} plan",
                    current_plan.label(),
                    plan.label()
                )
            }),
            self.users
                .map(|users| format_count(users, "additional user")),
            self.storage_tb
                .map(|storage| format!("{storage} TB additional storage")),
            (self.ai_addon == Some(true))
                .then(|| format!("AI Add-on ({})", effective_plan.ai_addon_label())),
            self.credits
                .map(|credits| format_count(credits, "WEBKNOSSOS credit")),
            self.extend_years
                .map(|years| format!("Plan extension by {}", format_count(years, "year"))),
        ]
        .into_iter()
        .flatten()
        .collect()
    }
}

fn upgrade_request_mail(
    support_email: &str,
    name: &str,
    email: &str,
    organization_name: &str,
    requested_changes: &[String],
    note: Option<&str>,
) -> Mail {
    templates::upgrade_request(
        name,
        email,
        organization_name,
        requested_changes,
        note,
        support_email,
    )
}

async fn upgrade_request(
    State(state): State<AppState>,
    State(misc): State<MiscState>,
    State(mailer): State<MailSender>,
    user: AuthUser,
    Json(request): Json<UpgradeRequest>,
) -> ApiResult<Response> {
    if !user.is_admin {
        return Err(ApiError::bad_request(messages::PRICING_UPDATES_ONLY_ADMIN));
    }
    let (is_owner, email, first_name, last_name) =
        organization_pricing_dao::find_owner_flag_and_contact(&state.pool, &user.id)
            .await?
            .ok_or_else(ApiError::unauthorized)?;
    if request.credits.is_some() && !is_owner {
        return Err(ApiError::bad_request(messages::CREDIT_ORDERS_ONLY_OWNER));
    }
    if !request.has_valid_amounts() {
        return Err(ApiError::bad_request(
            messages::UPGRADE_REQUEST_INVALID_AMOUNT,
        ));
    }
    // Scala's String.length counts UTF-16 code units.
    if request
        .note
        .as_ref()
        .is_some_and(|note| note.encode_utf16().count() > MAX_NOTE_LENGTH)
    {
        return Err(ApiError::bad_request(
            messages::upgrade_request_note_too_long(MAX_NOTE_LENGTH),
        ));
    }
    let (organization_name, pricing_plan, ai_plan) =
        organization_pricing_dao::find_name_and_plans(&state.pool, &user.organization_id)
            .await?
            .ok_or_else(|| {
                ApiError::not_found(crate::msg::organization::not_found(&user.organization_id))
            })?;
    let current_plan = PricingPlan::parse(&pricing_plan).ok_or_else(ApiError::internal)?;
    if let Some(plan) = request.plan
        && !(matches!(plan, PricingPlan::Team | PricingPlan::Power)
            && PricingPlan::is_upgrade(current_plan, plan))
    {
        return Err(ApiError::bad_request(
            messages::UPGRADE_REQUEST_INVALID_PLAN,
        ));
    }
    let effective_plan = request.plan.unwrap_or(current_plan);
    if request.ai_addon == Some(true)
        && !(ai_plan.is_none() && effective_plan.tier_rank() >= PricingPlan::Team.tier_rank())
    {
        return Err(ApiError::bad_request(
            messages::UPGRADE_REQUEST_AI_ADDON_NOT_AVAILABLE,
        ));
    }
    let requested_changes = request.describe(current_plan);
    if requested_changes.is_empty() {
        return Err(ApiError::bad_request(messages::UPGRADE_REQUEST_EMPTY));
    }
    tracing::info!(
        organization = %user.organization_id,
        user = %user.id,
        changes = %requested_changes.join(", "),
        "Received upgrade request"
    );
    let note = request
        .note
        .as_deref()
        .map(str::trim)
        .filter(|note| !note.is_empty());
    mailer.send(upgrade_request_mail(
        &misc.config().support_email,
        &format!("{first_name} {last_name}"),
        &email,
        &organization_name,
        &requested_changes,
        note,
    ));
    Ok(ok_empty())
}

// ---------------------------------------------------------------------------
// GET /pricing/status

async fn status(State(state): State<AppState>, user: AuthUser) -> ApiResult<axum::Json<Value>> {
    let (pricing_plan, included_users, paid_until) =
        organization_pricing_dao::find_plan_limits(&state.pool, &user.organization_id)
            .await?
            .ok_or_else(|| {
                ApiError::bad_request(crate::msg::organization::not_found(&user.organization_id))
            })?;
    let active_users = organization_pricing_dao::count_all_users_for_organization(
        &state.pool,
        &user.organization_id,
    )
    .await?;
    let now = Utc::now();
    // Note that, like Play, this does not yet account for storage.
    let is_exceeded = included_users.is_some_and(|limit| active_users > i64::from(limit))
        || paid_until.is_some_and(|paid_until| paid_until < now);
    let is_almost_exceeded = (active_users > 1
        && included_users.is_some_and(|limit| active_users > i64::from(limit) - 2))
        || paid_until.is_some_and(|paid_until| paid_until - Duration::days(42) < now);
    Ok(axum::Json(json!({
        "pricingPlan": pricing_plan,
        "isExceeded": is_exceeded,
        "isAlmostExceeded": is_almost_exceeded,
    })))
}

// ---------------------------------------------------------------------------
// POST /pricing/updatePlan

/// Option[Option[T]] fields of OrganizationPlanUpdate: an absent key leaves
/// the value unchanged, null resets it.
#[derive(Debug, PartialEq)]
enum Change<T> {
    Unchanged,
    Set(Option<T>),
}

impl<T> Change<T> {
    fn changed(&self) -> bool {
        matches!(self, Self::Set(_))
    }
    fn value(&self) -> Option<&T> {
        match self {
            Self::Set(Some(value)) => Some(value),
            _ => None,
        }
    }
}

#[derive(Debug)]
struct PlanUpdate {
    organization_id: String,
    description: Option<String>,
    pricing_plan: Option<PricingPlan>,
    ai_plan: Change<&'static str>,
    paid_until: Change<DateTime<Utc>>,
    included_users: Change<i32>,
    included_storage: Change<i64>,
    created: DateTime<Utc>,
}

/// Instant's JSON reads: a long, else an ISO-8601 or millisecond string.
fn parse_instant(value: &Value) -> Option<DateTime<Utc>> {
    let millis = match value {
        Value::Number(number) => number.as_i64()?,
        Value::String(text) => text.parse::<i64>().ok().or_else(|| {
            DateTime::parse_from_rfc3339(text)
                .ok()
                .map(|date| date.timestamp_millis())
        })?,
        _ => return None,
    };
    DateTime::from_timestamp_millis(millis)
}

/// ByteCount's JSON reads: a number, or digits with an optional decimal unit.
fn parse_byte_count(value: &Value) -> Option<i64> {
    match value {
        Value::Number(number) => number.as_i64().or_else(|| {
            number
                .as_f64()
                .filter(|f| f.is_finite())
                .map(|f| f.trunc() as i64)
        }),
        Value::String(text) => {
            let normalized: String = text.chars().filter(|c| *c != ' ' && *c != '_').collect();
            let (digits, multiplier) = [
                ("KB", 1_000_i64),
                ("MB", 1_000_000),
                ("GB", 1_000_000_000),
                ("TB", 1_000_000_000_000),
                ("B", 1),
            ]
            .into_iter()
            .find_map(|(unit, multiplier)| {
                normalized
                    .strip_suffix(unit)
                    .map(|digits| (digits, multiplier))
            })
            .unwrap_or((normalized.as_str(), 1));
            if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
            digits.parse::<i64>().ok()?.checked_mul(multiplier)
        }
        _ => None,
    }
}

fn parse_change<T>(
    body: &Map<String, Value>,
    key: &str,
    parse: impl Fn(&Value) -> Option<T>,
) -> ApiResult<Change<T>> {
    match body.get(key) {
        None => Ok(Change::Unchanged),
        Some(Value::Null) => Ok(Change::Set(None)),
        Some(value) => parse(value)
            .map(|value| Change::Set(Some(value)))
            .ok_or_else(invalid_json),
    }
}

fn parse_optional<T>(
    body: &Map<String, Value>,
    key: &str,
    parse: impl Fn(&Value) -> Option<T>,
) -> ApiResult<Option<T>> {
    match body.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => parse(value).map(Some).ok_or_else(invalid_json),
    }
}

fn parse_plan_update(body: &Value) -> ApiResult<PlanUpdate> {
    let body = body.as_object().ok_or_else(invalid_json)?;
    let organization_id = body
        .get("organizationId")
        .and_then(Value::as_str)
        .ok_or_else(invalid_json)?
        .to_owned();
    Ok(PlanUpdate {
        organization_id,
        description: parse_optional(body, "description", |v| v.as_str().map(str::to_owned))?,
        pricing_plan: parse_optional(body, "pricingPlan", |v| {
            v.as_str().and_then(PricingPlan::parse)
        })?,
        ai_plan: parse_change(body, "aiPlan", |v| v.as_str().and_then(parse_ai_plan))?,
        paid_until: parse_change(body, "paidUntil", parse_instant)?,
        included_users: parse_change(body, "includedUsers", |v| {
            v.as_i64().and_then(|n| i32::try_from(n).ok())
        })?,
        included_storage: parse_change(body, "includedStorageBytes", parse_byte_count)?,
        created: parse_optional(body, "created", parse_instant)?.unwrap_or_else(Utc::now),
    })
}

fn pricing_plan_upgraded_mail(
    recipient: &str,
    name: &str,
    organization_name: &str,
    plan_label: &str,
    highlights: &[&str],
    uri: &str,
    support_email: &str,
) -> Mail {
    templates::pricing_plan_upgraded(
        name,
        recipient,
        organization_name,
        plan_label,
        highlights,
        uri,
        support_email,
    )
}

async fn update_plan(
    State(state): State<AppState>,
    State(misc): State<MiscState>,
    State(mailer): State<MailSender>,
    user: AuthUser,
    Json(body): Json<Value>,
) -> ApiResult<Response> {
    let update = parse_plan_update(&body)?;
    if !user.is_superuser {
        return Err(ApiError::bad_request(crate::msg::user::SUPER_USER_ONLY));
    }
    let mut tx = state.pool.begin().await?;
    let (organization_name, previous_plan) =
        organization_pricing_dao::find_name_and_pricing_plan_for_update(
            &mut tx,
            &update.organization_id,
        )
        .await?
        .ok_or_else(|| {
            ApiError::not_found(crate::msg::organization::not_found(&update.organization_id))
        })?;
    let previous_plan = PricingPlan::parse(&previous_plan).ok_or_else(ApiError::internal)?;
    organization_pricing_dao::insert_plan_update(&mut tx, &update).await?;
    organization_pricing_dao::update_plan(&mut tx, &update).await?;
    tx.commit().await?;
    if let Some(new_plan) = update.pricing_plan {
        send_pricing_plan_upgrade_mails(
            &state,
            &misc,
            &mailer,
            &update.organization_id,
            &organization_name,
            previous_plan,
            new_plan,
        )
        .await;
    }
    Ok(ok_empty())
}

/// organizationService.sendPricingPlanUpgradeMails: never fails, as the plan
/// update has already been persisted.
async fn send_pricing_plan_upgrade_mails(
    state: &AppState,
    misc: &MiscState,
    mailer: &MailSender,
    organization_id: &str,
    organization_name: &str,
    previous_plan: PricingPlan,
    new_plan: PricingPlan,
) {
    let Some((plan_label, highlights)) = unlocked_features(previous_plan, new_plan) else {
        return;
    };
    let recipients: Vec<(String, String, String)> =
        match organization_pricing_dao::find_owner_and_admin_contacts(&state.pool, organization_id)
            .await
        {
            Ok(recipients) => recipients,
            Err(error) => {
                tracing::warn!(
                    organization = %organization_id,
                    %error,
                    "Could not notify owner/admins about the pricing plan upgrade"
                );
                return;
            }
        };
    for (email, first_name, last_name) in &recipients {
        mailer.send(pricing_plan_upgraded_mail(
            email,
            &format!("{first_name} {last_name}"),
            organization_name,
            plan_label,
            &highlights,
            &misc.config().public_uri,
            &misc.config().support_email,
        ));
    }
    tracing::info!(
        organization = %organization_id,
        count = recipients.len(),
        previous = previous_plan.as_str(),
        new = new_plan.as_str(),
        "Notified owner/admins about the pricing plan upgrade"
    );
}

// ---------------------------------------------------------------------------
// GET /pricing/planUpdates

fn millis(value: DateTime<Utc>) -> Value {
    json!(value.timestamp_millis())
}

async fn plan_updates(
    State(state): State<AppState>,
    user: AuthUser,
) -> ApiResult<axum::Json<Value>> {
    if !user.is_superuser && !user.is_admin {
        return Err(ApiError::bad_request(
            messages::LIST_PLAN_UPDATES_ONLY_ADMIN,
        ));
    }
    let rows =
        organization_pricing_dao::find_all_plan_updates(&state.pool, &user.organization_id).await?;
    let updates: Vec<Value> = if rows.is_empty() {
        // defaultPlanUpdate: unset limits are omitted (None), not null.
        let row = organization_pricing_dao::find_plan_row(&state.pool, &user.organization_id)
            .await?
            .ok_or_else(|| {
                ApiError::bad_request(crate::msg::organization::not_found(&user.organization_id))
            })?;
        let (pricing_plan, ai_plan, paid_until, included_users, included_storage, created) = row;
        let mut update = Map::new();
        update.insert("organizationId".into(), json!(user.organization_id));
        update.insert("description".into(), json!("Organization created"));
        update.insert("pricingPlan".into(), json!(pricing_plan));
        update.insert("aiPlan".into(), json!(ai_plan));
        if let Some(paid_until) = paid_until {
            update.insert("paidUntil".into(), millis(paid_until));
        }
        if let Some(included_users) = included_users {
            update.insert("includedUsers".into(), json!(included_users));
        }
        if let Some(included_storage) = included_storage {
            update.insert("includedStorageBytes".into(), json!(included_storage));
        }
        update.insert("created".into(), millis(created));
        vec![Value::Object(update)]
    } else {
        rows.into_iter()
            .map(
                |(
                    organization,
                    description,
                    pricing_plan,
                    ai_plan,
                    ai_plan_changed,
                    paid_until,
                    paid_until_changed,
                    included_users,
                    included_users_changed,
                    included_storage,
                    included_storage_changed,
                    created,
                )| {
                    let mut update = Map::new();
                    update.insert("organizationId".into(), json!(organization));
                    if let Some(description) = description {
                        update.insert("description".into(), json!(description));
                    }
                    if let Some(pricing_plan) = pricing_plan {
                        update.insert("pricingPlan".into(), json!(pricing_plan));
                    }
                    if ai_plan_changed {
                        update.insert("aiPlan".into(), json!(ai_plan));
                    }
                    if paid_until_changed {
                        update.insert(
                            "paidUntil".into(),
                            paid_until.map(millis).unwrap_or(Value::Null),
                        );
                    }
                    if included_users_changed {
                        update.insert("includedUsers".into(), json!(included_users));
                    }
                    if included_storage_changed {
                        update.insert("includedStorageBytes".into(), json!(included_storage));
                    }
                    update.insert("created".into(), millis(created));
                    Value::Object(update)
                },
            )
            .collect()
    };
    Ok(axum::Json(Value::Array(updates)))
}

#[cfg(test)]
mod organization_pricing_tests;
