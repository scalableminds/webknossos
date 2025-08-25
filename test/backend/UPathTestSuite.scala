package backend

import com.scalableminds.webknossos.datastore.helpers.UPath
import org.scalatestplus.play.PlaySpec

class UPathTestSuite extends PlaySpec {

  "UPath" should {
    "Be constructable from well-formed string" in {
      assert(UPath.fromString("relative/elsewhere").exists(_.toString == "./relative/elsewhere"))
      assert(UPath.fromString("./relative/elsewehere").exists(_.toString == "./relative/elsewehere"))
      assert(UPath.fromString("/absolute/somewhere").exists(_.toString == "file:///absolute/somewhere"))
      assert(UPath.fromString("/absolute/some$where").exists(_.toString == "file:///absolute/some$where"))
      assert(UPath.fromString("/absolute/with²Unicode").exists(_.toString == "file:///absolute/with²Unicode"))
      assert(UPath.fromString("/absolute/ with space").exists(_.toString == "file:///absolute/ with space"))
      assert(UPath.fromString("file:///absolute/with²Unicode").exists(_.toString == "file:///absolute/with²Unicode"))
      assert(UPath.fromString("s3://bucket/key").exists(_.toString == "s3://bucket/key"))
      assert(UPath.fromString("s3:/somewhere").exists(_.toString == "./s3:/somewhere"))
      assert(UPath.fromString("s3:somewhere").exists(_.toString == "./s3:somewhere"))
    }

    "Not be constructable from malformed string" in {
      assert(UPath.fromString("file://somewhere").isEmpty)
    }

    "resolve strings correctly" in {
      assert(
        (UPath.fromStringUnsafe("relative/elsewhere") / "subdirectory").toString == "./relative/elsewhere/subdirectory")
      assert(
        (UPath
          .fromStringUnsafe("relative/elsewhere/") / "subdirectory").toString == "./relative/elsewhere/subdirectory")
      assert(
        (UPath
          .fromStringUnsafe("relative/elsewhere/") / "subdirectory/").toString == "./relative/elsewhere/subdirectory")
    }
  }

}
