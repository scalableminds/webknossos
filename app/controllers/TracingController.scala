package controllers

import play.api.Logger
import play.api.libs.json.Json._
import play.api.libs.json._
import oxalis.nml.BranchPoint
import play.api.mvc._
import org.bson.types.ObjectId
import braingames.util.Math._
import oxalis.security.Secured
import braingames.geometry.Vector3I
import braingames.geometry.Vector3I._
import models.user.User
import models.security._
import models.tracing.Tracing
import play.api.libs.iteratee._
import play.api.libs.iteratee.Concurrent.Channel
import play.api.libs.Comet
import oxalis.nml.Node
import oxalis.nml.Edge
import braingames.geometry.Point3D
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
import oxalis.security.AuthenticatedRequest
import play.api.templates.Html
import models.tracing.TracingLike
import models.task.Project
import models.tracing.CompoundTracing
import models.task.TaskType
import models.tracing.TemporaryTracing
import controllers.tracing.handler._
import scala.concurrent.Future
import scala.concurrent.duration._
import brainflight.tracing.RequestTemporaryTracing
import brainflight.tracing.TracingIdentifier
import akka.pattern.ask
import play.api.libs.concurrent.Execution.Implicits._
import akka.util.Timeout
import braingames.util.ExtendedTypes.When
import models.binary.DataSetDAO

object TracingController extends Controller with Secured with TracingInformationProvider {
  override val DefaultAccessRole = Role.User

