package models.organization

import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.TristateOptionJsonHelper
import PricingPlan.PricingPlan
import models.organization.AiPlan.AiPlan
import play.api.libs.json.{Json, OFormat}

case class OrganizationPlanUpdate(
    organizationId: String,
    description: Option[String],
    pricingPlan: Option[PricingPlan],
    aiPlan: Option[Option[AiPlan]] = Some(None), // None means unchanged, Some(None) means set to None
    paidUntil: Option[Option[Instant]] = Some(None), // None means unchanged, Some(None) means set to None
    includedUsers: Option[Option[Int]] = Some(None), // None means unchanged, Some(None) means set to None
    includedStorageBytes: Option[Option[Long]] = Some(None), // None means unchanged, Some(None) means set to None
    created: Instant = Instant.now
) {
  lazy val aiPlanChanged: Boolean = aiPlan.isDefined
  lazy val paidUntilChanged: Boolean = paidUntil.isDefined
  lazy val includedUsersChanged: Boolean = includedUsers.isDefined
  lazy val includedStorageChanged: Boolean = includedStorageBytes.isDefined
  lazy val aiPlanFlat: Option[AiPlan] = aiPlan.flatten
  lazy val paidUntilFlat: Option[Instant] = paidUntil.flatten
  lazy val includedUsersFlat: Option[Int] = includedUsers.flatten
  lazy val includedStorageFlat: Option[Long] = includedStorageBytes.flatten
}

object OrganizationPlanUpdate extends TristateOptionJsonHelper {
  implicit val jsonFormat: OFormat[OrganizationPlanUpdate] =
    Json.configured(tristateOptionParsing).format[OrganizationPlanUpdate]
}
