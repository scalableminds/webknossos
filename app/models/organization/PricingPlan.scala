package models.organization

import com.scalableminds.util.enumeration.ExtendedEnumeration

// See https://home.webknossos.org/pricing for the features of each plan.
// Mirrors frontend/javascripts/admin/organization/pricing_plan_utils.ts
object PricingPlan extends ExtendedEnumeration {
  type PricingPlan = Value
  val Personal, Team, Power, Team_Trial, Power_Trial, Open_Source, Enterprise = Value

  def isFreePlan(plan: PricingPlan): Boolean = plan == Personal || plan == Open_Source

  def isPaidPlan(plan: PricingPlan): Boolean = !isFreePlan(plan)

  def isTrialPlan(plan: PricingPlan): Boolean = plan == Team_Trial || plan == Power_Trial

  // Open_Source has no access to WEBKNOSSOS workers, so it can run no jobs (including AI analysis and animations)
  // and gets no AI credits.
  def allowsJobs(plan: PricingPlan): Boolean = plan != Open_Source

  def allowsAiQuickSelect(plan: PricingPlan): Boolean = plan != Open_Source

  // These plans always come with unlimited users and storage, regardless of the limits requested in a plan update.
  def hasUnlimitedQuotas(plan: PricingPlan): Boolean = plan == Open_Source || plan == Enterprise

  // Ranks the plans by the feature set they unlock. Trials unlock the same features as their paid counterpart.
  // Open_Source unlocks the collaboration features of Team, Enterprise the features of Power. The features that
  // Open_Source lacks are checked separately, see allowsJobs and allowsAiQuickSelect.
  // Mirrors PLAN_TO_RANK in frontend/javascripts/admin/organization/pricing_plan_utils.ts
  def tierRank(plan: PricingPlan): Int = plan match {
    case Personal                         => 0
    case Team | Team_Trial | Open_Source  => 1
    case Power | Power_Trial | Enterprise => 2
  }

  def isUpgrade(previousPlan: PricingPlan, newPlan: PricingPlan): Boolean =
    tierRank(newPlan) > tierRank(previousPlan)

  // Human-readable name, e.g. for use in emails
  // Mirrors formatPricingPlanLabel in frontend/javascripts/admin/organization/pricing_plan_utils.ts
  def label(plan: PricingPlan): String = plan match {
    case Team_Trial  => "Team (Trial)"
    case Power_Trial => "Power (Trial)"
    case Open_Source => "Open-Source"
    case other       => other.toString
  }
}
