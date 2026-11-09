package backend

import models.storage.StorageWarningService.{crossedThresholdsPercent, rearmedThresholdsPercent, usagePercent}
import org.scalatest.wordspec.AsyncWordSpec

class StorageWarningTestSuite extends AsyncWordSpec {

  private val thresholdsPercent = List(90, 100)

  "usagePercent" should {
    "relate the used to the included storage" in {
      assert(usagePercent(45, 100) == 45.0)
      assert(usagePercent(150, 100) == 150.0)
    }
    /* An included storage of zero bytes means no storage at all, so any usage counts as exceeded.
       Unlimited storage is represented by an unset included storage, for which no warnings are sent at all. */
    "treat any usage as exceeded if the included storage is zero" in {
      assert(usagePercent(0, 0) == 0.0)
      assert(usagePercent(1, 0).isPosInfinity)
    }
  }

  "crossedThresholdsPercent" should {
    "be empty below the lowest threshold" in
      assert(crossedThresholdsPercent(89.9, thresholdsPercent).isEmpty)
    "contain all thresholds that were reached" in {
      assert(crossedThresholdsPercent(90, thresholdsPercent) == List(90))
      assert(crossedThresholdsPercent(100, thresholdsPercent) == List(90, 100))
      assert(crossedThresholdsPercent(Double.PositiveInfinity, thresholdsPercent) == List(90, 100))
    }
  }

  "rearmedThresholdsPercent" should {
    // Without a margin, usage hovering around a threshold would trigger a new mail on every storage scan.
    "keep thresholds armed while the usage is only slightly below them" in {
      assert(rearmedThresholdsPercent(86, thresholdsPercent) == List(100))
      assert(rearmedThresholdsPercent(96, thresholdsPercent).isEmpty)
    }
    "re-arm thresholds once the usage dropped clearly below them" in {
      assert(rearmedThresholdsPercent(84.9, thresholdsPercent) == List(90, 100))
      assert(rearmedThresholdsPercent(94, thresholdsPercent) == List(100))
    }
    "never re-arm a threshold that is currently crossed" in
      assert(rearmedThresholdsPercent(120, thresholdsPercent).isEmpty)
  }

  "the storage warning mail" should {
    def render(usagePercent: Long, isExceeded: Boolean) =
      views.html.mail
        .storageWarning(
          "Sample User",
          "Sample Organization",
          "92.0 GB",
          "100.0 GB",
          usagePercent,
          isExceeded,
          "http://localhost:9000/organization/overview",
          ""
        )
        .body

    "announce the upcoming limit before it is reached" in {
      val body = render(92, isExceeded = false)
      assert(body.contains("is running out of storage"))
      assert(body.contains("(92%)"))
      assert(body.contains("http://localhost:9000/organization/overview"))
    }
    "announce blocked uploads once the limit is reached" in {
      val body = render(100, isExceeded = true)
      assert(body.contains("has used up its included storage"))
      assert(body.contains("are blocked"))
    }
  }
}
