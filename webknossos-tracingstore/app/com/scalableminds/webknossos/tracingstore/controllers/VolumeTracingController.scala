package com.scalableminds.webknossos.tracingstore.controllers

import akka.stream.scaladsl.Source
import com.google.inject.Inject
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.tracingstore.VolumeTracing.{VolumeTracing, VolumeTracingOpt, VolumeTracings}
import com.scalableminds.webknossos.datastore.models.WebKnossosDataRequest
import com.scalableminds.webknossos.datastore.services.{AccessTokenService, UserAccessRequest}
import com.scalableminds.webknossos.tracingstore.{TracingStoreAccessTokenService, TracingStoreConfig, TracingStoreWkRpcClient}
import com.scalableminds.webknossos.tracingstore.tracings._
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeTracingService
import play.api.i18n.Messages
import play.api.libs.iteratee.Enumerator
import play.api.libs.iteratee.streams.IterateeStreams
import play.api.libs.json.Json
import play.api.mvc.PlayBodyParsers

import scala.concurrent.ExecutionContext

class VolumeTracingController @Inject()(val tracingService: VolumeTracingService,
                                        val webKnossosServer: TracingStoreWkRpcClient,
                                        val accessTokenService: TracingStoreAccessTokenService,
                                        config: TracingStoreConfig,
                                        tracingDataStore: TracingDataStore)
                                       (implicit val ec: ExecutionContext,
                                        val bodyParsers: PlayBodyParsers)
  extends TracingController[VolumeTracing, VolumeTracings] {

  implicit val tracingsCompanion = VolumeTracings

  implicit def packMultiple(tracings: List[VolumeTracing]): VolumeTracings = VolumeTracings(tracings.map(t => VolumeTracingOpt(Some(t))))

  implicit def unpackMultiple(tracings: VolumeTracings): List[Option[VolumeTracing]] = tracings.tracings.toList.map(_.tracing)

  override def freezeVersions = config.Tracingstore.freezeVolumeVersions

  def initialData(tracingId: String) = Action.async { implicit request =>
    log {
      accessTokenService.validateAccess(UserAccessRequest.webknossos) {
        AllowRemoteOrigin {
          for {
            initialData <- request.body.asRaw.map(_.asFile) ?~> Messages("zipFile.notFound")
            tracing <- tracingService.find(tracingId) ?~> Messages("tracing.notFound")
            _ <- tracingService.initializeWithData(tracingId, tracing, initialData)
          } yield Ok(Json.toJson(tracingId))
        }
      }
    }
  }

  def allData(tracingId: String, version: Option[Long]) = Action.async { implicit request =>
    log {
      accessTokenService.validateAccess(UserAccessRequest.webknossos) {
        AllowRemoteOrigin {
          for {
            tracing <- tracingService.find(tracingId, version) ?~> Messages("tracing.notFound")
          } yield {
            val enumerator: Enumerator[Array[Byte]] = tracingService.allData(tracingId, tracing)
            Ok.chunked(Source.fromPublisher(IterateeStreams.enumeratorToPublisher(enumerator)))
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
            tracing <- tracingService.find(tracingId) ?~>  Messages("tracing.notFound")
            (data, indices) <- tracingService.data(tracingId, tracing, request.body)
          } yield Ok(data).withHeaders(getMissingBucketsHeaders(indices): _*)
        }
      }
    }
  }


  private def getMissingBucketsHeaders(indices: List[Int]): Seq[(String, String)] = {
    List(("MISSING-BUCKETS" -> formatMissingBucketList(indices)), ("Access-Control-Expose-Headers" -> "MISSING-BUCKETS"))
  }

  private def formatMissingBucketList(indices: List[Int]): String = {
    "[" + indices.mkString(", ") + "]"
  }


  def duplicate(tracingId: String, version: Option[Long]) = Action.async { implicit request =>
    log {
      accessTokenService.validateAccess(UserAccessRequest.webknossos) {
        AllowRemoteOrigin {
          for {
            tracing <- tracingService.find(tracingId) ?~> Messages("tracing.notFound")
            newId <- tracingService.duplicate(tracingId, tracing)
          } yield {
            Ok(Json.toJson(newId))
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
