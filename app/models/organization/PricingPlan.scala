package models.organization

import com.scalableminds.util.enumeration.ExtendedEnumeration

object PricingPlan extends ExtendedEnumeration {
  type PricingPlan = Value
  val Personal, Team, Power, Team_Trial, Power_Trial, Custom = Value

  def isPaidPlan(plan: PricingPlan): Boolean = plan != Personal

  def isTrialPlan(plan: PricingPlan): Boolean = plan == Team_Trial || plan == Power_Trial

  // Human-readable name, e.g. for use in emails
  def label(plan: PricingPlan): String = plan match {
    case Team_Trial  => "Team (Trial)"
    case Power_Trial => "Power (Trial)"
    case other       => other.toString
  }
}
