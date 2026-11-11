package backend

import org.scalatest.wordspec.AnyWordSpec
import security.{RouteScopes, Scope, ScopeMode, ScopeResource}

/** The routes the WEBKNOSSOS Python library calls, taken from its api_client
  * (https://github.com/scalableminds/webknossos-libs/tree/master/webknossos/webknossos/client/api_client).
  *
  * An agent drives WEBKNOSSOS through that library, so every one of these has to be reachable with an agent token,
  * otherwise the agent fails halfway through a task with a confusing 403. This pins that down: a new permission
  * carve-out that happens to block the library will fail here rather than in someone's session.
  */
class PythonLibraryRoutesTestSuite extends AnyWordSpec {

  private val libraryRoutes: Seq[(String, String, String)] = Seq(
    ("GET", "controllers.Application", "health"), // /health
    ("GET", "controllers.Application", "buildInfo"), // /buildinfo
    ("GET", "controllers.ShortLinkController", "getByKey"), // /shortLinks/byKey/{key}
    ("GET", "controllers.DatasetController", "read"), // /datasets/{dataset_id}
    (
      "GET",
      "controllers.DatasetController",
      "getDatasetIdFromNameAndOrganization"
    ), // /datasets/disambiguate/{organization_id}/{directory_name}/toId
    ("GET", "controllers.DatasetController", "list"), // /datasets
    ("PATCH", "controllers.DatasetController", "updateTeams"), // /datasets/{dataset_id}/teams
    ("PATCH", "controllers.DatasetController", "updatePartial"), // /datasets/{dataset_id}/updatePartial
    ("POST", "controllers.DatasetController", "composeAddLayer"), // /datasets/{dataset_id}/compose/addLayer
    ("POST", "controllers.DatasetController", "composeAddMag"), // /datasets/{dataset_id}/compose/addMag
    ("POST", "controllers.DatasetController", "composeAddAttachment"), // /datasets/{dataset_id}/compose/addAttachment
    ("GET", "controllers.DatasetController", "getSharingToken"), // /datasets/{dataset_id}/sharingToken
    ("GET", "controllers.DatasetController", "isValidNewName"), // /datasets/{dataset_name}/isValidNewName
    (
      "POST",
      "controllers.ConfigurationController",
      "readDatasetViewConfiguration"
    ), // /datasetConfigurations/{dataset_id}
    ("POST", "controllers.DatasetController", "exploreAndAddRemoteDataset"), // /datasets/exploreAndAddRemote
    ("DELETE", "controllers.DatasetController", "delete"), // /datasets/{dataset_id}
    ("GET", "controllers.AnnotationController", "listExplorationals"), // /annotations/readable
    ("GET", "controllers.DataStoreController", "list"), // /datastores
    ("GET", "controllers.TracingStoreController", "listOne"), // /tracingstore
    ("POST", "controllers.ProjectController", "create"), // /projects
    ("DELETE", "controllers.ProjectController", "delete"), // /projects/{project_id}
    ("PUT", "controllers.ProjectController", "update"), // /projects/{project_id}
    ("GET", "controllers.ProjectController", "readByName"), // /projects/byName/{project_name}
    ("GET", "controllers.ProjectController", "read"), // /projects/{project_id}
    ("GET", "controllers.ProjectController", "tasksForProject"), // /projects/{project_id}/tasks
    ("POST", "controllers.TaskTypeController", "create"), // /taskTypes
    ("DELETE", "controllers.TaskTypeController", "delete"), // /taskTypes/{task_type_id}
    ("GET", "controllers.TaskTypeController", "list"), // /taskTypes
    ("GET", "controllers.TaskTypeController", "get"), // /taskTypes/{task_type_id}
    ("GET", "controllers.AnnotationController", "infoWithoutType"), // /annotations/{annotation_id}/info
    ("GET", "controllers.AnnotationIOController", "downloadWithoutType"), // /annotations/{annotation_id}/download
    ("POST", "controllers.AnnotationIOController", "upload"), // /annotations/upload
    (
      "PATCH",
      "controllers.AnnotationController",
      "editAnnotation"
    ), // /annotations/{annotation_typ}/{annotation_id}/edit
    ("GET", "controllers.AnnotationController", "annotationsForTask"), // /tasks/{task_id}/annotations
    ("GET", "controllers.TaskController", "read"), // /tasks/{task_id}
    ("POST", "controllers.TaskController", "listTasks"), // /tasks/list
    ("GET", "controllers.FolderController", "getRoot"), // /folders/root
    ("GET", "controllers.FolderController", "get"), // /folders/{folder_id}
    ("PUT", "controllers.FolderController", "update"), // /folders/{folder_id}
    ("GET", "controllers.FolderController", "getTree"), // /folders/tree
    ("POST", "controllers.FolderController", "create"), // /folders/create
    ("PUT", "controllers.FolderController", "move"), // /folders/{folder_id}/move
    ("DELETE", "controllers.FolderController", "delete"), // /folders/{folder_id}
    ("GET", "controllers.UserController", "user"), // /users/{user_id}
    ("GET", "controllers.UserController", "current"), // /user
    ("GET", "controllers.UserController", "list"), // /users
    ("GET", "controllers.TimeController", "userLoggedTime"), // /users/{user_id}/loggedTime
    ("PATCH", "controllers.UserController", "update"), // /users/{user.id}
    ("GET", "controllers.TeamController", "list"), // /teams
    ("POST", "controllers.TeamController", "create"), // /teams
    ("DELETE", "controllers.TeamController", "delete"), // /teams/{team_id}
    ("POST", "controllers.TaskController", "create"), // /tasks
    ("PUT", "controllers.TaskController", "update"), // /tasks/{task_id}
    ("DELETE", "controllers.TaskController", "delete"), // /tasks/{task_id}
    ("POST", "controllers.TaskController", "createFromFiles"), // /tasks/createFromFiles
    ("POST", "controllers.DatasetController", "reserveUploadToPaths"), // /datasets/reserveUploadToPaths
    (
      "POST",
      "controllers.DatasetController",
      "reserveUploadToPathsForPreliminary"
    ), // /datasets/{dataset_id}/reserveUploadToPathsForPreliminary
    (
      "POST",
      "controllers.DatasetController",
      "reserveAttachmentUploadToPath"
    ), // /datasets/{dataset_id}/reserveAttachmentUploadToPath
    (
      "POST",
      "controllers.DatasetController",
      "finishAttachmentUploadToPath"
    ), // /datasets/{dataset_id}/finishAttachmentUploadToPath
    (
      "POST",
      "controllers.DatasetController",
      "reserveMagUploadToPath"
    ), // /datasets/{dataset_id}/reserveMagUploadToPath
    ("POST", "controllers.DatasetController", "finishMagUploadToPath"), // /datasets/{dataset_id}/finishMagUploadToPath
    ("POST", "controllers.AiModelController", "reserveUploadToPath"), // /aiModels/reserveUploadToPath
    ("GET", "controllers.AiModelController", "readAiModelInfo") // /aiModels/{ai_model_id}
  )

