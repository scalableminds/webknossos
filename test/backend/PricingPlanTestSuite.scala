package backend

import models.organization.PricingPlan
import models.organization.PricingPlan.PricingPlan
import org.scalatest.wordspec.AsyncWordSpec

// Encodes the feature matrix of https://home.webknossos.org/pricing for the features that are gated by plan.
// The page does not list Enterprise. It unlocks all features of Power, with unlimited users and storage.
// Trials unlock the same features as their paid counterparts.
class PricingPlanTestSuite extends AsyncWordSpec {

  private def plansWith(isAllowed: PricingPlan => Boolean): Set[PricingPlan] =
    PricingPlan.values.filter(isAllowed).toSet

  private val allPlansExceptOpenSource = PricingPlan.values.toSet - PricingPlan.Open_Source

  "PricingPlan" should {

    "unlock collaboration, project and dataset management for Team and up, including Open-Source" in
      assert(
        plansWith(PricingPlan.tierRank(_) >= PricingPlan.tierRank(PricingPlan.Team)) == Set(
          PricingPlan.Team,
          PricingPlan.Team_Trial,
          PricingPlan.Power,
          PricingPlan.Power_Trial,
          PricingPlan.Open_Source,
          PricingPlan.Enterprise
        )
      )

    "unlock the features of Power for Enterprise" in
      assert(
        plansWith(PricingPlan.tierRank(_) >= PricingPlan.tierRank(PricingPlan.Power)) ==
          Set(PricingPlan.Power, PricingPlan.Power_Trial, PricingPlan.Enterprise)
      )

    "allow worker jobs for all plans except Open-Source" in
      assert(plansWith(PricingPlan.allowsJobs) == allPlansExceptOpenSource)

    "allow the AI-based quick-select tool for all plans except Open-Source" in
      assert(plansWith(PricingPlan.allowsAiQuickSelect) == allPlansExceptOpenSource)

    "come with unlimited users and storage for Open-Source and Enterprise only" in
      assert(plansWith(PricingPlan.hasUnlimitedQuotas) == Set(PricingPlan.Open_Source, PricingPlan.Enterprise))

    "treat Personal and Open-Source as free plans" in
      assert(plansWith(PricingPlan.isFreePlan) == Set(PricingPlan.Personal, PricingPlan.Open_Source))
  }
}
