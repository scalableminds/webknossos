package security

import security.ScopeResource.ScopeResource

/** Maps a routed request to the scope it requires, so that scoped tokens (see Scope) can be checked centrally in
  * ScopeFilter instead of in each of the ~300 controller actions.
  *
  * The mapping is deliberately default-deny: a controller that is not listed here is not reachable with a scoped token
  * at all. That way a newly added route is locked down until someone classifies it, rather than silently being open to
  * agents.
  *
  * Within a mapped controller the scope mode follows the HTTP method, with `methodOverrides` for the handful of actions
  * where the method does not match the semantics (e.g. `POST /tasks/list` is a read).
  */
object RouteScopes {

  import ScopeResource.*

  private val resourceByController: Map[String, ScopeResource] = Map(
    "AiModelController" -> aiModel,
    "AnalyticsController" -> meta,
    "AnnotationController" -> annotation,
    "AnnotationIOController" -> annotation,
    "AnnotationPrivateLinkController" -> annotation,
    "Application" -> meta,
    "ConfigurationController" -> user,
    "CreditTransactionController" -> organization,
    "DataStoreController" -> meta,
    "DatasetController" -> dataset,
    "EmailVerificationController" -> user,
    "FolderController" -> dataset,
    "JobController" -> job,
    "McpController" -> meta,
    "OrganizationController" -> organization,
    "PathDeletionController" -> dataset,
    "ProjectController" -> project,
    "PublicationController" -> dataset,
    "ReportController" -> task,
    "ScriptController" -> script,
    "ShortLinkController" -> meta,
    "TaskController" -> task,
    "TaskTypeController" -> task,
    "TeamController" -> team,
    "TimeController" -> user,
    "TracingStoreController" -> meta,
    "UserController" -> user,
    "UserTokenController" -> meta,
    "VoxelyticsController" -> voxelytics
    // Deliberately absent, and therefore denied to scoped tokens:
    // - AuthenticationController: hands out and revokes the user's unscoped API token, so a scoped token must not
    //   reach it. This is what stops an agent from escalating its own permissions.
    // - WKRemoteDataStoreController, WKRemoteTracingStoreController, WKRemoteWorkerController: internal
    //   store-to-wk communication, authenticated by a store key rather than by a user token.
    // - InitialDataController, MaintenanceController: instance administration.
  )

  /** Scopes for individual actions, both resource and mode. Used for controllers that are not tied to a single
    * resource, so that they are not mapped as a whole and new actions on them stay denied until classified.
    *
    * LegacyApiController serves the older api versions of routes whose behaviour changed, see
    * conf/webknossos.versioned.routes. Clients that pin an api version (the WEBKNOSSOS Python library does) end up here
    * rather than on the current route, so these must be scoped just like their current counterparts.
    */
  private val scopeOverrides: Map[String, Scope] = Map(
    "LegacyApiController.listV14" -> Scope(dataset, ScopeMode.read),
    "LegacyApiController.listV15" -> Scope(dataset, ScopeMode.read),
    "LegacyApiController.readV14" -> Scope(dataset, ScopeMode.read),
    "LegacyApiController.updatePartialV12" -> Scope(dataset, ScopeMode.write),
    "LegacyApiController.updatePartialV14" -> Scope(dataset, ScopeMode.write),
    "LegacyApiController.reserveUploadToPathsV14" -> Scope(dataset, ScopeMode.write),
    "LegacyApiController.reserveUploadToPathsForPreliminaryV14" -> Scope(dataset, ScopeMode.write)
  )

  // Actions whose HTTP method does not describe what they do.
  private val methodOverrides: Map[String, ScopeMode.Value] = Map(
    "ConfigurationController.readDatasetViewConfiguration" -> ScopeMode.read,
    "TaskController.listTasks" -> ScopeMode.read,
    "CreditTransactionController.revokeExpiredCredits" -> ScopeMode.administrate,
    "McpController.handle" -> ScopeMode.read,
    "McpController.bundle" -> ScopeMode.read,
    // Exchanges the caller's token for a datastore token. Safe for scoped tokens because the scopes are carried
    // over, see UserTokenController.generateTokenForDataStore.
    "UserTokenController.generateTokenForDataStore" -> ScopeMode.read
  )

  private def modeForHttpMethod(httpMethod: String): Option[ScopeMode.Value] = httpMethod match {
    case "GET" | "HEAD"           => Some(ScopeMode.read)
    case "POST" | "PUT" | "PATCH" => Some(ScopeMode.write)
    case "DELETE"                 => Some(ScopeMode.delete)
    case _                        => None
  }

  /** The scope required to call the given action, or None if scoped tokens must not call it at all.
    *
    * @param controller
    *   fully qualified controller name as reported by the router, e.g. controllers.DatasetController
    * @param method
    *   action name, e.g. deleteOnDisk
    */
  def requiredScope(controller: String, method: String, httpMethod: String): Option[Scope] = {
    val simpleController = controller.split('.').last
    val key = s"$simpleController.$method"
    scopeOverrides.get(key).orElse {
      for {
        resource <- resourceByController.get(simpleController)
        mode <- methodOverrides.get(key).orElse(modeForHttpMethod(httpMethod))
      } yield Scope(resource, mode)
    }
  }
}
