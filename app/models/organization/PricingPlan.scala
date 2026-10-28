package models.organization

import com.scalableminds.util.enumeration.ExtendedEnumeration

// See https://home.webknossos.org/pricing for the features of each plan.
object PricingPlan extends ExtendedEnumeration {
  type PricingPlan = Value
  val Personal, Team, Power, Team_Trial, Power_Trial, Open_Source, Enterprise = Value

  def isFreePlan(plan: PricingPlan): Boolean = plan == Personal || plan == Open_Source

  def isPaidPlan(plan: PricingPlan): Boolean = !isFreePlan(plan)

  def isTrialPlan(plan: PricingPlan): Boolean = plan == Team_Trial || plan == Power_Trial

  // Open Source has no access to WEBKNOSSOS workers, so it can run no jobs and use no AI quick select.
  def allowsJobs(plan: PricingPlan): Boolean = plan != Open_Source

  def hasUnlimitedQuotas(plan: PricingPlan): Boolean = plan == Open_Source || plan == Enterprise

  // The quotas a plan starts with. None if the quotas of the plan are negotiated per organization.
  // Mirrors teamPlanIncludedUsers/teamPlanIncludedStorageTB in frontend/javascripts/admin/organization/pricing_plan_utils.ts
  def includedUsersOf(plan: PricingPlan): Option[Int] = plan match {
    case Team | Team_Trial => Some(5)
    case _                 => None
  }

  def includedStorageBytesOf(plan: PricingPlan): Option[Long] = plan match {
    case Team | Team_Trial => Some(1000000000000L) // 1 TB
    case _                 => None
  }

  // Ranks the plans by the feature set they unlock. Trials unlock the same features as their paid counterpart.
  // Mirrors PLAN_TO_RANK in frontend/javascripts/admin/organization/pricing_plan_utils.ts
  def tierRank(plan: PricingPlan): Int = plan match {
    case Personal                         => 0
    case Team | Team_Trial | Open_Source  => 1
    case Power | Power_Trial | Enterprise => 2
  }

  def isUpgrade(previousPlan: PricingPlan, newPlan: PricingPlan): Boolean =
    tierRank(newPlan) > tierRank(previousPlan)

  // Human-readable name, e.g. for use in emails
  def label(plan: PricingPlan): String = plan match {
    case Team_Trial  => "Team (Trial)"
    case Power_Trial => "Power (Trial)"
    case Open_Source => "Open Source"
    case other       => other.toString
  }
}
