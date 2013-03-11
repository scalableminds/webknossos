package controllers

import play.api.Logger
import play.api.libs.json.Json._
import play.api.libs.json._
import nml.BranchPoint
import play.api.mvc._
import org.bson.types.ObjectId
import brainflight.tools.Math._
import brainflight.security.Secured
import brainflight.tools.geometry.Vector3I
import brainflight.tools.geometry.Vector3I._
import models.user.User
import models.security._
import models.tracing.Tracing
import play.api.libs.iteratee._
import play.api.libs.iteratee.Concurrent.Channel
import play.api.libs.Comet
import models.binary.DataSet
import nml.Node
import nml.Edge
import brainflight.tools.geometry.Point3D
import models.tracing.UsedTracings
import models.user.TimeTracking
import brainflight.view.helpers._
import models.task.Task
import views._
import play.api.i18n.Messages
import models.tracing.UsedTracings
import net.liftweb.common._
import braingames.mvc.Controller
import models.tracing.TracingType
import controllers.admin.NMLIO
import brainflight.security.AuthenticatedRequest
import play.api.templates.Html
import models.tracing.TracingLike
import models.task.Project
import models.tracing.CompoundTracing
import models.task.TaskType

object TracingController extends Controller with Secured with TracingInformationProvider {
  override val DefaultAccessRole = Role.User

  def createExplorational = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    for {
      dataSetId <- postParameter("dataSetId") ?~ Messages("dataSet.notSupplied")
      dataSet <- DataSet.findOneById(dataSetId) ?~ Messages("dataSet.notFound")
    } yield {
      val tracing = Tracing.createTracingFor(request.user, dataSet)
      Redirect(routes.TracingController.trace(tracing.id))
    }
  }

  def info(tracingType: String, identifier: String) = Authenticated { implicit request =>
    respondWithTracingInformation(tracingType, identifier).map { x =>
      UsedTracings.use(request.user, identifier)
      Ok(x)
    }
  }

  def update(tracingId: String, version: Int) = Authenticated(parse.json(maxLength = 2097152)) { implicit request =>
    (for {
      oldTracing <- Tracing.findOneById(tracingId) ?~ Messages("tracing.notFound")
      if (isAllowedToUpdateTracing(oldTracing, request.user))
    } yield {
      if (version == oldTracing.version + 1) {
        request.body match {
          case JsArray(jsUpdates) =>
            Tracing.updateFromJson(jsUpdates, oldTracing) match {
              case Some(tracing) =>
                TimeTracking.logUserAction(request.user, tracing)
                JsonOk(Json.obj("version" -> version), "tracing.saved")
              case _ =>
                JsonBadRequest("Invalid update Json")
            }
          case _ =>
            Logger.error("Invalid update json.")
            JsonBadRequest("Invalid update Json")
        }
      } else
        JsonBadRequest(createTracingInformation(oldTracing), "tracing.dirtyState")
    }) ?~ Messages("notAllowed") ~> 403
  }

  private def finishTracing(user: User, tracingId: String): Box[(Tracing, String)] = {
    (for {
      tracing <- Tracing.findOneById(tracingId) ?~ Messages("tracing.notFound")
      if (isAllowedToUpdateTracing(tracing, user) && tracing.state.isInProgress)
    } yield {
      UsedTracings.removeAll(tracing)
      NMLIO.writeTracingToFile(tracing)
      tracing match {
        case tracing if tracing._task.isEmpty =>
          tracing.update(_.finish) -> Messages("tracing.finished")
        case tracing if Task.isTrainingsTracing(tracing) =>
          tracing.update(_.passToReview) -> Messages("task.passedToReview")
        case _ =>
          tracing.update(_.finish) -> Messages("task.finished")
      }
    }) ?~ Messages("tracing.notPossible")
  }

  def finish(tracingId: String, experimental: Boolean) = Authenticated { implicit request =>
    finishTracing(request.user, tracingId).map {
      case (tracing, message) =>
        if (experimental)
          JsonOk(message)
        else
          (for {
            taskId <- tracing._task ?~ Messages("tracing.task.notFound")
            task <- Task.findOneById(taskId) ?~ Messages("task.notFound")
          } yield {
            JsonOk(
                html.user.dashboard.taskTracingTableItem(task, tracing), 
                Json.obj("hasAnOpenTask" -> Tracing.hasAnOpenTracings(request.user, TracingType.Task)),
                message)
          }) asResult
    }
  }

  def finishWithRedirect(tracingId: String) = Authenticated { implicit request =>
    finishTracing(request.user, tracingId).map {
      case (_, message) =>
        Redirect(routes.UserController.dashboard).flashing("success" -> message)
    }
  }

  def htmlForTracing(tracing: Tracing)(implicit request: AuthenticatedRequest[_]) = {
    val additionalHtml =
      (if (tracing.tracingType == TracingType.Review) {
        Tracing.findTrainingForReviewTracing(tracing).map { training =>
          html.admin.training.trainingsReviewItem(training, admin.TrainingsTracingAdministration.reviewForm)
        }
      } else
        tracing.review.headOption.flatMap(_.comment).map(comment =>
          html.oxalis.trainingsComment(comment))).getOrElse(Html.empty)
    html.oxalis.trace(tracing)(additionalHtml)
  }

  def index = Authenticated { implicit request =>
    UsedTracings
      .by(request.user)
      .headOption
      .flatMap(Tracing.findOneById)
      .map(tracing => Ok(htmlForTracing(tracing)))
      .getOrElse(Redirect(routes.UserController.dashboard))
  }

  def view(tracingId: String) = trace(tracingId)

  def trace(tracingId: String) = Authenticated { implicit request =>
    val user = request.user
    (for {
      tracing <- Tracing.findOneById(tracingId) ?~ Messages("tracing.notFound")
      if (isAllowedToViewTracing(tracing, user))
    } yield {
      Ok(htmlForTracing(tracing))
    }) ?~ Messages("notAllowed") ~> 403
  }
}

