package backend

import com.scalableminds.webknossos.datastore.services.{AccessMode, AccessResourceType}
import org.scalatest.wordspec.AnyWordSpec

import scala.io.Source
import scala.util.Using
import security.{RouteScopes, Scope, ScopeMode, ScopeResource}

class ScopeTestSuite extends AnyWordSpec {

  "Scope.covers" should {
    "cover the same scope" in {
      assert(Scope(ScopeResource.dataset, ScopeMode.read).covers(Scope(ScopeResource.dataset, ScopeMode.read)))
    }

    "cover weaker modes on the same resource" in {
      val write = Scope(ScopeResource.dataset, ScopeMode.write)
      assert(write.covers(Scope(ScopeResource.dataset, ScopeMode.read)))
      assert(!write.covers(Scope(ScopeResource.dataset, ScopeMode.delete)))
      assert(!write.covers(Scope(ScopeResource.dataset, ScopeMode.administrate)))
    }

    "keep administrate outside the read/write/delete ladder in both directions" in {
      val administrate = Scope(ScopeResource.dataset, ScopeMode.administrate)
      assert(administrate.covers(Scope(ScopeResource.dataset, ScopeMode.administrate)))
      assert(!administrate.covers(Scope(ScopeResource.dataset, ScopeMode.read)))
      assert(!administrate.covers(Scope(ScopeResource.dataset, ScopeMode.write)))
      assert(!administrate.covers(Scope(ScopeResource.dataset, ScopeMode.delete)))
      assert(!Scope(ScopeResource.dataset, ScopeMode.delete).covers(administrate))
    }

    "never cover a different resource" in {
      assert(!Scope(ScopeResource.dataset, ScopeMode.delete).covers(Scope(ScopeResource.annotation, ScopeMode.read)))
    }
  }

  "Scope.Set" should {
    "parse a comma separated list and ignore unknown entries" in {
      val parsed = Scope.Set.parse("dataset:read, annotation:write ,nonsense,dataset:bogus")
      assert(parsed.scopes.size == 2)
      assert(parsed.allows(Scope(ScopeResource.dataset, ScopeMode.read)))
      assert(parsed.allows(Scope(ScopeResource.annotation, ScopeMode.write)))
    }

    "round-trip through toString" in {
      val set = Scope.Set.parse("dataset:read,annotation:delete")
      assert(Scope.Set.parse(set.toString).scopes == set.scopes)
    }

    "allow nothing when empty" in {
      assert(!Scope.Set.empty.allows(Scope(ScopeResource.dataset, ScopeMode.read)))
    }

    "let the default agent scopes read datasets and write annotations, but not delete datasets" in {
      val default = Scope.Set.defaultForAgents
      assert(default.allows(Scope(ScopeResource.dataset, ScopeMode.read)))
      assert(default.allows(Scope(ScopeResource.annotation, ScopeMode.write)))
      assert(!default.allows(Scope(ScopeResource.dataset, ScopeMode.write)))
      assert(!default.allows(Scope(ScopeResource.dataset, ScopeMode.delete)))
      assert(!default.allows(Scope(ScopeResource.annotation, ScopeMode.delete)))
    }
  }

