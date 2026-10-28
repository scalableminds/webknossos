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
    includedStorageBytes: Option[Option[ByteCount]] = Some(None), // None means unchanged, Some(None) means set to None
    created: Instant = Instant.now
) {
  lazy val aiPlanChanged: Boolean = aiPlan.isDefined
  lazy val paidUntilChanged: Boolean = paidUntil.isDefined
  lazy val includedUsersChanged: Boolean = includedUsers.isDefined
  lazy val includedStorageChanged: Boolean = includedStorageBytes.isDefined
  lazy val aiPlanFlat: Option[AiPlan] = aiPlan.flatten
  lazy val paidUntilFlat: Option[Instant] = paidUntil.flatten
  lazy val includedUsersFlat: Option[Int] = includedUsers.flatten
  lazy val includedStorageFlat: Option[Long] = includedStorageBytes.flatten.map(_.numBytes)

  // Plans with unlimited quotas override requested limits; limits this update leaves unchanged stay unchanged.
  // Moving from a plan with unlimited quotas to one with limits sets the quotas of the new plan, unless requested
  // otherwise.
  def withQuotasOfPlan(previousPricingPlan: PricingPlan, effectivePricingPlan: PricingPlan): OrganizationPlanUpdate =
    if (PricingPlan.hasUnlimitedQuotas(effectivePricingPlan)) {
      if (pricingPlan.isDefined) copy(includedUsers = Some(None), includedStorageBytes = Some(None))
      else
        copy(includedUsers = includedUsers.map(_ => None), includedStorageBytes = includedStorageBytes.map(_ => None))
    } else if (PricingPlan.hasUnlimitedQuotas(previousPricingPlan) && pricingPlan.isDefined)
      copy(
        includedUsers = includedUsers.orElse(PricingPlan.includedUsersOf(effectivePricingPlan).map(Some(_))),
        includedStorageBytes = includedStorageBytes.orElse(
          PricingPlan.includedStorageBytesOf(effectivePricingPlan).map(numBytes => Some(ByteCount(numBytes)))
        )
      )
    else this
}

object OrganizationPlanUpdate extends TristateOptionJsonHelper {
  implicit val jsonFormat: OFormat[OrganizationPlanUpdate] =
    Json.configured(using tristateOptionParsing).format[OrganizationPlanUpdate]
}
