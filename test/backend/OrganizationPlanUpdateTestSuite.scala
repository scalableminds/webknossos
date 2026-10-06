package backend

import models.organization.{ByteCount, OrganizationPlanUpdate, PricingPlan}
import org.scalatest.wordspec.AsyncWordSpec

class OrganizationPlanUpdateTestSuite extends AsyncWordSpec {

  private val limitedUpdate = OrganizationPlanUpdate(
    organizationId = "sample_organization",
    description = None,
    pricingPlan = None,
    includedUsers = Some(Some(5)),
    includedStorageBytes = Some(Some(ByteCount(1000L)))
  )

  "OrganizationPlanUpdate.withQuotasOfPlan" should {

    "set unlimited users and storage for Enterprise" in {
      val update = limitedUpdate.withQuotasOfPlan(PricingPlan.Enterprise)
      assert(update.includedUsersChanged && update.includedUsersFlat.isEmpty)
      assert(update.includedStorageChanged && update.includedStorageFlat.isEmpty)
    }

    "keep the requested limits for other plans" in {
      assert(limitedUpdate.withQuotasOfPlan(PricingPlan.Power) == limitedUpdate)
      assert(limitedUpdate.withQuotasOfPlan(PricingPlan.Open_Source) == limitedUpdate)
    }
  }
}
