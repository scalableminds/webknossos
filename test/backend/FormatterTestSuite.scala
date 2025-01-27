package backend

import com.scalableminds.util.mvc.Formatter
import org.scalatestplus.play.PlaySpec

import scala.concurrent.duration.FiniteDuration

class FormatterTestSuite extends PlaySpec with Formatter {
  "formatDuration" should {
    "format human readable dates" in {
      assert(formatDuration(FiniteDuration(0, "ms")) == "0ms")
      assert(formatDuration(FiniteDuration(10, "ms")) == "10ms")
      assert(formatDuration(FiniteDuration(999, "ms")) == "999ms")
      assert(formatDuration(FiniteDuration(1000, "ms")) == "1s")
      assert(formatDuration(FiniteDuration(1004, "ms")) == "1s")
      assert(formatDuration(FiniteDuration(1005, "ms")) == "1.01s")
      assert(formatDuration(FiniteDuration(1014, "ms")) == "1.01s")
      assert(formatDuration(FiniteDuration(1015, "ms")) == "1.02s")
      assert(formatDuration(FiniteDuration(4000, "ms")) == "4s")
      assert(formatDuration(FiniteDuration(4100, "ms")) == "4.1s")
      assert(formatDuration(FiniteDuration(4110, "ms")) == "4.11s")
      assert(formatDuration(FiniteDuration(4114, "ms")) == "4.11s")
      assert(formatDuration(FiniteDuration(4115, "ms")) == "4.12s")
      assert(formatDuration(FiniteDuration(59994, "ms")) == "59.99s")
      assert(formatDuration(FiniteDuration(59995, "ms")) == "1m")
      assert(formatDuration(FiniteDuration(60000, "ms")) == "1m")
      assert(formatDuration(FiniteDuration(60499, "ms")) == "1m")
      assert(formatDuration(FiniteDuration(60500, "ms")) == "1m 1s")
      assert(formatDuration(FiniteDuration(61111, "ms")) == "1m 1s")
      assert(formatDuration(FiniteDuration(120000, "ms")) == "2m")
      assert(formatDuration(FiniteDuration(3600000 - 501, "ms")) == "59m 59s")
      assert(formatDuration(FiniteDuration(3600000 - 500, "ms")) == "1h")
      assert(formatDuration(FiniteDuration(3600000 - 1, "ms")) == "1h")
      assert(formatDuration(FiniteDuration(3600000, "ms")) == "1h")
      assert(formatDuration(FiniteDuration(3600000 + 60000, "ms")) == "1h 1m")
      assert(formatDuration(FiniteDuration(3600000 + 60010, "ms")) == "1h 1m")
      assert(formatDuration(FiniteDuration(3600000 + 60500, "ms")) == "1h 1m 1s")
      assert(formatDuration(FiniteDuration(24 * 3600000 - 1, "ms")) == "1 day")
      assert(formatDuration(FiniteDuration(24 * 3600000 - 500, "ms")) == "1 day")
      assert(formatDuration(FiniteDuration(24 * 3600000 - 501, "ms")) == "23h 59m 59s")
      assert(formatDuration(FiniteDuration(24 * 3600000 + 501, "ms")) == "1 day")
      assert(formatDuration(FiniteDuration(24 * 3600000 + 59000 + 500, "ms")) == "1 day 1m")
      assert(formatDuration(FiniteDuration(24 * 3600000 + 60000, "ms")) == "1 day 1m")
      assert(formatDuration(FiniteDuration(25 * 3600000 + 60000 + 1000, "ms")) == "1 day 1h 1m")
      assert(formatDuration(FiniteDuration(49 * 3600000 + 60000 + 500, "ms")) == "2 days 1h 1m")
      assert(formatDuration(FiniteDuration(24 * 24 * 3600000 + 60000 + 500, "ms")) == "24 days 1m")
      assert(formatDuration(FiniteDuration(100L * 24 * 3600000 + 60000 + 500, "ms")) == "100 days 1m")
      assert(formatDuration(FiniteDuration(-50, "ms")) == "-50ms")
      assert(formatDuration(FiniteDuration(-5000, "ms")) == "-5s")
      assert(formatDuration(FiniteDuration(-1 * (49 * 3600000 + 60000 + 500), "ms")) == "-2 days 1h 1m")
    }
  }
}
