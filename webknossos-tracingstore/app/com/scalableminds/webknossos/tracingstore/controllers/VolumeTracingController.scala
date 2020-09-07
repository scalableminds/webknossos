package com.scalableminds.webknossos.tracingstore.controllers

import akka.stream.scaladsl.Source
import akka.util.ByteString
import com.google.inject.Inject
import com.scalableminds.util.geometry.BoundingBox
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.tracingstore.VolumeTracing.{VolumeTracing, VolumeTracingOpt, VolumeTracings}
import com.scalableminds.webknossos.datastore.models.WebKnossosDataRequest
import com.scalableminds.webknossos.datastore.services.{AccessTokenService, UserAccessRequest}
import com.scalableminds.webknossos.tracingstore.SkeletonTracing.{SkeletonTracing, SkeletonTracingOpt, SkeletonTracings}
import com.scalableminds.webknossos.tracingstore.{
  TracingStoreAccessTokenService,
  TracingStoreConfig,
  TracingStoreWkRpcClient
}
import com.scalableminds.webknossos.tracingstore.tracings._
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeTracingService
import com.scalableminds.util.tools.JsonHelper.boxFormat
import com.scalableminds.util.tools.JsonHelper.optionFormat
import com.scalableminds.webknossos.datastore.storage.TemporaryStore
import com.scalableminds.webknossos.tracingstore.slacknotification.SlackNotificationService
import play.api.http.HttpEntity
import play.api.i18n.Messages
import play.api.libs.iteratee.Enumerator
import play.api.libs.iteratee.streams.IterateeStreams
import play.api.libs.json.Json
import play.api.mvc.{PlayBodyParsers, Result}

import scala.concurrent.ExecutionContext

class VolumeTracingController @Inject()(val tracingService: VolumeTracingService,
                                        val webKnossosServer: TracingStoreWkRpcClient,
                                        val accessTokenService: TracingStoreAccessTokenService,
                                        config: TracingStoreConfig,
                                        tracingDataStore: TracingDataStore,
                                        val slackNotificationService: SlackNotificationService)(
    implicit val ec: ExecutionContext,
    val bodyParsers: PlayBodyParsers)
    extends TracingController[VolumeTracing, VolumeTracings] {

  implicit val tracingsCompanion = VolumeTracings

  implicit def packMultiple(tracings: List[VolumeTracing]): VolumeTracings =
    VolumeTracings(tracings.map(t => VolumeTracingOpt(Some(t))))

  implicit def packMultipleOpt(tracings: List[Option[VolumeTracing]]): VolumeTracings =
    VolumeTracings(tracings.map(t => VolumeTracingOpt(t)))

  implicit def unpackMultiple(tracings: VolumeTracings): List[Option[VolumeTracing]] =
    tracings.tracings.toList.map(_.tracing)

  def initialData(tracingId: String) = Action.async { implicit request =>
    log {
      logTime(slackNotificationService.reportUnusalRequest) {
        accessTokenService.validateAccess(UserAccessRequest.webknossos) {
          AllowRemoteOrigin {
            for {
              initialData <- request.body.asRaw.map(_.asFile) ?~> Messages("zipFile.notFound")
              tracing <- tracingService.find(tracingId) ?~> Messages("tracing.notFound")
              _ <- tracingService.initializeWithData(tracingId, tracing, initialData).toFox
              _ = tracingService.downsample(tracingId: String, tracing: VolumeTracing)
            } yield Ok(Json.toJson(tracingId))
          }
        }
      }
    }
  }

  def mergedFromContents(persist: Boolean) = Action.async(validateProto[VolumeTracings]) { implicit request =>
    log {
      accessTokenService.validateAccess(UserAccessRequest.webknossos) {
        AllowRemoteOrigin {
          val tracings: List[Option[VolumeTracing]] = request.body
          val mergedTracing = tracingService.merge(tracings.flatten)
          tracingService.save(mergedTracing, None, mergedTracing.version, toCache = !persist).map { newId =>
            Ok(Json.toJson(newId))
          }
        }
      }
    }
  }

  def initialDataMultiple(tracingId: String) = Action.async { implicit request =>
    log {
      logTime(slackNotificationService.reportUnusalRequest) {
        accessTokenService.validateAccess(UserAccessRequest.webknossos) {
          AllowRemoteOrigin {
            for {
              initialData <- request.body.asRaw.map(_.asFile) ?~> Messages("zipFile.notFound")
              tracing <- tracingService.find(tracingId) ?~> Messages("tracing.notFound")
              _ <- tracingService.initializeWithDataMultiple(tracingId, tracing, initialData)
            } yield Ok(Json.toJson(tracingId))
          }
        }
      }
    }
  }

  def allData(tracingId: String, version: Option[Long]) = Action.async { implicit request =>
    log {
      accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId)) {
        AllowRemoteOrigin {
          for {
            tracing <- tracingService.find(tracingId, version) ?~> Messages("tracing.notFound")
          } yield {
            val enumerator: Enumerator[Array[Byte]] = tracingService.allDataEnumerator(tracingId, tracing)
            Ok.chunked(Source.fromPublisher(IterateeStreams.enumeratorToPublisher(enumerator)))
          }
        }
      }
    }
  }

  def allDataBlocking(tracingId: String, version: Option[Long]) = Action.async { implicit request =>
    log {
      accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId)) {
        AllowRemoteOrigin {
          for {
            tracing <- tracingService.find(tracingId, version) ?~> Messages("tracing.notFound")
            data <- tracingService.allDataFile(tracingId, tracing)
            _ = Thread.sleep(5)
          } yield {
            Ok.sendFile(data)
          }
        }
      }
    }
  }

  def data(tracingId: String) = Action.async(validateJson[List[WebKnossosDataRequest]]) { implicit request =>
    log {
      accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId)) {
        AllowRemoteOrigin {
          for {
            tracing <- tracingService.find(tracingId) ?~> Messages("tracing.notFound")
            (data, indices) <- tracingService.data(tracingId, tracing, request.body)
          } yield Ok(data).withHeaders(getMissingBucketsHeaders(indices): _*)
        }
      }
    }
  }

  private def getMissingBucketsHeaders(indices: List[Int]): Seq[(String, String)] =
    List(("MISSING-BUCKETS" -> formatMissingBucketList(indices)),
         ("Access-Control-Expose-Headers" -> "MISSING-BUCKETS"))

  private def formatMissingBucketList(indices: List[Int]): String =
    "[" + indices.mkString(", ") + "]"

  def duplicate(tracingId: String, fromTask: Option[Boolean]) = Action.async { implicit request =>
    log {
      logTime(slackNotificationService.reportUnusalRequest) {
        accessTokenService.validateAccess(UserAccessRequest.webknossos) {
          AllowRemoteOrigin {
            for {
              tracing <- tracingService.find(tracingId) ?~> Messages("tracing.notFound")
              dataSetBoundingBox = request.body.asJson.flatMap(_.validateOpt[BoundingBox].asOpt.flatten)
              newId <- tracingService.duplicate(tracingId, tracing, fromTask.getOrElse(false), dataSetBoundingBox)
            } yield {
              Ok(Json.toJson(newId))
            }
          }
        }
      }
    }
  }

  def updateActionLog(tracingId: String) = Action.async { implicit request =>
    log {
      accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId)) {
        AllowRemoteOrigin {
          for {
            updateLog <- tracingService.updateActionLog(tracingId)
          } yield {
            Ok(updateLog)
          }
        }
      }
    }
  }
}
