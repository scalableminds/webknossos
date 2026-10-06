package models.organization

import com.scalableminds.util.tools.JsonAutoFormat
import models.organization.PricingPlan.PricingPlan

// A request to sales that combines any number of upgrades. Every field is optional, only the
// requested ones are set. Mirrors UpgradeRequest in frontend/javascripts/admin/api/organization.ts
case class UpgradeRequest(
    plan: Option[PricingPlan],
    users: Option[Int],
    storageTB: Option[Int],
    aiAddon: Option[Boolean],
    credits: Option[Int],
    extendYears: Option[Int],
    note: Option[String]
) derives JsonAutoFormat {
  def hasValidAmounts: Boolean =
    Seq(users, storageTB, credits, extendYears).flatten.forall(_ > 0)
}

object UpgradeRequest {
  val maxNoteLength = 1000
}
