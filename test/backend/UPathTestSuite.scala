package backend

import com.scalableminds.webknossos.datastore.helpers.UPath
import org.scalatestplus.play.PlaySpec

class UPathTestSuite extends PlaySpec {
  private val literalsToTest = Seq(
    "relative/elsewhere",
    "./relative/elsewehere",
    "/absolute/somewhere",
    "/absolute/some$where",
    //TODO "/absolute/somewhere²",
    //TODO "/absolute/some where with space",
    "file:///absolute/somewhere",
    "s3://bucket/key",
  )

  private val malformedLiteralsToTest = Seq(
    "file://somewhere",
    "file:/somewhere",
  )

  "UPath" should {
    "Be constructable from well-formed string" in {
      literalsToTest.foreach { literal =>
        assert(UPath.fromString(literal).exists(_.toString == literal))
      }
    }

    // TODO
    /*
    "Not be constructable from malformed string" in {
      malformedLiteralsToTest.foreach { literal =>
        assert(UPath.fromString(literal).isEmpty)
      }
    }
     */

    "resolve strings correctly" in {
      assert(
        (UPath.fromStringUnsafe("relative/elsewhere") / "subdirectory").toString == "relative/elsewhere/subdirectory")
      assert(
        (UPath.fromStringUnsafe("relative/elsewhere/") / "subdirectory").toString == "relative/elsewhere/subdirectory")
      assert(
        (UPath
          .fromStringUnsafe("relative/elsewhere/") / "subdirectory/").toString == "relative/elsewhere/subdirectory/")
    }
  }

}
