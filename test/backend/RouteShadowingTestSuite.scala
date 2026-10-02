package backend

import org.scalatest.wordspec.AnyWordSpec

import scala.io.Source

/** webknossos.versioned.routes (and its datastore/tracingstore siblings) override individual endpoints for legacy API
  * versions and forward everything else to the corresponding *.latest.routes file via a "->" include.
  *
  * Play routes are matched top to bottom, and once a route's pattern matches, a failed path-parameter bind (e.g. as
  * ObjectId) answers 400 rather than falling through to the next, differently-shaped matching route. So a versioned
  * override with a generic parameter (like :datasetId) can silently shadow a literal route that only exists in the
  * *.latest.routes file, unless the parameter explicitly excludes it (see #9954, where /v13/datasets/pathsToDelete was
  * swallowed by /v13/datasets/:datasetId instead of reaching the forwarded, literal pathsToDelete route).
  *
  * This test statically expands each versioned routes file - resolving its "->" forwards - into the effective, fully
  * ordered route table Play would build, and asserts that no literal route ends up unreachable because an earlier,
  * differently-shaped route in that table would also match its path.
  */
class RouteShadowingTestSuite extends AnyWordSpec {

  sealed private trait Segment {
    def matches(actual: String): Boolean
  }
  private case class Literal(value: String) extends Segment {
    override def matches(actual: String): Boolean = actual == value
  }
  private case class Param(regex: String) extends Segment {
    override def matches(actual: String): Boolean = actual.matches(regex)
  }

  private case class RouteEntry(method: String, segments: List[Segment], description: String)

  private val defaultParamRegex = "[^/]+"
  private val routeLineRegex = """^(GET|POST|PUT|PATCH|DELETE)\s+(\S+)\s+\S.*$""".r
  private val forwardLineRegex = """^->\s+(\S+)\s+(\S+)\s*$""".r
  private val customParamRegex = """^[:$][A-Za-z0-9_]+<(.+)>$""".r

  // Maps the router identifiers used in "->" forwards to the conf file they are compiled from.
  private val includeTargets: Map[String, String] = Map(
    "webknossos.latest.Routes" -> "conf/webknossos.latest.routes",
    "datastore.latest.Routes" -> "webknossos-datastore/conf/datastore.latest.routes",
    "tracingstore.latest.Routes" -> "webknossos-tracingstore/conf/tracingstore.latest.routes"
  )

  private val versionedRouteFiles = Seq(
    "conf/webknossos.versioned.routes",
    "webknossos-datastore/conf/datastore.versioned.routes",
    "webknossos-tracingstore/conf/tracingstore.versioned.routes"
  )

  private def readLines(path: String): List[String] = {
    val src = Source.fromFile(path)
    try src.getLines().toList
    finally src.close()
  }

  private def parseSegment(raw: String): Segment =
    if (raw.startsWith(":") || raw.startsWith("$")) {
      raw match {
        case customParamRegex(regex) => Param(regex)
        case _                       => Param(defaultParamRegex)
      }
    } else Literal(raw)

  private def parsePath(path: String): List[Segment] =
    path.split("/", -1).filter(_.nonEmpty).map(parseSegment).toList

  private def joinPrefix(prefix: String, path: String): String = {
    val normalizedPrefix = if (prefix.endsWith("/")) prefix.dropRight(1) else prefix
    val normalizedPath = if (path.startsWith("/")) path else s"/$path"
    s"$normalizedPrefix$normalizedPath"
  }

  // Expands a routes file into the effective, fully ordered route table Play would build, resolving "->" forwards
  // (to files we know about) recursively. `prefix` is the path already consumed by enclosing forwards.
  private def expandFile(path: String, prefix: String): List[RouteEntry] =
    readLines(path).flatMap { rawLine =>
      val line = rawLine.trim
      if (line.isEmpty || line.startsWith("#")) List.empty
      else
        line match {
          case routeLineRegex(method, routePath) =>
            List(RouteEntry(method, parsePath(joinPrefix(prefix, routePath)), s"$path: $line"))
          case forwardLineRegex(forwardPrefix, target) =>
            includeTargets.get(target) match {
              case Some(targetFile) => expandFile(targetFile, joinPrefix(prefix, forwardPrefix))
              case None => List.empty // forward to a router we don't statically resolve; nothing more to expand
            }
          case _ => List.empty
        }
    }

  // A literal (fully static) route is "shadowed" if an earlier route in the effective table has the same method and
  // segment count, and would also match this route's literal path - meaning it is intercepted before ever being
  // reached, regardless of whether that earlier route's own parameter binding would ultimately succeed.
  private def findShadowedRoutes(table: List[RouteEntry]): List[(RouteEntry, RouteEntry)] =
    table.zipWithIndex.flatMap {
      case (entry, index) if entry.segments.forall(_.isInstanceOf[Literal]) =>
        table
          .take(index)
          .find { earlier =>
            earlier.segments != entry.segments &&
            earlier.method == entry.method &&
            earlier.segments.length == entry.segments.length &&
            earlier.segments.zip(entry.segments).forall {
              case (earlierSegment, Literal(value)) => earlierSegment.matches(value)
              case _                                => false
            }
          }
          .map(earlier => (earlier, entry))
      case _ => None
    }

  "Versioned routes files" should
    versionedRouteFiles.foreach { path =>
      s"not let an override in $path shadow a literal route reachable only via its -> forward" in {
        val table = expandFile(path, "")
        val shadowed = findShadowedRoutes(table)
        assert(
          shadowed.isEmpty,
          "\n" + shadowed.map { case (earlier, unreachable) =>
            s"  ${unreachable.description}\n    is shadowed by earlier route:\n  ${earlier.description}"
          }.mkString("\n")
        )
      }
    }
}
