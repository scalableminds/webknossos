package backend

import com.scalableminds.webknossos.datastore.services.{AccessMode, AccessResourceType}
import org.scalatest.wordspec.AnyWordSpec

import scala.io.Source
import scala.util.Using
import security.{RouteScopes, Scope, ScopeMode, ScopeResource, ScopeSet}

class ScopeTestSuite extends AnyWordSpec {

  // Every (http method, controller, action) in the route files, e.g. ("GET", "controllers.DatasetController", "read").
  private lazy val routedActions: Seq[(String, String, String)] = {
    val routePattern = """^(GET|POST|PUT|PATCH|DELETE|HEAD)\s+\S+\s+(controllers\.[A-Za-z]+)\.([A-Za-z0-9_]+)""".r
    Seq("conf/webknossos.latest.routes", "conf/webknossos.versioned.routes").flatMap { path =>
      Using.resource(Source.fromFile(path))(_.getLines().toList).flatMap { line =>
        routePattern.findFirstMatchIn(line).map(m => (m.group(1), m.group(2), m.group(3)))
      }
    }.distinct
  }

  "Scope.covers" should {
    "cover the same scope" in
      assert(Scope(ScopeResource.dataset, ScopeMode.read).covers(Scope(ScopeResource.dataset, ScopeMode.read)))

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

    "never cover a different resource" in
      assert(!Scope(ScopeResource.dataset, ScopeMode.delete).covers(Scope(ScopeResource.annotation, ScopeMode.read)))
  }

  "ScopeSet" should {
    "parse a comma separated list and ignore unknown entries" in {
      val parsed = ScopeSet.parse("dataset:read, annotation:write ,nonsense,dataset:bogus")
      assert(parsed.scopes.size == 2)
      assert(parsed.allows(Scope(ScopeResource.dataset, ScopeMode.read)))
      assert(parsed.allows(Scope(ScopeResource.annotation, ScopeMode.write)))
    }

    "round-trip through toString" in {
      val set = ScopeSet.parse("dataset:read,annotation:delete")
      assert(ScopeSet.parse(set.toString).scopes == set.scopes)
    }

    "allow nothing when empty" in
      assert(!ScopeSet.empty.allows(Scope(ScopeResource.dataset, ScopeMode.read)))
  }

  "ScopeSet.forLevel" should {
    "grant read on everything at the read level" in {
      val read = ScopeSet.forLevel(ScopeMode.read)
      assert(read.allows(Scope(ScopeResource.dataset, ScopeMode.read)))
      assert(read.allows(Scope(ScopeResource.organization, ScopeMode.read)))
      assert(!read.allows(Scope(ScopeResource.dataset, ScopeMode.write)))
    }

    "grant writing content, but keep the organization read-only" in {
      val write = ScopeSet.forLevel(ScopeMode.write)
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
      val delete = ScopeSet.forLevel(ScopeMode.delete)
      assert(delete.allows(Scope(ScopeResource.dataset, ScopeMode.delete)))
      assert(delete.allows(Scope(ScopeResource.annotation, ScopeMode.delete)))
      assert(delete.allows(Scope(ScopeResource.team, ScopeMode.delete)))
      assert(!delete.allows(Scope(ScopeResource.organization, ScopeMode.delete)))
    }

    "grant administrating datasets from the write level upwards, since that is what gates uploading one" in {
      val administrateDatasets = Scope(ScopeResource.dataset, ScopeMode.administrate)
      assert(!ScopeSet.forLevel(ScopeMode.read).allows(administrateDatasets))
      assert(ScopeSet.forLevel(ScopeMode.write).allows(administrateDatasets))
      assert(ScopeSet.forLevel(ScopeMode.delete).allows(administrateDatasets))
      // Only for datasets: nothing else uses administrate, and granting it broadly would open admin routes.
      assert(!ScopeSet.forLevel(ScopeMode.delete).allows(Scope(ScopeResource.organization, ScopeMode.administrate)))
      assert(!ScopeSet.forLevel(ScopeMode.delete).allows(Scope(ScopeResource.annotation, ScopeMode.administrate)))
    }

    "not let administrating datasets imply deleting them" in {
      // Otherwise the Create/modify level, which must be able to upload, could also delete.
      assert(ScopeSet.forLevel(ScopeMode.write).allows(Scope(ScopeResource.dataset, ScopeMode.administrate)))
      assert(!ScopeSet.forLevel(ScopeMode.write).allows(Scope(ScopeResource.dataset, ScopeMode.delete)))
    }
  }