trait TracingInformationProvider extends play.api.http.Status with TracingRights {
  import braingames.mvc.BoxImplicits._

  def createDataSetInformation(dataSetName: String) =
    DataSet.findOneByName(dataSetName) match {
      case Some(dataSet) =>
        Json.obj(
          "dataSet" -> Json.obj(
            "id" -> dataSet.id,
            "name" -> dataSet.name,
            "dataLayers" -> Json.toJson(dataSet.dataLayers.map {
              case (id, layer) =>
                id -> Json.obj(
                  "resolutions" -> layer.supportedResolutions)
            }),
            "upperBoundary" -> dataSet.maxCoordinates))
      case _ =>
        Json.obj("error" -> Messages("dataSet.notFound"))
    }

  def createTracingInformation(tracing: TracingLike[_]) = {
    Json.obj(
      "tracing" -> TracingLike.TracingLikeWrites.writes(tracing))
  }

  def respondWithTracingInformation(tracingType: String, identifier: String)(implicit request: AuthenticatedRequest[_]) = Box[JsObject] {
    tracingType match {
      case x if x == TracingType.CompoundProject.toString =>
        projectTracingInformationProvider(identifier)
      case x if x == TracingType.CompoundTask.toString =>
        taskTracingInformationProvider(identifier)
      case x if x == TracingType.CompoundTaskType.toString =>
        taskTypeTracingInformationProvider(identifier)
      case _ =>
        savedTracingInformationProvider(identifier)
    }
  }

  def projectTracingInformationProvider(projectName: String)(implicit request: AuthenticatedRequest[_]): Box[JsObject] = {
    (for {
      project <- Project.findOneByName(projectName) ?~ Messages("project.notFound")
      if (isAllowedToViewProject(project, request.user))
      tracing <- CompoundTracing.createFromProject(project)
    } yield {
      Logger.debug("Nodes: " + tracing.trees.map(_.nodes.size).sum)
      createTracingInformation(tracing) ++
        createDataSetInformation(tracing.dataSetName)
    }) ?~ Messages("notAllowed") ~> 403
  }

  def taskTracingInformationProvider(taskId: String)(implicit request: AuthenticatedRequest[_]): Box[JsObject] = {
    (for {
      task <- Task.findOneById(taskId) ?~ Messages("task.notFound")
      if (isAllowedToViewTask(task, request.user))
      tracing <- CompoundTracing.createFromTask(task)
    } yield {
      createTracingInformation(tracing) ++
        createDataSetInformation(tracing.dataSetName)
    }) ?~ Messages("notAllowed") ~> 403
  }
  
  def taskTypeTracingInformationProvider(taskTypeId: String)(implicit request: AuthenticatedRequest[_]): Box[JsObject] = {
    (for {
      taskType <- TaskType.findOneById(taskTypeId) ?~ Messages("taskType.notFound")
      if (isAllowedToViewTaskType(taskType, request.user))
      tracing <- CompoundTracing.createFromTaskType(taskType)
    } yield {
      createTracingInformation(tracing) ++
        createDataSetInformation(tracing.dataSetName)
    }) ?~ Messages("notAllowed") ~> 403
  }

  def savedTracingInformationProvider(tracingId: String)(implicit request: AuthenticatedRequest[_]): Box[JsObject] = {
    (for {
      tracing <- Tracing.findOneById(tracingId) ?~ Messages("tracing.notFound")
      if (isAllowedToViewTracing(tracing, request.user))
    } yield {
      createTracingInformation(tracing) ++
        createDataSetInformation(tracing.dataSetName)
    }) ?~ Messages("notAllowed") ~> 403
  }
}

trait TracingRights {
  def isAllowedToViewTracing(tracing: Tracing, user: User) = {
    tracing._user == user._id || (Role.Admin.map(user.hasRole) getOrElse false)
  }

  def isAllowedToViewProject(project: Project, user: User) = {
    Role.Admin.map(user.hasRole) getOrElse false
  }

  def isAllowedToViewTask(task: Task, user: User) = {
    Role.Admin.map(user.hasRole) getOrElse false
  }
  
  def isAllowedToViewTaskType(taskType: TaskType, user: User) = {
    Role.Admin.map(user.hasRole) getOrElse false
  }

  def isAllowedToUpdateTracing(tracing: Tracing, user: User) = {
    tracing._user == user._id
  }
}