  def createExplorational = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    for {
      dataSetName <- postParameter("dataSetName") ?~ Messages("dataSet.notSupplied")
      dataSet <- DataSetDAO.findOneByName(dataSetName) ?~ Messages("dataSet.notFound")
    } yield {
      val tracing = Tracing.createTracingFor(request.user, dataSet)
      Redirect(routes.TracingController.trace(tracing.id))
    }
  }

  def info(tracingType: String, identifier: String) = Authenticated { implicit request =>
    Async {
      respondWithTracingInformation(tracingType, identifier).map { x =>
        UsedTracings.use(request.user, identifier)
        x.map(js => Ok(js))
      }
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

  def finishTracing(user: User, tracing: Tracing): Box[(Tracing, String)] = {
    if (isAllowedToFinishTracing(tracing, user)) {
      if (tracing.state.isInProgress) {
        UsedTracings.removeAll(tracing.id)
        NMLIO.writeTracingToFile(tracing)
        tracing match {
          case tracing if tracing._task.isEmpty =>
            Full(tracing.update(_.finish) -> Messages("tracing.finished"))
          case tracing if Task.isTrainingsTracing(tracing) =>
            Full(tracing.update(_.passToReview) -> Messages("task.passedToReview"))
          case _ =>
            val nodesInBase = 
              tracing.task.flatMap(_.tracingBase.map(Tracing.statisticsForTracing(_).numberOfNodes)).getOrElse(1L)
            if(Tracing.statisticsForTracing(tracing).numberOfNodes > nodesInBase)
              Full(tracing.update(_.finish) -> Messages("task.finished"))
            else
              Failure(Messages("tracing.notEnoughNodes"))
        }
      } else
        Failure(Messages("tracing.notInProgress"))
    } else
      Failure(Messages("tracing.notPossible"))
  }

  def finish(tracingId: String, experimental: Boolean) = Authenticated { implicit request =>
    for {
      oldTracing <- Tracing.findOneById(tracingId) ?~ Messages("tracing.notFound")
      (tracing, message) <- finishTracing(request.user, oldTracing)
    } yield {
      if (experimental)
        JsonOk(message)
      else
        (for {
          task <- tracing.task ?~ Messages("tracing.task.notFound")
        } yield {
          JsonOk(
            html.user.dashboard.taskTracingTableItem(task, tracing),
            Json.obj("hasAnOpenTask" -> Tracing.hasAnOpenTracings(request.user, TracingType.Task)),
            message)
        }) asResult
    }
  }

  def finishWithRedirect(tracingId: String) = Authenticated { implicit request =>
    for {
      tracing <- Tracing.findOneById(tracingId) ?~ Messages("tracing.notFound")
    } yield {
      finishTracing(request.user, tracing) match{
        case Full((_, message)) =>
          Redirect(routes.UserController.dashboard).flashing("success" -> message)
        case Failure(message, _, _) =>
          Redirect(routes.UserController.dashboard).flashing("error" -> message)
          
      }
    }
  }

  def nameExplorativeTracing(tracingId: String) = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    for {
      tracing <- Tracing.findOneById(tracingId) ?~ Messages("tracing.notFound")
      name <- postParameter("name") ?~ Messages("tracing.invalidName")
    } yield {
      val updated = tracing.update(_.copy(_name = Some(name)))
      JsonOk(
        html.user.dashboard.explorativeTracingTableItem(updated),
        Messages("tracing.setName"))
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

  def trace(tracingId: String) = Authenticated { implicit request =>
    (for {
      tracing <- Tracing.findOneById(tracingId) ?~ Messages("tracing.notFound")
      if (tracing.accessPermission(request.user))
    } yield {
      val modified =
        tracing
          .when(!isAllowedToUpdateTracing(_, request.user))(_.makeReadOnly)
          .when(_.state.isFinished)(_.allowAllModes)

      Ok(htmlForTracing(modified))
    }) ?~ Messages("notAllowed") ~> 403
  }

  def download(tracingType: String, identifier: String) = Authenticated { implicit request =>
    Async {
      findTracing(tracingType, identifier).map { result =>
        (for {
          tracing <- result
          tracingName <- nameTracing(tracing)
          if !Task.isTrainingsTracing(tracing) && tracing.accessPermission(request.user)
        } yield {
          Ok(NMLIO.toXML(tracing)).withHeaders(
            CONTENT_TYPE -> "application/octet-stream",
            CONTENT_DISPOSITION -> (s"attachment; filename=$tracingName.nml"))
        }) ?~ Messages("tracing.download.notAllowed")
      }
    }
  }
}

trait TracingInformationProvider extends play.api.http.Status with TracingRights {
  import braingames.mvc.BoxImplicits._

  import tracing.handler.TracingInformationHandler._

  def createDataSetInformation(dataSetName: String) =
    DataSetDAO.findOneByName(dataSetName) match {
      case Some(dataSet) =>
        Json.obj(
          "dataSet" -> Json.obj(
            "name" -> dataSet.name,
            "id" -> dataSet.name,
            "dataLayers" -> Json.toJson(dataSet.dataLayers.map {
              case (id, layer) =>
                id -> Json.obj(
                  "resolutions" -> layer.supportedResolutions)
            }),
            "upperBoundary" -> dataSet.maxCoordinates))
      case _ =>
        Json.obj("error" -> Messages("dataSet.notFound"))
    }

  def createTracingInformation[T <: TracingLike](tracing: T) = {
    Json.obj(
      "tracing" -> TracingLike.TracingLikeWrites.writes(tracing))
  }

  def withInformationHandler[A, T](tracingType: String)(f: TracingInformationHandler => T)(implicit request: AuthenticatedRequest[_]): T = {
    f(informationHandlers(tracingType))
  }

  def findTracing(tracingType: String, identifier: String)(implicit request: AuthenticatedRequest[_]): Future[Box[TracingLike]] = {
    val id = TracingIdentifier(tracingType, identifier)
    implicit val timeout = Timeout(5 seconds)
    val f = Application.temporaryTracingGenerator ? RequestTemporaryTracing(id)

    f.mapTo[Future[Box[TracingLike]]].flatMap(_.map(_.map { tracing =>
      tracing
        .when(!isAllowedToUpdateTracing(_, request.user))(_.makeReadOnly)
        .when(_.state.isFinished)(_.allowAllModes)
    }))
  }

  def nameTracing(tracing: TracingLike)(implicit request: AuthenticatedRequest[_]) = Box[String] {
    withInformationHandler(tracing.tracingType.toString) { handler =>
      handler.nameForTracing(tracing)
    }
  }

  def respondWithTracingInformation(tracingType: String, identifier: String)(implicit request: AuthenticatedRequest[_]): Future[Box[JsObject]] = {
    findTracing(tracingType, identifier).map(_.map { tracing =>
      createTracingInformation(tracing) ++
        createDataSetInformation(tracing.dataSetName)
    })
  }
}

trait TracingRights {
  def isAllowedToViewProject(project: Project, user: User) = {
    Role.Admin.map(user.hasRole) getOrElse false
  }

  def isAllowedToViewTask(task: Task, user: User) = {
    Role.Admin.map(user.hasRole) getOrElse false
  }

  def isAllowedToViewTaskType(taskType: TaskType, user: User) = {
    Role.Admin.map(user.hasRole) getOrElse false
  }

  def isAllowedToUpdateTracing[T <: TracingLike](tracing: T, user: User) = {
    tracing.user.map(_._id == user._id) getOrElse false
  }

  def isAllowedToFinishTracing(tracing: Tracing, user: User) = {
    tracing._user == user._id || (Role.Admin.map(user.hasRole) getOrElse false)
  }
}
