/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.datastore.controllers

import com.scalableminds.braingames.binary.helpers.DataSourceRepository
import com.scalableminds.braingames.datastore.tracings._
import com.scalableminds.braingames.datastore.tracings.skeleton.TracingSelector
import play.api.i18n.Messages
import play.api.libs.json.{Format, Json}
import play.api.mvc.Action

import scala.concurrent.ExecutionContext.Implicits.global

trait TracingController[T <: Tracing] extends Controller {

  implicit val tracingFormat: Format[T] = tracingService.tracingFormat

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
        tracings.foreach(tracing => tracingService.save(tracing, toCache = false))
        val references = tracings.map(t => TracingReference("t.id", TracingType.skeleton))
        Ok(Json.toJson(references))
      }
    }
  }

  def get(tracingId: String, version: Option[Long]) = Action.async {
    implicit request => {
      AllowRemoteOrigin {
        for {
          tracing <- tracingService.find(tracingId, version, applyUpdates = true) ?~> Messages("tracing.notFound")
        } yield {
          Ok(Json.toJson(tracing))
        }
      }
    }
  }

  def getMultiple = Action.async(validateJson[List[TracingSelector]]) {
    implicit request => {
      AllowRemoteOrigin {
        for {
          tracings <- tracingService.findMultiple(request.body, applyUpdates = true)
        } yield {
          Ok(Json.toJson(tracings))
        }
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