  "The routes used by the WEBKNOSSOS Python library" should {
    "all be classified, so that none of them is rejected outright" in {
      val unclassified = libraryRoutes.filter { case (httpMethod, controller, method) =>
        RouteScopes.requiredScope(controller, method, httpMethod).isEmpty
      }
      assert(unclassified.isEmpty, s"Unclassified library routes: ${unclassified.mkString(", ")}")
    }

    "all be permitted at the delete level, so that the library works fully when the user grants everything" in {
      val granted = Scope.Set.forLevel(ScopeMode.delete)
      val blocked = libraryRoutes.filter { case (httpMethod, controller, method) =>
        !RouteScopes.requiredScope(controller, method, httpMethod).exists(granted.allows)
      }
      assert(blocked.isEmpty, s"Library routes blocked at the delete level: ${blocked.mkString(", ")}")
    }

    "have their read-only part permitted at the read level" in {
      val granted = Scope.Set.forLevel(ScopeMode.read)
      val blocked = libraryRoutes.filter { case (httpMethod, controller, method) =>
        httpMethod == "GET" && !RouteScopes.requiredScope(controller, method, httpMethod).exists(granted.allows)
      }
      assert(blocked.isEmpty, s"Read-only library routes blocked at the read level: ${blocked.mkString(", ")}")
    }

    "not be able to touch the organization at any level" in
      assert(!Scope.Set.forLevel(ScopeMode.delete).allows(Scope(ScopeResource.organization, ScopeMode.write)))
  }
}