  "ScopeSet.parse" should {
    "understand the coarse level names the UI sends" in {
      assert(ScopeSet.parse("write").scopes == ScopeSet.forLevel(ScopeMode.write).scopes)
      assert(ScopeSet.parse("delete").scopes == ScopeSet.forLevel(ScopeMode.delete).scopes)
    }

    "treat an unknown level such as \"none\" as no permissions at all" in {
      val none = ScopeSet.parse("none")
      assert(none.scopes.isEmpty)
      assert(!none.allows(Scope(ScopeResource.dataset, ScopeMode.read)))
    }

    "combine a level with individual scopes" in {
      val combined = ScopeSet.parse("read,dataset:delete")
      assert(combined.allows(Scope(ScopeResource.dataset, ScopeMode.delete)))
      assert(combined.allows(Scope(ScopeResource.annotation, ScopeMode.read)))
      assert(!combined.allows(Scope(ScopeResource.annotation, ScopeMode.delete)))
    }

    "not treat administrate as a level" in {
      val parsed = ScopeSet.parse("administrate")
      assert(parsed.scopes.isEmpty)
      assert(!parsed.allows(Scope(ScopeResource.team, ScopeMode.administrate)))
    }
  }

  /* The datastore and tracingstore describe access requests with AccessMode and AccessResourceType. Both are
   * Enumerations, whose matches the compiler does not check for completeness: a value added there would only fail at
   * runtime, in UserTokenController.validateUserAccess. These tests list every value, so that adding one fails here
   * until someone decides how scoped tokens treat it. */

  "ScopeMode.fromAccessMode" should {
    "map every datastore access mode onto a scope mode" in {
      val expected = Map(
        AccessMode.list -> ScopeMode.read,
        AccessMode.read -> ScopeMode.read,
        AccessMode.write -> ScopeMode.write,
        AccessMode.delete -> ScopeMode.delete,
        AccessMode.administrate -> ScopeMode.administrate
      )
      assert(
        AccessMode.values.toSet == expected.keySet,
        "AccessMode has changed. Decide how ScopeMode.fromAccessMode maps the new value, then update this test."
      )
      AccessMode.values.foreach(mode => assert(ScopeMode.fromAccessMode(mode) == expected(mode), s"for $mode"))
    }
  }

  "Scope.fromAccessResourceType" should {
    "map every datastore resource type, or deny it to scoped tokens explicitly" in {
      // None means that scoped tokens are denied all access to that resource type.
      val expected: Map[AccessResourceType.Value, Option[ScopeResource.Value]] = Map(
        AccessResourceType.dataset -> Some(ScopeResource.dataset),
        AccessResourceType.annotation -> Some(ScopeResource.annotation),
        // A tracing is part of an annotation.
        AccessResourceType.tracing -> Some(ScopeResource.annotation),
        AccessResourceType.jobExport -> Some(ScopeResource.job),
        // Internal wk-to-store communication.
        AccessResourceType.webknossos -> None,
        // Not classified for scoped tokens yet, there is no scope for alignment projects.
        AccessResourceType.alignmentProject -> None
      )
      assert(
        AccessResourceType.values.toSet == expected.keySet,
        "AccessResourceType has changed. Decide how Scope.fromAccessResourceType maps the new value (or deny it to " +
          "scoped tokens), then update this test."
      )
      AccessResourceType.values.foreach { resourceType =>
        assert(Scope.fromAccessResourceType(resourceType) == expected(resourceType), s"for $resourceType")
      }
    }
  }

