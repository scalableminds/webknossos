package backend

import com.scalableminds.util.time.Instant
import models.organization.PricingPlanExpiryReminderService.{crossedLeadTimesDays, daysUntil}
import org.scalatest.wordspec.AsyncWordSpec

import scala.concurrent.duration.*

class PricingPlanExpiryReminderTestSuite extends AsyncWordSpec {

  private val leadTimesDays = List(30, 14, 7)
  private val now = Instant(1770000000000L)

  "daysUntil" should {
    "round up to full days" in {
      assert(daysUntil(now + (7 days), now) == 7)
      assert(daysUntil(now + (6 days) + (12 hours), now) == 7)
      assert(daysUntil(now + (1 hour), now) == 1)
    }
  }

  "crossedLeadTimesDays" should {
    "be empty while the expiry date is further out than the largest lead time" in {
      assert(crossedLeadTimesDays(31, leadTimesDays).isEmpty)
    }
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
    "be empty if no lead times are configured" in {
      assert(crossedLeadTimesDays(1, Seq.empty).isEmpty)
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
