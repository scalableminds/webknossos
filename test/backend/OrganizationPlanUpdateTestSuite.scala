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

    "override requested limits with unlimited users and storage for Enterprise and Open_Source" in {
      for (plan <- List(PricingPlan.Enterprise, PricingPlan.Open_Source)) {
        val update = limitedUpdate.withQuotasOfPlan(plan)
        assert(update.includedUsersChanged && update.includedUsersFlat.isEmpty)
        assert(update.includedStorageChanged && update.includedStorageFlat.isEmpty)
      }
      succeed
    }

    "lift the limits when setting Enterprise or Open_Source" in {
      val setPlanUpdate = OrganizationPlanUpdate(
        organizationId = "sample_organization",
        description = None,
        pricingPlan = Some(PricingPlan.Enterprise),
        includedUsers = None,
        includedStorageBytes = None
      )
      val update = setPlanUpdate.withQuotasOfPlan(PricingPlan.Enterprise)
      assert(update.includedUsersChanged && update.includedUsersFlat.isEmpty)
      assert(update.includedStorageChanged && update.includedStorageFlat.isEmpty)
    }

    "leave unchanged limits unchanged if the plan is not set" in {
      val paidUntilOnlyUpdate = OrganizationPlanUpdate(
        organizationId = "sample_organization",
        description = None,
        pricingPlan = None,
        includedUsers = None,
        includedStorageBytes = None
      )
      assert(paidUntilOnlyUpdate.withQuotasOfPlan(PricingPlan.Enterprise) == paidUntilOnlyUpdate)
    }

    "keep the requested limits for other plans" in {
      assert(limitedUpdate.withQuotasOfPlan(PricingPlan.Power) == limitedUpdate)
      assert(limitedUpdate.withQuotasOfPlan(PricingPlan.Personal) == limitedUpdate)
    }
  }
}
