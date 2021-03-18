package models.team

import play.api.libs.json.{Reads, Writes}
import com.scalableminds.util.enumeration.ExtendedEnumeration

object PricingPlan extends ExtendedEnumeration {
  type PricingPlan = Value
  val Basic, Premium, Pilot, Custom = Value
}