  "RouteScopes.requiredScope" should {
    "derive the mode from the http method" in {
      assert(
        RouteScopes
          .requiredScope("controllers.DatasetController", "read", "GET")
          .contains(Scope(ScopeResource.dataset, ScopeMode.read))
      )
      assert(
        RouteScopes
          .requiredScope("controllers.DatasetController", "update", "PATCH")
          .contains(Scope(ScopeResource.dataset, ScopeMode.write))
      )
      assert(
        RouteScopes
          .requiredScope("controllers.DatasetController", "deleteOnDisk", "DELETE")
          .contains(Scope(ScopeResource.dataset, ScopeMode.delete))
      )
    }

    "apply overrides where the http method does not describe the action" in {
      assert(
        RouteScopes
          .requiredScope("controllers.TaskController", "listTasks", "POST")
          .contains(Scope(ScopeResource.task, ScopeMode.read))
      )
      assert(
        RouteScopes
          .requiredScope("controllers.UserTokenController", "generateTokenForDataStore", "POST")
          .contains(Scope(ScopeResource.meta, ScopeMode.read))
      )
      // Creates the sharing token if there is none, and hands out a credential that is not scoped.
      assert(
        RouteScopes
          .requiredScope("controllers.DatasetController", "getSharingToken", "GET")
          .contains(Scope(ScopeResource.dataset, ScopeMode.write))
      )
      // Discards the work done in the annotation, so the write level must not be enough.
      assert(
        RouteScopes
          .requiredScope("controllers.AnnotationController", "reset", "PUT")
          .contains(Scope(ScopeResource.annotation, ScopeMode.delete))
      )
    }

    "deny unmapped controllers, so that new routes are not open to scoped tokens by default" in
      assert(RouteScopes.requiredScope("controllers.SomeNewController", "doThing", "GET").isEmpty)

    "classify every route in the route files" in {
      // Guards against a route being silently unreachable for scoped tokens because its controller was never
      // classified. This is how the legacy api routes (used by clients that pin an api version, such as the
      // WEBKNOSSOS Python library) were missed at first.
      // Controllers that scoped tokens must not reach at all, see the comment in RouteScopes.
      val intentionallyDenied = Set(
        "controllers.AlignmentProjectController",
        "controllers.AnnotationPrivateLinkController",
        "controllers.AuthenticationController",
        "controllers.InitialDataController",
        "controllers.MaintenanceController",
        "controllers.McpController",
        "controllers.OAuthController",
        "controllers.WKRemoteDataStoreController",
        "controllers.WKRemoteTracingStoreController",
        "controllers.WKRemoteWorkerController"
      )

      val unclassified = routedActions.collect {
        case (httpMethod, controller, method)
            if !intentionallyDenied.contains(controller) &&
              !RouteScopes.deniedActions.contains(s"${controller.split('.').last}.$method") &&
              RouteScopes.requiredScope(controller, method, httpMethod).isEmpty =>
          s"$httpMethod $controller.$method"
      }

      assert(unclassified.isEmpty, s"Unclassified routes: ${unclassified.mkString(", ")}")
    }

    "only have method overrides for actions that are routed" in {
      // A renamed or removed action would otherwise leave a stale override behind, and the route would silently fall
      // back to the mode derived from its http method.
      val routedKeys = routedActions.map { case (_, controller, method) =>
        s"${controller.split('.').last}.$method"
      }.toSet
      val stale = RouteScopes.methodOverrides.keySet.diff(routedKeys)
      assert(stale.isEmpty, s"methodOverrides entries without a route: ${stale.mkString(", ")}")
    }

    "only deny actions that are routed" in {
      val routedKeys = routedActions.map { case (_, controller, method) =>
        s"${controller.split('.').last}.$method"
      }.toSet
      val stale = RouteScopes.deniedActions.diff(routedKeys)
      assert(stale.isEmpty, s"deniedActions entries without a route: ${stale.mkString(", ")}")
    }

    "deny the actions that hand out credentials beyond the grant: starting jobs, the job export redirect, private links" in {
      assert(RouteScopes.requiredScope("controllers.JobController", "runExportTiffJob", "POST").isEmpty)
      assert(RouteScopes.requiredScope("controllers.JobController", "retry", "PATCH").isEmpty)
      assert(RouteScopes.requiredScope("controllers.JobController", "redirectToExport", "GET").isEmpty)
      assert(RouteScopes.requiredScope("controllers.AiModelController", "runNeuronTraining", "POST").isEmpty)
      // Private links carry credentials of their own that disconnecting the agent does not revoke.
      assert(RouteScopes.requiredScope("controllers.AnnotationPrivateLinkController", "list", "GET").isEmpty)
      assert(RouteScopes.requiredScope("controllers.AnnotationPrivateLinkController", "create", "POST").isEmpty)
      // Listing and reading jobs stays possible.
      assert(
        RouteScopes
          .requiredScope("controllers.JobController", "list", "GET")
          .contains(Scope(ScopeResource.job, ScopeMode.read))
      )
    }

    "scope the legacy api routes like their current counterparts" in {
      assert(
        RouteScopes
          .requiredScope("controllers.LegacyApiController", "listV15", "GET")
          .contains(Scope(ScopeResource.dataset, ScopeMode.read))
      )
      assert(
        RouteScopes
          .requiredScope("controllers.LegacyApiController", "updatePartialV14", "PATCH")
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
      // An agent must not mint more tokens via the MCP server, nor approve or revoke connections.
      assert(RouteScopes.requiredScope("controllers.McpController", "handle", "POST").isEmpty)
      assert(RouteScopes.requiredScope("controllers.OAuthController", "authorize", "POST").isEmpty)
      assert(RouteScopes.requiredScope("controllers.OAuthController", "revokeGrant", "DELETE").isEmpty)
      assert(RouteScopes.requiredScope("controllers.WKRemoteDataStoreController", "reportDatasets", "POST").isEmpty)
    }
  }
}
