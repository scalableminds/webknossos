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
import com.trueaccord.scalapb.{GeneratedMessage, GeneratedMessageCompanion, Message}
import net.liftweb.common.Failure
import play.api.i18n.Messages
import play.api.libs.json.{Format, Json, Reads}
import play.api.mvc.Action

import com.trueaccord.scalapb.json.JsonFormat

import scala.concurrent.ExecutionContext.Implicits.global

trait TracingController[T <: GeneratedMessage with Message[T], Ts <: GeneratedMessage with Message[Ts], U <: UpdateActionGroup[T]] extends Controller {

  def dataSourceRepository: DataSourceRepository

  def tracingService: TracingService[T]

  def webKnossosServer: WebKnossosServer

  implicit val tracingCompanion: GeneratedMessageCompanion[T] = tracingService.tracingCompanion

  implicit val tracingsCompanion: GeneratedMessageCompanion[Ts]

  implicit def unpackMultiple(tracings: Ts): List[T]

  implicit def packMultiple(tracings: List[T]): Ts

  implicit val updateReads: Reads[U]

  def save = Action.async(validateProto[T]) {
    implicit request =>
      AllowRemoteOrigin {
        val tracing = request.body
        tracingService.save(tracing, None, 0).map { newId =>
          Ok(Json.toJson(TracingReference(newId, tracingService.tracingType)))
        }
      }
  }

  def saveMultiple = Action.async(validateProto[Ts]) {
    implicit request => {
      AllowRemoteOrigin {
        val references = Fox.sequence(request.body.map { tracing =>
          tracingService.save(tracing, None, 0, toCache = false).map { newId =>
            TracingReference(newId, TracingType.skeleton)
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
          Ok(tracings.toByteArray)
        }
      }
    }
  }

  def getProto(tracingId: String, version: Option[Long]) = Action.async {
    implicit request => {
      AllowRemoteOrigin {
        for {
          tracing <- tracingService.find(tracingId, version, applyUpdates = true) ?~> Messages("tracing.notFound")
        } yield {
          Ok(tracing.toByteArray)
        }
      }
    }
  }

  def update(tracingId: String) = Action.async(validateJson[List[U]]) {
    implicit request => {
      AllowRemoteOrigin {
        val updateGroups = request.body
        val timestamps = updateGroups.map(_.timestamp)
        val latestStats = updateGroups.flatMap(_.stats).lastOption
        val currentVersion = tracingService.currentVersion(tracingId)
        webKnossosServer.authorizeTracingUpdate(tracingId, timestamps, latestStats).flatMap { _ =>
          updateGroups.foldLeft(currentVersion) { (previousVersion, updateGroup) =>
            previousVersion.flatMap { version =>
              if (version + 1 == updateGroup.version) {
                tracingService.handleUpdateGroup(updateGroup).map(_ => updateGroup.version)
              } else {
                Failure(s"incorrect version. expected: ${version + 1}; got: ${updateGroup.version}")
              }
            }
          }
        }

        //withAuthorizedUpdate(tracingId, request.body) { updates =>
          //Fox.successful(())
          //tracingService.applyUpdates(tracing, updates)
        //}.map(_ => Ok)
        Fox.successful(Ok)
      }
    }
  }

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
