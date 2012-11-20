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
import brainflight.format.DateFormatter
import models.tracing.UsedTracings
import models.user.TimeTracking

/**
 * scalableminds - brainflight
 * User: tmbo
 * Date: 19.12.11
 * Time: 11:27
 */

object TracingController extends Controller with Secured {
  override val DefaultAccessRole = Role.User

  def createDataSetInformation(dataSetName: String) =
    DataSet.findOneByName(dataSetName) match {
      case Some(dataSet) =>
        Json.obj(
          "dataSet" -> Json.obj(
            "id" -> dataSet.id,
            "resolutions" -> dataSet.supportedResolutions,
            "upperBoundary" -> dataSet.maxCoordinates))
      case _ =>
        Json.obj("error" -> "Couldn't find dataset.")
    }

  def createTracingInformation(tracing: Tracing) = {
    Json.obj(
      "tracing" -> tracing)
  }

  def createTracingsList(user: User) = {
    for {
      exp <- Tracing.findFor(user)
    } yield {
      Json.obj(
        "name" -> (exp.dataSetName + " " + DateFormatter.format(exp.date)),
        "id" -> exp.id,
        "isNew" -> false)
    }
  }

  def createNewTracingList() = {
    DataSet.findAll.map(d => Json.obj(
      "name" -> ("New on " + d.name),
      "id" -> d.id,
      "isNew" -> true))
  }

  def useAsActive(id: String, isNew: Boolean) = Authenticated { implicit request =>
    val user = request.user
    if (isNew) {
      DataSet.findOneById(id).map { dataSet =>
        val exp = Tracing.createTracingFor(user, dataSet)
        UsedTracings.use(user, exp)
        Ok
      } getOrElse BadRequest("Couldn't find DataSet.")
    } else {
      Tracing.findOneById(id).filter(_._user == user._id).map { exp =>
        UsedTracings.use(user, exp)
        Ok
      } getOrElse BadRequest("Coudln't find tracing.")
    }
  }

  def createExplorational = Authenticated(parser = parse.urlFormEncoded) { implicit request =>
    (for{
      dataSetId <- request.body.get("dataSetId").flatMap(_.headOption)
      dataSet <- DataSet.findOneById(dataSetId)
    } yield {
      val exp = Tracing.createTracingFor(request.user, dataSet)
      UsedTracings.use(request.user, exp)
      Redirect(routes.Game.index)
    }) getOrElse BadRequest("Couldn't find DataSet.")
  }

  def list = Authenticated { implicit request =>
    Ok(Json.toJson(createNewTracingList ++ createTracingsList(request.user)))
  }

  def info(tracingId: String) = Authenticated { implicit request =>
    Tracing.findOneById(tracingId).filter(_._user == request.user._id).map(exp =>
      Ok(createTracingInformation(exp) ++ createDataSetInformation(exp.dataSetName))).getOrElse(BadRequest("Tracing with id '%s' not found.".format(tracingId)))
  }

  def update(tracingId: String) = Authenticated(parse.json(maxLength = 2097152)) { implicit request =>
    Tracing.findOneById(tracingId).filter(_._user == request.user._id).flatMap { _ =>
      (request.body).asOpt[Tracing].map { exp =>
        Tracing.save(exp.copy(timestamp = System.currentTimeMillis))
        TimeTracking.logUserAction(request.user)
        Ok
      }
    } getOrElse (BadRequest("Update for tracing with id '%s' failed.".format(tracingId)))
  }
}