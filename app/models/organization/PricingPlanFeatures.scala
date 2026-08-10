package models.organization

import models.organization.PricingPlan.PricingPlan

case class PricingPlanFeatures(planLabel: String, featureHighlights: List[String])

object PricingPlanFeatures {

  // Mirrors teamPlanFeatures/powerPlanFeatures in frontend/javascripts/admin/organization/pricing_plan_utils.ts,
  // without the "Everything from …" lines, since the highlights of the skipped tiers are listed here as well.
  private val teamPlanFeatures = PricingPlanFeatures(
    "Team",
    List(
      "Collaborative Annotation",
      "Project Management",
      "Dataset Management and Access Control",
      "5 Users / 1TB Storage (upgradable)",
      "Eligible for the AI Add-on and AI model training",
      "Priority Email Support"
    )
  )

  private val powerPlanFeatures = PricingPlanFeatures(
    "Power",
    List(
      "Up to Unlimited Users",
      "Segmentation Proof-Reading Tool",
      "On-premise or dedicated hosting solutions available",
      "Integration with your HPC and storage servers",
      "Eligible for the AI Add-on and AI model training"
    )
  )

  private def forPlan(plan: PricingPlan): Option[PricingPlanFeatures] = plan match {
    case PricingPlan.Team | PricingPlan.Team_Trial   => Some(teamPlanFeatures)
    case PricingPlan.Power | PricingPlan.Power_Trial => Some(powerPlanFeatures)
    case _                                           => None
  }

  // The feature highlights an organization gains by moving from previousPlan to newPlan, one entry per tier.
  // Skipped tiers are included, so an upgrade from Personal to Power lists the Team highlights as well.
  // Empty if newPlan is not an upgrade, or if it is a tier we have no highlights for (Custom).
  def unlockedBy(previousPlan: PricingPlan, newPlan: PricingPlan): List[PricingPlanFeatures] =
    if (!PricingPlan.isUpgrade(previousPlan, newPlan) || forPlan(newPlan).isEmpty) List.empty
    else
      List(PricingPlan.Team, PricingPlan.Power)
        .filter(tier =>
          PricingPlan.tierRank(tier) > PricingPlan.tierRank(previousPlan) &&
            PricingPlan.tierRank(tier) <= PricingPlan.tierRank(newPlan)
        )
        .flatMap(forPlan)
}
