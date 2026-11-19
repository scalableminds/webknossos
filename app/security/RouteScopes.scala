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
  *
  * The resulting scope of every route is listed in test/backend/route-scopes.snapshot.txt, which
  * RouteScopesSnapshotTestSuite keeps in sync. A new or changed route therefore shows up there in review, and so does
  * its scope, even if it was derived from the HTTP method without anyone deciding it.
  */
object RouteScopes {

  import ScopeResource.*

  private val resourceByController: Map[String, ScopeResource] = Map(
    "AiModelController" -> aiModel,
    "AnalyticsController" -> meta,
    "AnnotationController" -> annotation,
    "AnnotationIOController" -> annotation,
    "Application" -> meta,
    "ConfigurationController" -> user,
    "CreditTransactionController" -> organization,
    "DataStoreController" -> meta,
    "DatasetController" -> dataset,
    "EmailVerificationController" -> user,
    "FolderController" -> dataset,
    "JobController" -> job,
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
    // - AnnotationPrivateLinkController: a private link carries an access token of its own, which is tied to the
    //   annotation rather than to the OAuth grant, and which may not expire. Listing links would hand an agent these
    //   credentials, and creating one would give it access that outlives disconnecting it. The remaining action,
    //   annotationSource, is called by the datastore with its key, not with a user token in the headers.
    // - AlignmentProjectController: not classified for scoped tokens yet, there is no scope for alignment projects.
    // - McpController, OAuthController: the MCP server takes OAuth access tokens only, and connecting or revoking
    //   agents is for the user alone. An agent must not mint more tokens or approve connections.
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

  /** Actions that scoped tokens must not call, although their controller is mapped. Not private so that ScopeTestSuite
    * can check that every entry refers to an existing route.
    *
    * Starting a job hands the worker an unscoped token of the job owner (see JobService.parameterWrites), so the job
    * could do more than the agent that started it. Retrying a job does the same. redirectToExport puts the user's
    * unscoped API token into the redirect URL. The WEBKNOSSOS Python library uses none of these.
    */
  val deniedActions: Set[String] = Set(
    "JobController.runComputeMeshFileJob",
    "JobController.runComputeSegmentIndexFileJob",
    "JobController.runExportTiffJob",
    "JobController.runInferMitochondriaJob",
    "JobController.runAlignSectionsJob",
    "JobController.runMaterializeVolumeAnnotationJob",
    "JobController.runFindLargestSegmentIdJob",
    "JobController.runRenderAnimationJob",
    "JobController.retry",
    "JobController.redirectToExport",
    "AiModelController.runNeuronTraining",
    "AiModelController.runInstanceTraining",
    "AiModelController.runNeuronModelInference",
    "AiModelController.runInstanceModelInference"
  )

  // Actions whose HTTP method does not describe what they do. Not private so that ScopeTestSuite can check that every
  // entry refers to an existing route.
  val methodOverrides: Map[String, ScopeMode.Value] = Map(
    "ConfigurationController.readDatasetViewConfiguration" -> ScopeMode.read,
    "TaskController.listTasks" -> ScopeMode.read,
    // Loads data and returns a mask for it, stores nothing.
    "DatasetController.segmentAnythingMask" -> ScopeMode.read,
    // A GET, but it creates the sharing token if there is none yet. The sharing token is an unscoped credential that
    // does not expire, so handing it out is more than reading.
    "DatasetController.getSharingToken" -> ScopeMode.write,
    // Discards the work done in the annotation.
    "AnnotationController.reset" -> ScopeMode.delete,
    "CreditTransactionController.revokeExpiredCredits" -> ScopeMode.administrate,
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
    if (deniedActions.contains(key)) None
    else
      scopeOverrides.get(key).orElse {
        for {
          resource <- resourceByController.get(simpleController)
          mode <- methodOverrides.get(key).orElse(modeForHttpMethod(httpMethod))
        } yield Scope(resource, mode)
      }
  }
}
