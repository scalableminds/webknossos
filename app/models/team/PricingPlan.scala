package models.team

import com.scalableminds.util.enumeration.ExtendedEnumeration

object PricingPlan extends ExtendedEnumeration {
  type PricingPlan = Value
  val Basic, Team, Power, Team_Trial, Power_Trial, Custom = Value

  def isPaidPlan(plan: PricingPlan): Boolean = plan != Basic
}
