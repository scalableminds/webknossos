package backend

import models.organization.{PricingPlan, PricingPlanFeatures}
import org.scalatest.wordspec.AsyncWordSpec

class PricingPlanFeaturesTestSuite extends AsyncWordSpec {

  "PricingPlanFeatures.unlockedBy" should {

    "list only the Team highlights when upgrading from Personal to Team" in {
      val unlocked = PricingPlanFeatures.unlockedBy(PricingPlan.Personal, PricingPlan.Team)
      assert(unlocked.map(_.planLabel) == List("Team"))
    }

    "list the Team and Power highlights when upgrading from Personal to Power" in {
      val unlocked = PricingPlanFeatures.unlockedBy(PricingPlan.Personal, PricingPlan.Power)
      assert(unlocked.map(_.planLabel) == List("Team", "Power"))
    }

    "list only the Power highlights when upgrading from Team to Power" in {
      val unlocked = PricingPlanFeatures.unlockedBy(PricingPlan.Team, PricingPlan.Power)
      assert(unlocked.map(_.planLabel) == List("Power"))
    }

    "treat trials like their paid counterpart" in {
      assert(
        PricingPlanFeatures.unlockedBy(PricingPlan.Personal, PricingPlan.Team_Trial).map(_.planLabel) == List("Team")
      )
      assert(
        PricingPlanFeatures.unlockedBy(PricingPlan.Team_Trial, PricingPlan.Power).map(_.planLabel) == List("Power")
      )
      assert(PricingPlanFeatures.unlockedBy(PricingPlan.Team_Trial, PricingPlan.Team).isEmpty)
    }

    "be empty if the plan did not change" in {
      assert(PricingPlanFeatures.unlockedBy(PricingPlan.Team, PricingPlan.Team).isEmpty)
      assert(PricingPlanFeatures.unlockedBy(PricingPlan.Personal, PricingPlan.Personal).isEmpty)
    }

    "be empty for downgrades" in {
      assert(PricingPlanFeatures.unlockedBy(PricingPlan.Power, PricingPlan.Team).isEmpty)
      assert(PricingPlanFeatures.unlockedBy(PricingPlan.Team, PricingPlan.Personal).isEmpty)
    }

    "be empty for tiers without defined highlights" in {
      assert(PricingPlanFeatures.unlockedBy(PricingPlan.Personal, PricingPlan.Custom).isEmpty)
      assert(PricingPlanFeatures.unlockedBy(PricingPlan.Custom, PricingPlan.Power).isEmpty)
    }

    "never list an empty set of highlights for a tier" in {
      val unlocked = PricingPlanFeatures.unlockedBy(PricingPlan.Personal, PricingPlan.Power)
      assert(unlocked.forall(_.featureHighlights.nonEmpty))
    }
  }
}
