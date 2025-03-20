package backend

import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.JsonHelper
import org.scalatestplus.play.PlaySpec

import scala.concurrent.ExecutionContext.global

class InstantTestSuite extends PlaySpec {
  val handleFoxJustification = "Handling Fox in Unit Test Context"

  "Instant" should {
    "be parsed from strings in different formats" in {
      assert(Instant.fromString("1707389459123").contains(Instant(1707389459123L)))
      assert(Instant.fromString("2024-02-08T10:50:59.123Z").contains(Instant(1707389459123L)))
    }
    "be parsed from json in different formats" in {
      assert(JsonHelper.parseAndValidateJson[Instant]("1707389459123").contains(Instant(1707389459123L)))
      assert(JsonHelper.parseAndValidateJson[Instant]("\"1707389459123\"").contains(Instant(1707389459123L)))
      assert(JsonHelper.parseAndValidateJson[Instant]("\"2024-02-08T10:50:59.123Z\"").contains(Instant(1707389459123L)))
    }
    "be serialized to iso string" in {
      assert(Instant(1707389459123L).toString == "2024-02-08T10:50:59.123Z")
    }
  }
}
