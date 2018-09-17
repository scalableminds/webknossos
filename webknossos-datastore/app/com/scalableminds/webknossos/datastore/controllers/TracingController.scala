package com.scalableminds.webknossos.datastore.controllers

import com.scalableminds.webknossos.datastore.services.{AccessTokenService, DataSourceRepository, UserAccessRequest, WebKnossosServer}
import com.scalableminds.webknossos.datastore.tracings.{TracingSelector, _}
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.JsonHelper.boxFormat
import scalapb.{GeneratedMessage, GeneratedMessageCompanion, Message}
import net.liftweb.common.Failure
import play.api.i18n.Messages
import play.api.libs.json.{Json, Reads}
import play.api.mvc.PlayBodyParsers

import scala.concurrent.ExecutionContext

trait TracingController[T <: GeneratedMessage with Message[T], Ts <: GeneratedMessage with Message[Ts]] extends Controller {

  def dataSourceRepository: DataSourceRepository

  def tracingService: TracingService[T]

  def webKnossosServer: WebKnossosServer

  def accessTokenService: AccessTokenService

  implicit val tracingCompanion: GeneratedMessageCompanion[T] = tracingService.tracingCompanion

  implicit val tracingsCompanion: GeneratedMessageCompanion[Ts]

  implicit def unpackMultiple(tracings: Ts): List[T]

  implicit def packMultiple(tracings: List[T]): Ts

  implicit val updateActionReads: Reads[UpdateAction[T]] = tracingService.updateActionReads

  implicit val ec: ExecutionContext

  implicit val bodyParsers: PlayBodyParsers

  def save = Action.async(validateProto[T]) {
    implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.webknossos) {
        AllowRemoteOrigin {
          val tracing = request.body
          tracingService.save(tracing, None, 0).map { newId =>
            Ok(Json.toJson(newId))
          }
        }
      }
  }

  def saveMultiple = Action.async(validateProto[Ts]) {
    implicit request => {
      accessTokenService.validateAccess(UserAccessRequest.webknossos) {
        AllowRemoteOrigin {
          val savedIds = Fox.sequence(request.body.map { tracing =>
            tracingService.save(tracing, None, 0, toCache = false)
          })
          savedIds.map(id => Ok(Json.toJson(id)))
        }
      }
    }
  }

  def get(tracingId: String, version: Option[Long]) = Action.async {
    implicit request => {
      accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId)) {
        AllowRemoteOrigin {
          for {
            tracing <- tracingService.find(tracingId, version, applyUpdates = true) ?~> Messages("tracing.notFound")
          } yield {
            Ok(tracing.toByteArray).as("application/x-protobuf")
          }
        }
      }
    }
  }

  def getMultiple = Action.async(validateJson[List[TracingSelector]]) {
    implicit request => {
      accessTokenService.validateAccess(UserAccessRequest.webknossos) {
        AllowRemoteOrigin {
          for {
            tracings <- tracingService.findMultiple(request.body, applyUpdates = true)
          } yield {
            Ok(tracings.toByteArray).as("application/x-protobuf")
          }
        }
      }
    }
  }

  def update(tracingId: String) = Action.async(validateJson[List[UpdateActionGroup[T]]]) {
    implicit request => {
      accessTokenService.validateAccess(UserAccessRequest.writeTracing(tracingId)) {
        AllowRemoteOrigin {
          val updateGroups = request.body
          val timestamps = updateGroups.map(_.timestamp)
          val latestStatistics = updateGroups.flatMap(_.stats).lastOption
          val currentVersion = tracingService.currentVersion(tracingId)
          val userToken = request.getQueryString("token")
          webKnossosServer.reportTracingUpdates(tracingId, timestamps, latestStatistics, userToken).flatMap { _ =>
            updateGroups.foldLeft(currentVersion) { (previousVersion, updateGroup) =>
              previousVersion.flatMap { version =>
                if (version + 1 == updateGroup.version) {
                  tracingService.handleUpdateGroup(tracingId, updateGroup).map(_ => updateGroup.version)
                } else {
                  Failure(s"incorrect version. expected: ${version + 1}; got: ${updateGroup.version}")
                }
              }
            }
          }.map(_ => Ok)
        }
      }
    }
  }
}