  "Scope.Set.forLevel" should {
    "grant read on everything at the read level" in {
      val read = Scope.Set.forLevel(ScopeMode.read)
      assert(read.allows(Scope(ScopeResource.dataset, ScopeMode.read)))
      assert(read.allows(Scope(ScopeResource.organization, ScopeMode.read)))
      assert(!read.allows(Scope(ScopeResource.dataset, ScopeMode.write)))
    }

    "grant writing content, but keep the organization read-only" in {
      val write = Scope.Set.forLevel(ScopeMode.write)
      assert(write.allows(Scope(ScopeResource.dataset, ScopeMode.write)))
      assert(write.allows(Scope(ScopeResource.annotation, ScopeMode.write)))
      assert(!write.allows(Scope(ScopeResource.dataset, ScopeMode.delete)))
      // The Python library creates teams and updates users, so those have to be writable.
      assert(write.allows(Scope(ScopeResource.team, ScopeMode.write)))
      assert(write.allows(Scope(ScopeResource.user, ScopeMode.write)))
      assert(!write.allows(Scope(ScopeResource.organization, ScopeMode.write)))
      assert(!write.allows(Scope(ScopeResource.organization, ScopeMode.read)) == false)
    }

    "grant deleting content at the delete level" in {
      val delete = Scope.Set.forLevel(ScopeMode.delete)
      assert(delete.allows(Scope(ScopeResource.dataset, ScopeMode.delete)))
      assert(delete.allows(Scope(ScopeResource.annotation, ScopeMode.delete)))
      assert(delete.allows(Scope(ScopeResource.team, ScopeMode.delete)))
      assert(!delete.allows(Scope(ScopeResource.organization, ScopeMode.delete)))
    }

    "grant administrating datasets from the write level upwards, since that is what gates uploading one" in {
      val administrateDatasets = Scope(ScopeResource.dataset, ScopeMode.administrate)
      assert(!Scope.Set.forLevel(ScopeMode.read).allows(administrateDatasets))
      assert(Scope.Set.forLevel(ScopeMode.write).allows(administrateDatasets))
      assert(Scope.Set.forLevel(ScopeMode.delete).allows(administrateDatasets))
      // Only for datasets: nothing else uses administrate, and granting it broadly would open admin routes.
      assert(!Scope.Set.forLevel(ScopeMode.delete).allows(Scope(ScopeResource.organization, ScopeMode.administrate)))
      assert(!Scope.Set.forLevel(ScopeMode.delete).allows(Scope(ScopeResource.annotation, ScopeMode.administrate)))
    }

    "not let administrating datasets imply deleting them" in {
      // Otherwise the Create/modify level, which must be able to upload, could also delete.
      assert(Scope.Set.forLevel(ScopeMode.write).allows(Scope(ScopeResource.dataset, ScopeMode.administrate)))
      assert(!Scope.Set.forLevel(ScopeMode.write).allows(Scope(ScopeResource.dataset, ScopeMode.delete)))
    }
  }

  "Scope.Set.parse" should {
    "understand the coarse level names the UI sends" in {
      assert(Scope.Set.parse("write").scopes == Scope.Set.forLevel(ScopeMode.write).scopes)
      assert(Scope.Set.parse("delete").scopes == Scope.Set.forLevel(ScopeMode.delete).scopes)
    }

    "treat an unknown level such as \"none\" as no permissions at all" in {
      val none = Scope.Set.parse("none")
      assert(none.scopes.isEmpty)
      assert(!none.allows(Scope(ScopeResource.dataset, ScopeMode.read)))
    }

    "combine a level with individual scopes" in {
      val combined = Scope.Set.parse("read,dataset:delete")
      assert(combined.allows(Scope(ScopeResource.dataset, ScopeMode.delete)))
      assert(combined.allows(Scope(ScopeResource.annotation, ScopeMode.read)))
      assert(!combined.allows(Scope(ScopeResource.annotation, ScopeMode.delete)))
    }
  }

  "Scope.Set.isParsable" should {
    "accept the levels and explicit scopes the UI and the docs use" in {
      assert(Scope.Set.isParsable("read"))
      assert(Scope.Set.isParsable("write"))
      assert(Scope.Set.isParsable("delete"))
      assert(Scope.Set.isParsable("dataset:read,annotation:write"))
    }

    "accept the explicit way of granting nothing" in {
      assert(Scope.Set.isParsable("none"))
      assert(Scope.Set.parse("none").scopes.isEmpty)
    }

    "reject typos, so that they are not silently stored as no permissions" in {
      assert(!Scope.Set.isParsable("raed"))
      assert(!Scope.Set.isParsable("dataset:raed"))
      assert(!Scope.Set.isParsable("read,nonsense"))
    }
  }


  "ScopeMode.fromAccessMode" should {
    "map the datastore access modes onto scope modes" in {
      assert(ScopeMode.fromAccessMode(AccessMode.list) == ScopeMode.read)
      assert(ScopeMode.fromAccessMode(AccessMode.read) == ScopeMode.read)
      assert(ScopeMode.fromAccessMode(AccessMode.write) == ScopeMode.write)
      assert(ScopeMode.fromAccessMode(AccessMode.delete) == ScopeMode.delete)
      assert(ScopeMode.fromAccessMode(AccessMode.administrate) == ScopeMode.administrate)
    }
  }

  "Scope.fromAccessResourceType" should {
    "treat a tracing as part of an annotation" in {
      assert(Scope.fromAccessResourceType(AccessResourceType.tracing).contains(ScopeResource.annotation))
    }

    "never map the internal webknossos resource type" in {
      assert(Scope.fromAccessResourceType(AccessResourceType.webknossos).isEmpty)
    }
  }

