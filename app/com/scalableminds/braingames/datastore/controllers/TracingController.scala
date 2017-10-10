/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.datastore.controllers

import com.scalableminds.braingames.binary.helpers.DataSourceRepository
import com.scalableminds.braingames.datastore.SkeletonTracing.Color
import com.scalableminds.braingames.datastore.geometry.{Point3D, Vector3D}
import com.scalableminds.braingames.datastore.services.{UserAccessRequest, WebKnossosServer}
import com.scalableminds.braingames.datastore.tracings._
import com.scalableminds.braingames.datastore.tracings.skeleton.TracingSelector
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.JsonHelper.boxFormat
import com.trueaccord.scalapb.json.{JsonFormat, Printer}
import com.trueaccord.scalapb.{GeneratedMessage, GeneratedMessageCompanion, Message}
import org.json4s.JsonAST._
import play.api.i18n.Messages
import play.api.libs.json.{Json, Reads}
import play.api.mvc.Action

import scala.concurrent.ExecutionContext.Implicits.global

trait TracingController[T <: GeneratedMessage with Message[T], Ts <: GeneratedMessage with Message[Ts]] extends TokenSecuredController {

  def dataSourceRepository: DataSourceRepository

  def tracingService: TracingService[T]

  def webKnossosServer: WebKnossosServer

  implicit val tracingCompanion: GeneratedMessageCompanion[T] = tracingService.tracingCompanion

  implicit val tracingsCompanion: GeneratedMessageCompanion[Ts]

  implicit def unpackMultiple(tracings: Ts): List[T]

  implicit def packMultiple(tracings: List[T]): Ts

  implicit val updateActionReads: Reads[UpdateAction[T]] = tracingService.updateActionReads

  lazy val protoJsonPrinter = new Printer(
    formattingLongAsNumber = true,
    includingEmptySeqFields = true,
    formatRegistry = JsonFormat.DefaultRegistry
      .registerWriter[Point3D](p => JArray(List(JInt(p.x), JInt(p.y), JInt(p.z))), json => Point3D(0, 0, 0))
      .registerWriter[Vector3D](v => JArray(List(JDouble(v.x), JDouble(v.y), JDouble(v.z))), json => Vector3D(0.0, 0.0, 0.0))
      .registerWriter[Color](c => JArray(List(JDouble(c.r), JDouble(c.g), JDouble(c.b))), json => Color(0.0, 0.0, 0.0, 1.0)))

  def save = TokenSecuredAction(UserAccessRequest.webknossos).async(validateProto[T]) {
    implicit request =>
      AllowRemoteOrigin {
        val tracing = request.body
        tracingService.save(tracing, None, 0).map { newId =>
          Ok(Json.toJson(TracingReference(newId, tracingService.tracingType)))
        }
      }
  }

  def saveMultiple = TokenSecuredAction(UserAccessRequest.webknossos).async(validateProto[Ts]) {
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

  def get(tracingId: String, version: Option[Long]) = TokenSecuredAction(UserAccessRequest.readTracing(tracingId)).async {
    implicit request => {
      AllowRemoteOrigin {
        for {
          tracing <- tracingService.find(tracingId, version, applyUpdates = true) ?~> Messages("tracing.notFound")
        } yield {
          Ok(protoJsonPrinter.print(tracing))
        }
      }
    }
  }

  def getMultiple = TokenSecuredAction(UserAccessRequest.webknossos).async(validateJson[List[TracingSelector]]) {
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

  def getProto(tracingId: String, version: Option[Long]) = TokenSecuredAction(UserAccessRequest.webknossos).async {
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

  def update(tracingId: String) = TokenSecuredAction(UserAccessRequest.writeTracing(tracingId)).async(validateJson[List[UpdateActionGroup[T]]]) {
    implicit request => {
      AllowRemoteOrigin {
        val updateGroups = request.body
        val timestamps = updateGroups.map(_.timestamp)
        val latestStatistics = updateGroups.flatMap(_.stats).lastOption
        val currentVersion = tracingService.currentVersion(tracingId)
        webKnossosServer.authorizeTracingUpdate(tracingId, timestamps, latestStatistics).flatMap { _ =>
          updateGroups.foldLeft(currentVersion) { (previousVersion, updateGroup) =>
            previousVersion.flatMap { version =>
              //if (version + 1 == updateGroup.version) {
                tracingService.handleUpdateGroup(tracingId, updateGroup).map(_ => updateGroup.version)
              //} else {
              //  Failure(s"incorrect version. expected: ${version + 1}; got: ${updateGroup.version}")
              //}
            }
          }
        }.map(_ => Ok)
      }
    }
  }
}
