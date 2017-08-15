package com.scalableminds.braingames.datastore.controllers

import com.scalableminds.braingames.binary.helpers.DataSourceRepository
import com.scalableminds.braingames.datastore.tracings._
import com.scalableminds.braingames.datastore.tracings.skeleton.TracingSelector
import com.scalableminds.braingames.datastore.tracings.skeleton.elements.SkeletonTracing
import com.scalableminds.util.tools.Fox
import play.api.i18n.Messages
import play.api.libs.json.{Format, Json}
import play.api.mvc.Action

import scala.concurrent.ExecutionContext.Implicits.global

trait TracingController[T <: Tracing] extends Controller {

  implicit val tracingFormat: Format[T]

  def dataSourceRepository: DataSourceRepository

  def tracingService: TracingService[T]

  def save = Action.async(validateJson[T]) {
    implicit request =>
      AllowRemoteOrigin {
        val tracing = request.body
        for {
          _ <- dataSourceRepository.findUsableByName(tracing.dataSetName) ?~> Messages("dataSource.notUsable")
          _ <- tracingService.save(tracing)
        } yield Ok(Json.toJson(TracingReference(tracing.id, tracingService.tracingType)))
      }
  }

  def saveMultiple = Action(validateJson[List[T]]) {
    implicit request => {
      AllowRemoteOrigin {
        // TODO how do we handle failures?
        val tracings = request.body
        tracings.foreach(tracingService.save)
        val references = tracings.map(t => TracingReference("t.id", TracingType.skeleton))
        Ok(Json.toJson(references))
      }
    }
  }

  def get(tracingId: String, version: Option[Long]) = Action.async {
    implicit request => {
      AllowRemoteOrigin {
        for {
          tracing <- tracingService.findUpdated(tracingId) ?~> Messages("tracing.notFound")
        } yield {
          Ok(Json.toJson(tracing))
        }
      }
    }
  }

  def getMultiple = Action.async(validateJson[List[TracingSelector]]) {
    implicit request => {
      AllowRemoteOrigin {
        tracingService.findMultipleUpdated(request.body).map(tracings => Ok(Json.toJson(tracings)))
      }
    }
  }

  // def withUpdateAllowed(tracingId: String, updateGroups: List[UpdateActionGroup[T]])() = {

  //}

  /*def withAuthorizedUpdate(updateGroups: ): Box[Long] = {
    val timestamps = updateGroups.map(_.timestamp)

    // report timestamps, check, that update is allowed etc., get statistics, properly handle wrong version

    updateGroups.foldLeft[Box[Long]](Full(currentVersion)) { (versionBox, updateGroup) =>
      versionBox match {
        case Full(version) if version + 1 == updateGroup.version =>
          f(updateGroup).map(_ => updateGroup.version)
        case Full(version) =>
          Failure(s"Unexpected version: ${updateGroup.version}, expected: ${version + 1}.")
        case Empty =>
          Empty
        case f: Failure =>
          f
      }
    }
  }*/
}
