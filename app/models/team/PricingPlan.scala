package models.team

import play.api.libs.json.{Reads, Writes}
import utils.EnumUtils

object PricingPlan extends Enumeration {
  type PricingPlan = Value

  val Basic, Premium, Pilot, Custom = Value

  implicit val enumReads: Reads[PricingPlan.Value] = EnumUtils.enumReads(PricingPlan)

  implicit def enumWrites: Writes[PricingPlan.Value] = EnumUtils.enumWrites

  def fromString(s: String): Option[Value] = values.find(_.toString == s)
}
