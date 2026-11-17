package backend

import org.scalatest.wordspec.AnyWordSpec
import security.RouteScopes

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Paths}
import scala.io.Source
import scala.util.Using

/** Keeps the scopes of all API routes under review: route-scopes.snapshot.txt lists every /api route of WEBKNOSSOS with
  * the scope a scoped token (see security.Scope) needs to call it, as security.RouteScopes computes it, or DENIED.
  *
  * Within a controller that RouteScopes maps, a new action gets its scope from its HTTP method, without anyone having
  * decided it. That is wrong for actions whose method does not match what they do: a GET that creates something, or a
  * POST that discards work. This test fails for any new, removed or changed route until the snapshot is updated, so
  * that every change of what scoped tokens (AI agents) may do shows up as a diff in review.
  *
  * To update the snapshot after checking the changes: yarn refresh-routescope-snapshots
  */
class RouteScopesSnapshotTestSuite extends AnyWordSpec {

  private val snapshotPath = Paths.get("test/backend/route-scopes.snapshot.txt")
  private val actualPath = Paths.get("target/route-scopes.actual.txt")

  // All of these are mounted under /api/, see conf/routes. The versioned file adds the legacy api routes, which clients
  // that pin an api version (such as the WEBKNOSSOS Python library) end up on.
  private val routeFiles = Seq("conf/webknossos.versioned.routes", "conf/webknossos.latest.routes")

  private val routePattern =
    """^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)\s+(controllers\.[A-Za-z0-9_]+)\.([A-Za-z0-9_]+)""".r

  private def routeTable: List[String] =
    routeFiles.toList.flatMap { path =>
      Using.resource(Source.fromFile(path))(_.getLines().toList).flatMap { line =>
        routePattern.findFirstMatchIn(line).map { m =>
          val (httpMethod, routePath, controller, action) = (m.group(1), m.group(2), m.group(3), m.group(4))
          val scope = RouteScopes.requiredScope(controller, action, httpMethod).map(_.toString).getOrElse("DENIED")
          f"$scope%-24s $httpMethod%-7s /api$routePath  ${controller.stripPrefix("controllers.")}.$action"
        }
      }
    }.distinct

  "The scopes of the API routes" should {
    "match the reviewed snapshot" in {
      val actual = routeTable
      val expected =
        if (Files.exists(snapshotPath)) Using.resource(Source.fromFile(snapshotPath.toFile))(_.getLines().toList)
        else List.empty

      if (actual != expected) {
        Files.createDirectories(actualPath.getParent)
        Files.write(actualPath, (actual.mkString("\n") + "\n").getBytes(StandardCharsets.UTF_8))
        val added = actual.diff(expected).map("+ " + _)
        val removed = expected.diff(actual).map("- " + _)
        fail(
          "The scopes of the API routes have changed. Check that each listed route requires the right scope for " +
            "scoped tokens (adjust security.RouteScopes if not), then update the snapshot with " +
            "yarn refresh-routescope-snapshots (which copies " + s"$actualPath to $snapshotPath)\n" + (removed ++ added).mkString("\n")
        )
      }
    }
  }
}
