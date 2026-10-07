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

    "set unlimited users and storage for Enterprise and Open_Source" in {
      for (plan <- List(PricingPlan.Enterprise, PricingPlan.Open_Source)) {
        val update = limitedUpdate.withQuotasOfPlan(plan)
        assert(update.includedUsersChanged && update.includedUsersFlat.isEmpty)
        assert(update.includedStorageChanged && update.includedStorageFlat.isEmpty)
      }
      succeed
    }

    "keep the requested limits for other plans" in {
      assert(limitedUpdate.withQuotasOfPlan(PricingPlan.Power) == limitedUpdate)
      assert(limitedUpdate.withQuotasOfPlan(PricingPlan.Personal) == limitedUpdate)
    }
  }
}
