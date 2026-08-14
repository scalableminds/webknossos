package backend

import models.organization.{PricingPlan, PricingPlanFeatures}
import org.scalatest.wordspec.AsyncWordSpec

class PricingPlanFeaturesTestSuite extends AsyncWordSpec {

  private def highlightsOf(previousPlan: PricingPlan.PricingPlan, newPlan: PricingPlan.PricingPlan): List[String] =
    PricingPlanFeatures.unlockedBy(previousPlan, newPlan).map(_.featureHighlights).getOrElse(List.empty)

  "PricingPlanFeatures.unlockedBy" should {

    "label the highlights with the new plan when upgrading from Personal to Team" in {
      val unlocked = PricingPlanFeatures.unlockedBy(PricingPlan.Personal, PricingPlan.Team)
      assert(unlocked.map(_.planLabel).contains(PricingPlan.label(PricingPlan.Team)))
      assert(unlocked.exists(_.featureHighlights.contains("Collaborative Annotation")))
    }

    "label the highlights with the new plan only, also when a tier was skipped" in {
      val unlocked = PricingPlanFeatures.unlockedBy(PricingPlan.Personal, PricingPlan.Power)
      assert(unlocked.map(_.planLabel).contains(PricingPlan.label(PricingPlan.Power)))
    }

    "fold in the highlights of skipped tiers" in {
      val unlocked = PricingPlanFeatures.unlockedBy(PricingPlan.Personal, PricingPlan.Power)
      // "Collaborative Annotation" is a Team highlight, "Up to Unlimited Users" a Power one
      assert(unlocked.exists(_.featureHighlights.contains("Collaborative Annotation")))
      assert(unlocked.exists(_.featureHighlights.contains("Up to Unlimited Users")))
    }

    "list a highlight shared between the folded-in tiers only once" in {
      val highlights = highlightsOf(PricingPlan.Personal, PricingPlan.Power)
      assert(highlights == highlights.distinct)
      assert(highlights.count(_ == "Eligible for the AI Add-on and AI model training") == 1)
    }

    "list only the highlights of the new tier when no tier was skipped" in {
      val unlocked = PricingPlanFeatures.unlockedBy(PricingPlan.Team, PricingPlan.Power)
      assert(unlocked.map(_.planLabel).contains(PricingPlan.label(PricingPlan.Power)))
      assert(unlocked.exists(!_.featureHighlights.contains("Collaborative Annotation")))
    }

    "unlock the same highlights for a trial as for its paid counterpart" in {
      assert(
        highlightsOf(PricingPlan.Personal, PricingPlan.Team_Trial) ==
          highlightsOf(PricingPlan.Personal, PricingPlan.Team)
      )
      assert(
        highlightsOf(PricingPlan.Personal, PricingPlan.Power_Trial) ==
          highlightsOf(PricingPlan.Personal, PricingPlan.Power)
      )
      assert(
        highlightsOf(PricingPlan.Team_Trial, PricingPlan.Power) == highlightsOf(PricingPlan.Team, PricingPlan.Power)
      )
      assert(highlightsOf(PricingPlan.Personal, PricingPlan.Team_Trial).nonEmpty)
    }

    "label a trial as a trial" in {
      assert(
        PricingPlanFeatures
          .unlockedBy(PricingPlan.Personal, PricingPlan.Team_Trial)
          .map(_.planLabel)
          .contains(PricingPlan.label(PricingPlan.Team_Trial))
      )
      assert(
        PricingPlanFeatures
          .unlockedBy(PricingPlan.Personal, PricingPlan.Power_Trial)
          .map(_.planLabel)
          .contains(PricingPlan.label(PricingPlan.Power_Trial))
      )
    }

    "be empty if the plan did not change tier" in {
      assert(PricingPlanFeatures.unlockedBy(PricingPlan.Team, PricingPlan.Team).isEmpty)
      assert(PricingPlanFeatures.unlockedBy(PricingPlan.Personal, PricingPlan.Personal).isEmpty)
      assert(PricingPlanFeatures.unlockedBy(PricingPlan.Team_Trial, PricingPlan.Team).isEmpty)
      assert(PricingPlanFeatures.unlockedBy(PricingPlan.Power, PricingPlan.Power_Trial).isEmpty)
    }

    "be empty for downgrades" in {
      assert(PricingPlanFeatures.unlockedBy(PricingPlan.Power, PricingPlan.Team).isEmpty)
      assert(PricingPlanFeatures.unlockedBy(PricingPlan.Team, PricingPlan.Personal).isEmpty)
      assert(PricingPlanFeatures.unlockedBy(PricingPlan.Power_Trial, PricingPlan.Team_Trial).isEmpty)
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
