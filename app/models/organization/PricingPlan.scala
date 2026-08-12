package models.organization

import com.scalableminds.util.enumeration.ExtendedEnumeration

object PricingPlan extends ExtendedEnumeration {
  type PricingPlan = Value
  val Personal, Team, Power, Team_Trial, Power_Trial, Custom = Value

  def isPaidPlan(plan: PricingPlan): Boolean = plan != Personal

  def isTrialPlan(plan: PricingPlan): Boolean = plan == Team_Trial || plan == Power_Trial

  // Ranks the plans by the feature set they unlock. Trials unlock the same features as their paid counterpart.
  // Mirrors PLAN_TO_RANK in frontend/javascripts/admin/organization/pricing_plan_utils.ts
  def tierRank(plan: PricingPlan): Int = plan match {
    case Personal            => 0
    case Team | Team_Trial   => 1
    case Power | Power_Trial => 2
    case Custom              => 2
  }

  def isUpgrade(previousPlan: PricingPlan, newPlan: PricingPlan): Boolean =
    tierRank(newPlan) > tierRank(previousPlan)

  // Human-readable name, e.g. for use in emails
  def label(plan: PricingPlan): String = plan match {
    case Team_Trial  => "Team (Trial)"
    case Power_Trial => "Power (Trial)"
    case other       => other.toString
  }
}
