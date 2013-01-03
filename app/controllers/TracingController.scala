package controllers

import play.api.Logger
import play.api.libs.json.Json._
import play.api.libs.json._
import models.graph.BranchPoint
import play.api.mvc._
import org.bson.types.ObjectId
import brainflight.tools.Math._
import brainflight.security.Secured
import brainflight.tools.geometry.Vector3I
import brainflight.tools.geometry.Vector3I._
import models.user.User
import models.security._
import models.tracing.Tracing
import play.api.libs.iteratee.Concurrent
import play.api.libs.iteratee.Iteratee
import play.api.libs.iteratee.Concurrent.Channel
import play.api.libs.iteratee.Input
import play.api.libs.iteratee.Done
import play.api.libs.iteratee.Enumerator
import play.api.libs.Comet
import models.binary.DataSet
import models.graph.Node
import models.graph.Edge
import brainflight.tools.geometry.Point3D
import models.tracing.UsedTracings
import models.user.TimeTracking
import brainflight.view.helpers._
import models.task.Task
import views._
import play.api.i18n.Messages
import models.tracing.UsedTracings
import net.liftweb.common._

object TracingController extends Controller with Secured {
  override val DefaultAccessRole = Role.User

  def createDataSetInformation(dataSetName: String) =
    DataSet.findOneByName(dataSetName) match {
      case Some(dataSet) =>
        Json.obj(
          "dataSet" -> Json.obj(
            "id" -> dataSet.id,
            "dataLayers" -> Json.toJson(dataSet.dataLayers.map {
              case (id, layer) =>
                id -> Json.obj(
                  "resolutions" -> layer.supportedResolutions)
            }),
            "upperBoundary" -> dataSet.maxCoordinates))
      case _ =>
        Json.obj("error" -> Messages("dataSet.notFound"))
    }

  def createTracingInformation(tracing: Tracing) = {
    Json.obj(
      "tracing" -> tracing)
  }

  def createTracingsList(user: User) = {
    Tracing.findFor(user).map{ tracing =>
      Json.obj(
        "name" -> (tracing.dataSetName + "  " + formatDate(tracing.date)),
        "id" -> tracing.id,
        "isNew" -> false)
    }
  }

  def createNewTracingList() = {
    DataSet.findAll.map(d => Json.obj(
      "name" -> ("New on " + d.name),
      "id" -> d.id,
      "isNew" -> true))
  }

  def createExplorational = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    for {
      dataSetId <- postParameter("dataSetId") ?~ Messages("dataSet.notSupplied")
      dataSet <- DataSet.findOneById(dataSetId) ?~ Messages("dataSet.notFound")
    } yield {
      val tracing = Tracing.createTracingFor(request.user, dataSet)
      UsedTracings.use(request.user, tracing)
      Redirect(routes.Game.index)
    }
  }

  def list = Authenticated { implicit request =>
    Ok(Json.toJson(createNewTracingList ++ createTracingsList(request.user)))
  }

  def info(tracingId: String) = Authenticated { implicit request =>
    (for {
      tracing <- Tracing.findOneById(tracingId) ?~ Messages("tracing.notFound")
      if(tracing._user == request.user._id)
    } yield {
      Ok(createTracingInformation(tracing) ++
        createDataSetInformation(tracing.dataSetName))
    }) ?~ Messages("notAllowed") ~> 403
  }

  def update(tracingId: String) = Authenticated(parse.json(maxLength = 2097152)) { implicit request =>
    (for {
      tracing <- Tracing.findOneById(tracingId) ?~ Messages("tracing.notFound")
      if(tracing._user == request.user._id)
      updatedTracing <- (request.body).asOpt[Tracing] ?~ Messages("tracing.invalid")
    } yield {
      Tracing.save(updatedTracing.copy(timestamp = System.currentTimeMillis))
      TimeTracking.logUserAction(request.user, updatedTracing)
      Ok
    }) ?~ Messages("notAllowed") ~> 403
  }

  private def finishTracing(user: User, tracingId: String): Box[(Tracing, String)] = {
    (for {
      tracing <- Tracing.findOneById(tracingId) ?~ Messages("tracing.notFound")
      if( tracing._user == user._id && tracing.state.isInProgress) 
    } yield {
      UsedTracings.removeAll(tracing)
      tracing match {
        case tracing if tracing.taskId.isEmpty =>
          tracing.update(_.finish) -> Messages("tracing.finished")
        case tracing if tracing.isTrainingsTracing =>
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
            taskId <- tracing.taskId ?~ Messages("tracing.task.notFound")
            task <- Task.findOneById(taskId) ?~ Messages("task.notFound")
          } yield {
            JsonOk(html.user.dashboard.taskTracingTableItem(task, tracing), message)
          }) asResult
    }
  }

  def finishWithRedirect(tracingId: String) = Authenticated { implicit request =>
    finishTracing(request.user, tracingId).map {
      case (_, message) =>
        Redirect(routes.UserController.dashboard).flashing("success" -> message)
    }
  }

}