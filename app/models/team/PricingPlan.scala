package models.team

import com.scalableminds.util.enumeration.ExtendedEnumeration

object PricingPlan extends ExtendedEnumeration {
  type PricingPlan = Value
  val Basic, Premium, Pilot, Custom = Value
}