  "RouteScopes.requiredScope" should {
    "derive the mode from the http method" in {
      assert(
        RouteScopes.requiredScope("controllers.DatasetController", "read", "GET")
          .contains(Scope(ScopeResource.dataset, ScopeMode.read))
      )
      assert(
        RouteScopes.requiredScope("controllers.DatasetController", "update", "PATCH")
          .contains(Scope(ScopeResource.dataset, ScopeMode.write))
      )
      assert(
        RouteScopes.requiredScope("controllers.DatasetController", "deleteOnDisk", "DELETE")
          .contains(Scope(ScopeResource.dataset, ScopeMode.delete))
      )
    }

    "apply overrides where the http method does not describe the action" in {
      assert(
        RouteScopes.requiredScope("controllers.TaskController", "listTasks", "POST")
          .contains(Scope(ScopeResource.task, ScopeMode.read))
      )
      assert(
        RouteScopes.requiredScope("controllers.UserTokenController", "generateTokenForDataStore", "POST")
          .contains(Scope(ScopeResource.meta, ScopeMode.read))
      )
    }

    "deny unmapped controllers, so that new routes are not open to scoped tokens by default" in {
      assert(RouteScopes.requiredScope("controllers.SomeNewController", "doThing", "GET").isEmpty)
    }

    "classify every route in the route files" in {
      // Guards against a route being silently unreachable for scoped tokens because its controller was never
      // classified. This is how the legacy api routes (used by clients that pin an api version, such as the
      // WEBKNOSSOS Python library) were missed at first.
      val routePattern = """^(GET|POST|PUT|PATCH|DELETE|HEAD)\s+\S+\s+(controllers\.[A-Za-z]+)\.([A-Za-z0-9_]+)""".r

      // Controllers that scoped tokens must not reach at all, see the comment in RouteScopes.
      val intentionallyDenied = scala.collection.immutable.Set(
        "controllers.AuthenticationController",
        "controllers.InitialDataController",
        "controllers.MaintenanceController",
        "controllers.WKRemoteDataStoreController",
        "controllers.WKRemoteTracingStoreController",
        "controllers.WKRemoteWorkerController"
      )

      val routeFiles = Seq("conf/webknossos.latest.routes", "conf/webknossos.versioned.routes")
      val unclassified = routeFiles.flatMap { path =>
        Using.resource(Source.fromFile(path))(_.getLines().toList).flatMap { line =>
          routePattern.findFirstMatchIn(line).flatMap { m =>
            val (httpMethod, controller, method) = (m.group(1), m.group(2), m.group(3))
            if (intentionallyDenied.contains(controller)) None
            else if (RouteScopes.requiredScope(controller, method, httpMethod).isDefined) None
            else Some(s"$httpMethod $controller.$method")
          }
        }
      }.distinct

      assert(unclassified.isEmpty, s"Unclassified routes: ${unclassified.mkString(", ")}")
    }

    "scope the legacy api routes like their current counterparts" in {
      assert(
        RouteScopes.requiredScope("controllers.LegacyApiController", "listV15", "GET")
          .contains(Scope(ScopeResource.dataset, ScopeMode.read))
      )
      assert(
        RouteScopes.requiredScope("controllers.LegacyApiController", "updatePartialV14", "PATCH")
          .contains(Scope(ScopeResource.dataset, ScopeMode.write))
      )
      // A legacy action that has not been classified stays denied.
      assert(RouteScopes.requiredScope("controllers.LegacyApiController", "somethingNewV16", "GET").isEmpty)
    }

    "deny the controllers that would let a scoped token escalate or administrate" in {
      // Handing out the user's unscoped API token would defeat the whole mechanism.
      assert(RouteScopes.requiredScope("controllers.AuthenticationController", "getToken", "GET").isEmpty)
      assert(RouteScopes.requiredScope("controllers.AuthenticationController", "deleteToken", "DELETE").isEmpty)
      assert(RouteScopes.requiredScope("controllers.MaintenanceController", "create", "POST").isEmpty)
      assert(RouteScopes.requiredScope("controllers.InitialDataController", "triggerInsert", "POST").isEmpty)
      assert(RouteScopes.requiredScope("controllers.WKRemoteDataStoreController", "reportDatasets", "POST").isEmpty)
    }
  }
}
