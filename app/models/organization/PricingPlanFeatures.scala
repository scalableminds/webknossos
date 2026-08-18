package models.organization

import models.organization.PricingPlan.PricingPlan

case class PricingPlanFeatures(planLabel: String, featureHighlights: List[String])

object PricingPlanFeatures {

  // Based on teamPlanFeatures/powerPlanFeatures in frontend/javascripts/admin/organization/pricing_plan_utils.ts,
  // without the "Everything from …" lines, since the highlights of the skipped tiers are listed here as well.
  // Concrete user and storage limits are left out on purpose, as they can be negotiated per organization.
  private val teamPlanFeatureHighlights = List(
    "Collaborative Annotation",
    "Project Management",
    "Dataset Management and Access Control",
    "More users and storage",
    "Eligible for the AI Add-on and AI model training",
    "Priority Email Support"
  )

  private val powerPlanFeatureHighlights = List(
    "Up to Unlimited Users",
    "Segmentation Proof-Reading Tool",
    "On-premise or dedicated hosting solutions available",
    "Integration with your HPC and storage servers",
    "Eligible for the AI Add-on and AI model training"
  )

  private def featureHighlightsOf(plan: PricingPlan): Option[List[String]] = plan match {
    case PricingPlan.Team | PricingPlan.Team_Trial   => Some(teamPlanFeatureHighlights)
    case PricingPlan.Power | PricingPlan.Power_Trial => Some(powerPlanFeatureHighlights)
    case _                                           => None
  }

  // The feature highlights an organization gains by moving from previousPlan to newPlan, labelled with the new plan.
  // Skipped tiers are folded in, so an upgrade from Personal to Power also lists the Team highlights, with the
  // highlights shared between the tiers listed only once.
  // None if newPlan is not an upgrade, or if it is a tier we have no highlights for (Custom).
  def unlockedBy(previousPlan: PricingPlan, newPlan: PricingPlan): Option[PricingPlanFeatures] =
    featureHighlightsOf(newPlan).filter(_ => PricingPlan.isUpgrade(previousPlan, newPlan)).map { _ =>
      val gainedTiers = List(PricingPlan.Team, PricingPlan.Power).filter(tier =>
        PricingPlan.tierRank(tier) > PricingPlan.tierRank(previousPlan) &&
          PricingPlan.tierRank(tier) <= PricingPlan.tierRank(newPlan)
      )
      PricingPlanFeatures(
        planLabel = PricingPlan.label(newPlan),
        featureHighlights = gainedTiers.flatMap(featureHighlightsOf).flatten.distinct
      )
    }
}
