package models.organization

import com.scalableminds.util.enumeration.ExtendedEnumeration

object PricingPlan extends ExtendedEnumeration {
  type PricingPlan = Value
  val Personal, Team, Power, Team_Trial, Power_Trial, Open_Source, Enterprise = Value

  // Open_Source behaves like Personal
  def isFreePlan(plan: PricingPlan): Boolean = plan == Personal || plan == Open_Source

  def isPaidPlan(plan: PricingPlan): Boolean = !isFreePlan(plan)

  def isTrialPlan(plan: PricingPlan): Boolean = plan == Team_Trial || plan == Power_Trial

  // Ranks the plans by the feature set they unlock. Trials unlock the same features as their paid counterpart.
  // Enterprise unlocks the same features as Power, but comes with unlimited users and storage.
  // Mirrors PLAN_TO_RANK in frontend/javascripts/admin/organization/pricing_plan_utils.ts
  def tierRank(plan: PricingPlan): Int = plan match {
    case Personal | Open_Source => 0
    case Team | Team_Trial      => 1
    case Power | Power_Trial    => 2
    case Enterprise             => 2
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
