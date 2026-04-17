package backend

import com.scalableminds.util.mvc.ApiVersioning
import org.scalatest.wordspec.AsyncWordSpec

import scala.io.Source
import scala.util.matching.Regex

class ApiVersioningRoutesTestSuite extends AsyncWordSpec with ApiVersioning {

  private val versionPattern: Regex = """/v(\d+)/""".r

  private val routeFiles = Seq(
    "conf/webknossos.versioned.routes",
    "webknossos-datastore/conf/datastore.versioned.routes",
    "webknossos-tracingstore/conf/tracingstore.versioned.routes",
  )

  private def versionsInFile(path: String): Set[Int] = {
    val src = Source.fromFile(path)
    try {
      versionPattern.findAllMatchIn(src.mkString).map(_.group(1).toInt).toSet
    } finally {
      src.close()
    }
  }

  "Versioned routes files" should {
    routeFiles.foreach { path =>
      s"have newest api version route in $path that matches CURRENT_API_VERSION" in {
        assert(versionsInFile(path).max == CURRENT_API_VERSION)
      }
      s"have oldest api version route in $path that matches OLDEST_SUPPORTED_API_VERSION" in {
        assert(versionsInFile(path).min == OLDEST_SUPPORTED_API_VERSION)
      }
    }
  }
}
