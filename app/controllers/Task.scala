package controllers

import play.api.Logger
import play.api.libs.json.Json._
import play.api.libs.json._
import models.BranchPoint
import play.api.mvc._
import org.bson.types.ObjectId
import brainflight.tools.Math._
import brainflight.security.Secured
import brainflight.tools.geometry.Vector3I
import brainflight.tools.geometry.Vector3I._
import models.{ User, TransformationMatrix }
import models.Role
import models.Origin
import models.graph.Experiment
import play.api.libs.iteratee.Concurrent
import play.api.libs.iteratee.Iteratee
import play.api.libs.iteratee.Concurrent.Channel
import play.api.libs.iteratee.Input
import play.api.libs.iteratee.Done
import play.api.libs.iteratee.Enumerator
import play.api.libs.Comet
import models.DataSet
import models.graph.Node
import models.graph.Edge
import brainflight.tools.geometry.Point3D

/**
 * scalableminds - brainflight
 * User: tmbo
 * Date: 19.12.11
 * Time: 11:27
 */

object Task extends Controller with Secured {
  override val DefaultAccessRole = Role.User

  def createDataSetInformation(dataSetId: ObjectId) =
    DataSet.findOneById(dataSetId) match {
      case Some(dataSet) =>
        Json.obj(
          "dataSet" -> Json.obj(
            "id" -> dataSet.id,
            "resolutions" -> dataSet.supportedResolutions,
            "upperBoundary" -> dataSet.maxCoordinates))
      case _ =>
        Json.obj("error" -> "Couldn't find dataset.")
    }

  def createTaskInformation(experiment: Experiment) = {
    Json.obj(
      "experiment" -> experiment)
  }

  def info(experimentId: String) = Authenticated { implicit request =>
    Experiment.findOneById(experimentId).map(exp =>
      Ok(createTaskInformation(exp) ++ createDataSetInformation(exp.dataSetId))).getOrElse(BadRequest("Task not found."))
  }

  def update(expId: String) = Authenticated(parse.json) { implicit request =>
    (request.body).asOpt[Experiment].map { exp =>
      Experiment.save(exp)
      Ok
    } getOrElse (BadRequest("Update failed."))
  }
}