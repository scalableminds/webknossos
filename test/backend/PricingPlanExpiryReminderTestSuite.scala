package backend

import models.organization.PricingPlan
import models.organization.PricingPlanExpiryReminderService.{crossedLeadTimesDays, leadTimesDaysFor}
import org.scalatest.wordspec.AsyncWordSpec

class PricingPlanExpiryReminderTestSuite extends AsyncWordSpec {

  private val leadTimesDays = List(30, 14, 7)
  private val trialLeadTimesDays = List(7)

  "crossedLeadTimesDays" should {
    "be empty while the expiry date is further out than the largest lead time" in
      assert(crossedLeadTimesDays(31, leadTimesDays).isEmpty)
    "contain only the lead times that were crossed" in {
      assert(crossedLeadTimesDays(30, leadTimesDays) == List(30))
      assert(crossedLeadTimesDays(20, leadTimesDays) == List(30))
      assert(crossedLeadTimesDays(14, leadTimesDays) == List(14, 30))
    }
    // All crossed lead times are recorded at once, so that an organization that is only picked up shortly before
    // the expiry date (or whose plan was set up late) receives a single mail instead of one per lead time.
    "contain all crossed lead times when several were crossed at once" in {
      assert(crossedLeadTimesDays(5, leadTimesDays) == List(7, 14, 30))
      assert(crossedLeadTimesDays(1, leadTimesDays) == List(7, 14, 30))
    }
    "be empty if no lead times are configured" in
      assert(crossedLeadTimesDays(1, Seq.empty).isEmpty)
    // The query excludes expired plans using the database clock, which may differ from ours. Without this,
    // a plan that is already expired would match every lead time and be announced as expiring "in 0 days".
    "be empty once the plan has expired" in {
      assert(crossedLeadTimesDays(0, leadTimesDays).isEmpty)
      assert(crossedLeadTimesDays(-5, leadTimesDays).isEmpty)
    }
  }

  "leadTimesDaysFor" should {
    // Trials usually run for a short time only, so a single reminder shortly before expiry is enough.
    "use the trial lead times for trial plans" in {
      assert(leadTimesDaysFor(PricingPlan.Team_Trial, leadTimesDays, trialLeadTimesDays) == List(7))
      assert(leadTimesDaysFor(PricingPlan.Power_Trial, leadTimesDays, trialLeadTimesDays) == List(7))
    }
    "use the regular lead times for all other plans" in {
      assert(leadTimesDaysFor(PricingPlan.Team, leadTimesDays, trialLeadTimesDays) == leadTimesDays)
      assert(leadTimesDaysFor(PricingPlan.Power, leadTimesDays, trialLeadTimesDays) == leadTimesDays)
      assert(leadTimesDaysFor(PricingPlan.Custom, leadTimesDays, trialLeadTimesDays) == leadTimesDays)
    }
    "let a trial reminder fire only once, 7 days before expiry" in {
      val trialLeadTimes = leadTimesDaysFor(PricingPlan.Team_Trial, leadTimesDays, trialLeadTimesDays)
      assert(crossedLeadTimesDays(14, trialLeadTimes).isEmpty)
      assert(crossedLeadTimesDays(7, trialLeadTimes) == List(7))
      assert(crossedLeadTimesDays(1, trialLeadTimes) == List(7))
    }
  }

  "the reminder mail" should {
    def render(daysRemaining: Long) =
      views.html.mail
        .pricingPlanExpiryReminder(
          "Sample User",
          "Sample Organization",
          "Team (Trial)",
          "1 September 2026",
          daysRemaining,
          "http://localhost:9000/organization/overview",
          ""
        )
        .body

    "mention plan, expiry date and renewal link" in {
      val body = render(7)
      assert(body.contains("Team (Trial)"))
      assert(body.contains("1 September 2026"))
      assert(body.contains("that is in 7 days"))
      assert(body.contains("http://localhost:9000/organization/overview"))
    }
    "phrase the last day before expiry as tomorrow" in {
      val body = render(1)
      assert(body.contains("that is tomorrow"))
      assert(!body.contains("in 1 days"))
    }
  }
}
