package backend

import com.scalableminds.util.box.Full
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.JsonHelper
import org.scalatest.wordspec.AsyncWordSpec

import java.time.{LocalDateTime, ZoneId}
import scala.concurrent.Future
import scala.concurrent.duration.*

class InstantTestSuite extends AsyncWordSpec {
  val handleFoxJustification = "Handling Fox in Unit Test Context"

  "Instant" should {
    "be parsed from strings in different formats" in {
      assert(Instant.fromString("1707389459123").contains(Instant(1707389459123L)))
      assert(Instant.fromString("2024-02-08T10:50:59.123Z").contains(Instant(1707389459123L)))
    }
    "be parsed from local time strings in the system default zone" in {
      def expected(hour: Int, minute: Int, nanos: Int): Instant =
        Instant.fromZonedDateTime(LocalDateTime.of(2024, 2, 8, hour, minute, 59, nanos).atZone(ZoneId.systemDefault()))
      val cases = Seq(
        "2024-02-08T00:50:59.123" -> expected(0, 50, 123000000),
        "2024-02-08T10:50:59.123" -> expected(10, 50, 123000000),
        "2024-02-08T12:50:59.123" -> expected(12, 50, 123000000),
        "2024-02-08T13:50:59.123" -> expected(13, 50, 123000000),
        "2024-02-08T12:50:59.123456" -> expected(12, 50, 123000000),
        "2024-02-08T12:50:59" -> expected(12, 50, 0)
      )
      Future
        .sequence(cases.map { case (literal, expectedInstant) =>
          Instant.fromLocalTimeString(literal).futureBox.map(result => (literal, result, expectedInstant))
        })
        .map { results =>
          results.foreach { case (literal, result, expectedInstant) =>
            assert(result == Full(expectedInstant), s"for $literal")
          }
          succeed
        }
    }
    "be parsed from json in different formats" in {
      assert(JsonHelper.parseAs[Instant]("1707389459123").toOption.contains(Instant(1707389459123L)))
      assert(JsonHelper.parseAs[Instant]("\"1707389459123\"").toOption.contains(Instant(1707389459123L)))
      assert(JsonHelper.parseAs[Instant]("\"2024-02-08T10:50:59.123Z\"").toOption.contains(Instant(1707389459123L)))
    }
    "be serialized to iso string" in
      assert(Instant(1707389459123L).toString == "2024-02-08T10:50:59.123Z")
    "count the days until another instant, rounded up" in {
      val instant = Instant(1707389459123L)
      assert(instant.daysUntil(instant + (7 days)) == 7)
      assert(instant.daysUntil(instant + (6 days) + (12 hours)) == 7)
      assert(instant.daysUntil(instant + (1 hour)) == 1)
      assert(instant.daysUntil(instant) == 0)
      assert(instant.daysUntil(instant - (3 days)) == -3)
    }
  }
}
