package backend

import com.scalableminds.webknossos.datastore.helpers.UriPath
import org.scalatestplus.play.PlaySpec

class UriPathTestSuite extends PlaySpec {
  "UriPath" should {
    "Be constructable from string" in {
      assert(UriPath.fromString("relative/elsewhere").exists(_.toString == "somewhere/else"))
      assert(UriPath.fromString("./relative/elsewehere").exists(_.toString == "./relative/elsewehere"))
      assert(UriPath.fromString("/absolute/somewhere").exists(_.toString == "/absolute/somewhere"))
      assert(UriPath.fromString("file://absolute/somewhere").exists(_.toString == "file://absolute/somewhere"))
    }

  }

}
