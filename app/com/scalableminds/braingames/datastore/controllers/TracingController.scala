/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.datastore.controllers

import java.util.UUID

import com.scalableminds.braingames.binary.helpers.DataSourceRepository
import com.scalableminds.braingames.datastore.services.WebKnossosServer
import com.scalableminds.braingames.datastore.tracings._
import com.scalableminds.braingames.datastore.tracings.skeleton.TracingSelector
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.JsonHelper.boxFormat
import com.trueaccord.scalapb.json.JsonFormat
import com.trueaccord.scalapb.{GeneratedMessage, GeneratedMessageCompanion, Message}
import play.api.i18n.Messages
import play.api.libs.json.Json
import play.api.mvc.Action

import scala.concurrent.ExecutionContext.Implicits.global

trait TracingController[T <: GeneratedMessage with Message[T]] extends Controller {

  def dataSourceRepository: DataSourceRepository

  def tracingService: TracingService[T]

  def webKnossosServer: WebKnossosServer

  implicit val tracingProtoCompanion: GeneratedMessageCompanion[T] = tracingService.tracingProtoCompanion

  def save = Action.async(validateProto[T]) {
    implicit request =>
      AllowRemoteOrigin {
        val tracing = request.body
        val tracingId = UUID.randomUUID.toString
        for {
          _ <- tracingService.save(tracing, tracingId, 0)
        } yield Ok(Json.toJson(TracingReference(tracingId, tracingService.tracingType)))
      }
  }

  def saveMultiple = Action.async(validateProto[T]) {
    implicit request => {
      AllowRemoteOrigin {
        val tracings = request.body
        // TODO switch back to multiple
        val references = Fox.sequence(List(tracings).map { tracing =>
          val tracingId = UUID.randomUUID.toString
          tracingService.save(tracing, tracingId, 0, toCache = false).map { _ =>
            TracingReference(tracingId, TracingType.skeleton)
          }
        })
        references.map(x => Ok(Json.toJson(x)))
      }
    }
  }

  def get(tracingId: String, version: Option[Long]) = Action.async {
    implicit request => {
      AllowRemoteOrigin {
        for {
          tracing <- tracingService.find(tracingId, version, applyUpdates = true) ?~> Messages("tracing.notFound")
        } yield {
          Ok(JsonFormat.toJsonString(tracing))
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
          // TODO support multiple
          Ok(JsonFormat.toJsonString(tracings.head))
        }
      }
    }
  }

  def withAuthorizedUpdate(tracingId: String, updateGroups: List[UpdateActionGroup[T]]) = {
    /*val timestamps = updateGroups.map(_.timestamp)
    val latestStats = updateGroups.flatMap(_.stats).lastOption
    val currentVersion = tracingService.currentVersion(tracingId)
    webKnossosServer.authorizeTracingUpdate(tracingId, timestamps, latestStats).flatMap { _ =>
      updateGroups.foldLeft(currentVersion) { (previousVersion, updateGroup) =>
        previousVersion.flatMap { version =>
          if (version + 1 == updateGroup.version) {
            tracingService.handleUpdateGroup(tracingId, updateGroup).map(updateGroup.version)
          } else {
            Failure(s"incorrect version. expected: ${version + 1}; got: ${updateGroup.version}")
          }
        }
      }
    }*/
  }

  // def withUpdateAllowed(, updateGroups: List[UpdateActionGroup[T]])() = {

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
