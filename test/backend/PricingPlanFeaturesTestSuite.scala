package backend

import models.organization.{PricingPlan, PricingPlanFeatures}
import org.scalatest.wordspec.AsyncWordSpec

class PricingPlanFeaturesTestSuite extends AsyncWordSpec {

  "PricingPlanFeatures.unlockedBy" should {

    "label the highlights with the new plan when upgrading from Personal to Team" in {
      val unlocked = PricingPlanFeatures.unlockedBy(PricingPlan.Personal, PricingPlan.Team)
      assert(unlocked.map(_.planLabel).contains("Team"))
      assert(unlocked.exists(_.featureHighlights.contains("Collaborative Annotation")))
    }

    "label the highlights with the new plan only, also when a tier was skipped" in {
      val unlocked = PricingPlanFeatures.unlockedBy(PricingPlan.Personal, PricingPlan.Power)
      assert(unlocked.map(_.planLabel).contains("Power"))
    }

    "fold in the highlights of skipped tiers" in {
      val unlocked = PricingPlanFeatures.unlockedBy(PricingPlan.Personal, PricingPlan.Power)
      // "Collaborative Annotation" is a Team highlight, "Up to Unlimited Users" a Power one
      assert(unlocked.exists(_.featureHighlights.contains("Collaborative Annotation")))
      assert(unlocked.exists(_.featureHighlights.contains("Up to Unlimited Users")))
    }

    "list a highlight shared between the folded-in tiers only once" in {
      val unlocked = PricingPlanFeatures.unlockedBy(PricingPlan.Personal, PricingPlan.Power)
      val highlights = unlocked.map(_.featureHighlights).getOrElse(List.empty)
      assert(highlights == highlights.distinct)
      assert(highlights.count(_ == "Eligible for the AI Add-on and AI model training") == 1)
    }

    "list only the highlights of the new tier when no tier was skipped" in {
      val unlocked = PricingPlanFeatures.unlockedBy(PricingPlan.Team, PricingPlan.Power)
      assert(unlocked.map(_.planLabel).contains("Power"))
      assert(unlocked.exists(!_.featureHighlights.contains("Collaborative Annotation")))
    }

    "treat trials like their paid counterpart" in {
      assert(
        PricingPlanFeatures.unlockedBy(PricingPlan.Personal, PricingPlan.Team_Trial).map(_.planLabel).contains("Team")
      )
      assert(
        PricingPlanFeatures.unlockedBy(PricingPlan.Team_Trial, PricingPlan.Power).map(_.planLabel).contains("Power")
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

    "never yield an empty set of highlights" in {
      val allUpgrades = for {
        previousPlan <- PricingPlan.values.toList
        newPlan <- PricingPlan.values.toList
      } yield PricingPlanFeatures.unlockedBy(previousPlan, newPlan)
      assert(allUpgrades.flatten.nonEmpty)
      assert(allUpgrades.flatten.forall(_.featureHighlights.nonEmpty))
    }
  }
}
