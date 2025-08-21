package backend

import com.scalableminds.webknossos.datastore.helpers.UriPath
import org.scalatestplus.play.PlaySpec

class UriPathTestSuite extends PlaySpec {
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

  "UriPath" should {
    "Be constructable from well-formed string" in {
      literalsToTest.foreach { literal =>
        assert(UriPath.fromString(literal).exists(_.toString == literal))
      }
    }

    // TODO
    /*
    "Not be constructable from malformed string" in {
      malformedLiteralsToTest.foreach { literal =>
        assert(UriPath.fromString(literal).isEmpty)
      }
    }
     */

    "resolve strings correctly" in {
      assert(
        (UriPath.fromStringUnsafe("relative/elsewhere") / "subdirectory").toString == "relative/elsewhere/subdirectory")
      assert(
        (UriPath
          .fromStringUnsafe("relative/elsewhere/") / "subdirectory").toString == "relative/elsewhere/subdirectory")
      assert(
        (UriPath
          .fromStringUnsafe("relative/elsewhere/") / "subdirectory/").toString == "relative/elsewhere/subdirectory/")
    }
  }

}
