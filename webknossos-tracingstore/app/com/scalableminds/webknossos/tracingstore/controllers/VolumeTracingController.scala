package com.scalableminds.webknossos.tracingstore.controllers

import java.io.File
import java.nio.{ByteBuffer, ByteOrder}

import akka.stream.scaladsl.Source
import com.google.inject.Inject
import com.scalableminds.util.geometry.BoundingBox
import com.scalableminds.util.tools.ExtendedTypes.ExtendedString
import com.scalableminds.webknossos.tracingstore.VolumeTracing.{VolumeTracing, VolumeTracingOpt, VolumeTracings}
import com.scalableminds.webknossos.datastore.models.{WebKnossosDataRequest, WebKnossosIsosurfaceRequest}
import com.scalableminds.webknossos.datastore.services.UserAccessRequest
import com.scalableminds.webknossos.tracingstore.{TracingStoreAccessTokenService, TracingStoreWkRpcClient}
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeTracingService
import com.scalableminds.webknossos.tracingstore.slacknotification.SlackNotificationService
import play.api.i18n.Messages
import play.api.libs.Files.TemporaryFile
import play.api.libs.iteratee.Enumerator
import play.api.libs.iteratee.streams.IterateeStreams
import play.api.libs.json.Json
import play.api.mvc.{Action, MultipartFormData, PlayBodyParsers}

import scala.concurrent.ExecutionContext

class VolumeTracingController @Inject()(val tracingService: VolumeTracingService,
                                        val webKnossosServer: TracingStoreWkRpcClient,
                                        val accessTokenService: TracingStoreAccessTokenService,
                                        val slackNotificationService: SlackNotificationService)(
    implicit val ec: ExecutionContext,
    val bodyParsers: PlayBodyParsers)
    extends TracingController[VolumeTracing, VolumeTracings] {

  implicit val tracingsCompanion: VolumeTracings.type = VolumeTracings

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
              _ <- tracingService.initializeWithData(tracingId, tracing, initialData)
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
    List("MISSING-BUCKETS" -> formatMissingBucketList(indices), "Access-Control-Expose-Headers" -> "MISSING-BUCKETS")

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

  def requestIsosurface(tracingId: String) =
    Action.async(validateJson[WebKnossosIsosurfaceRequest]) { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId)) {
        AllowRemoteOrigin {
          for {
            // The client expects the isosurface as a flat float-array. Three consecutive floats form a 3D point, three
            // consecutive 3D points (i.e., nine floats) form a triangle.
            // There are no shared vertices between triangles.
            (vertices, neighbors) <- tracingService.createIsosurface(tracingId, request.body)
          } yield {
            // We need four bytes for each float
            val responseBuffer = ByteBuffer.allocate(vertices.length * 4).order(ByteOrder.LITTLE_ENDIAN)
            responseBuffer.asFloatBuffer().put(vertices)
            Ok(responseBuffer.array()).withHeaders(getNeighborIndices(neighbors): _*)
          }
        }
      }
    }

  private def getNeighborIndices(neighbors: List[Int]) =
    List(("NEIGHBORS" -> formatNeighborList(neighbors)), ("Access-Control-Expose-Headers" -> "NEIGHBORS"))

  private def formatNeighborList(neighbors: List[Int]): String =
    "[" + neighbors.mkString(", ") + "]"

  def importTracing(tracingId: String): Action[MultipartFormData[TemporaryFile]] =
    Action.async(parse.multipartFormData) { implicit request =>
      log {
        accessTokenService.validateAccess(UserAccessRequest.writeTracing(tracingId)) {
          AllowRemoteOrigin {
            for {
              tracing <- tracingService.find(tracingId)
              currentVersion <- request.body.dataParts("currentVersion").headOption.flatMap(_.toIntOpt).toFox
              zipFile <- request.body.files.headOption.map(f => new File(f.ref.path.toString)).toFox
              _ <- tracingService.importTracing(tracingId, tracing, zipFile, currentVersion)
            } yield Ok(Json.toJson(tracingId))
          }
        }
      }
    }
}
