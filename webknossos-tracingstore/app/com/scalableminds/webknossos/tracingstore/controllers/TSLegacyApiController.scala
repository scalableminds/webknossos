package com.scalableminds.webknossos.tracingstore.controllers

import com.google.inject.Inject
import com.scalableminds.util.Msg
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.mvc.ExtendedController
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.datareaders.{ArrayOrder, AxisOrder}
import com.scalableminds.webknossos.datastore.datareaders.zarr.{NgffGroupHeader, NgffMetadata, ZarrHeader}
import com.scalableminds.webknossos.datastore.helpers.{ProtoGeometryConversions, UPath}
import com.scalableminds.webknossos.datastore.models.datasource.*
import com.scalableminds.webknossos.datastore.services.UserAccessRequest
import com.scalableminds.webknossos.tracingstore.annotation.TSAnnotationService
import com.scalableminds.webknossos.tracingstore.{TSRemoteWebknossosClient, TracingStoreAccessTokenService}
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent}

import java.nio.file.Path
import scala.concurrent.ExecutionContext

/** Zarr v2 output (.zgroup/.zattrs/.zarray) is no longer served by VolumeTracingZarrStreamingController (the
  * "latest" controller) since Zarr v3 is now the default there. This controller is the sole remaining place
  * that implements Zarr v2 output, reachable only through the old, version-pinned routes at API v14 and below -
  * mirroring DSLegacyApiController's role for the datastore. Unlike DSLegacyApiController, no id resolution is
  * needed here, since tracingId addressing hasn't changed across API versions.
  */
class TSLegacyApiController @Inject() (
    accessTokenService: TracingStoreAccessTokenService,
    annotationService: TSAnnotationService,
    remoteWebknossosClient: TSRemoteWebknossosClient
)(implicit ec: ExecutionContext)
    extends ExtendedController
    with ProtoGeometryConversions {

  override def defaultErrorCode: Int = NOT_FOUND

  def volumeTracingDirectoryContentV14(tracingId: String): Action[AnyContent] =
    Action.fox { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
        for {
          annotationId <- remoteWebknossosClient.getAnnotationIdForTracing(tracingId)
          tracing <- annotationService.findVolume(annotationId, tracingId) ?~> Msg.Annotation.notFound ~> NOT_FOUND
          existingMags = tracing.mags.map(vec3IntFromProto)
          additionalFiles = List(NgffMetadata.FILENAME_DOT_ZATTRS, NgffGroupHeader.FILENAME_DOT_ZGROUP)
        } yield Ok(
          views.html.datastoreZarrDatasourceDir(
            "Tracingstore",
            "%s".format(tracingId),
            additionalFiles ++ existingMags.map(_.toMagLiteral(allowScalar = true))
          )
        ).withHeaders()
      }
    }

  def volumeTracingDirectoryContentJsonV14(tracingId: String): Action[AnyContent] =
    Action.fox { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
        for {
          annotationId <- remoteWebknossosClient.getAnnotationIdForTracing(tracingId)
          tracing <- annotationService.findVolume(annotationId, tracingId) ?~> Msg.Annotation.notFound ~> NOT_FOUND
          existingMags = tracing.mags.map(vec3IntFromProto(_).toMagLiteral(allowScalar = true))
          additionalFiles = List(NgffMetadata.FILENAME_DOT_ZATTRS, NgffGroupHeader.FILENAME_DOT_ZGROUP)
        } yield Ok(Json.toJson(additionalFiles ++ existingMags))
      }
    }

  def volumeTracingMagDirectoryContentV14(tracingId: String, mag: String): Action[AnyContent] =
    Action.fox { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
        for {
          annotationId <- remoteWebknossosClient.getAnnotationIdForTracing(tracingId)
          tracing <- annotationService.findVolume(annotationId, tracingId) ?~> Msg.Annotation.notFound ~> NOT_FOUND
          existingMags = tracing.mags.map(vec3IntFromProto)
          magParsed <- Vec3Int.fromMagLiteral(mag, allowScalar = true).toFox ?~> Msg.Dataset.Mag
            .invalid(mag) ~> NOT_FOUND
          _ <- Fox
            .fromBool(existingMags.contains(magParsed)) ?~> Msg.Annotation.Volume.wrongMag(tracingId, mag) ~> NOT_FOUND
        } yield Ok(
          views.html.datastoreZarrDatasourceDir(
            "Tracingstore",
            "%s".format(tracingId),
            List(ZarrHeader.FILENAME_DOT_ZARRAY)
          )
        ).withHeaders()
      }
    }

  def volumeTracingMagDirectoryContentJsonV14(tracingId: String, mag: String): Action[AnyContent] =
    Action.fox { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
        for {
          annotationId <- remoteWebknossosClient.getAnnotationIdForTracing(tracingId)
          tracing <- annotationService.findVolume(annotationId, tracingId) ?~> Msg.Annotation.notFound ~> NOT_FOUND
          existingMags = tracing.mags.map(vec3IntFromProto)
          magParsed <- Vec3Int.fromMagLiteral(mag, allowScalar = true).toFox ?~> Msg.Dataset.Mag
            .invalid(mag) ~> NOT_FOUND
          _ <- Fox
            .fromBool(existingMags.contains(magParsed)) ?~> Msg.Annotation.Volume.wrongMag(tracingId, mag) ~> NOT_FOUND
        } yield Ok(Json.toJson(List(ZarrHeader.FILENAME_DOT_ZARRAY)))
      }
    }

  def zGroupV14(tracingId: String): Action[AnyContent] = Action.fox { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
      Fox.successful(Ok(Json.toJson(NgffGroupHeader(zarr_format = 2))))
    }
  }

  def zAttrsV14(tracingId: String): Action[AnyContent] = Action.fox { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
      for {
        annotationId <- remoteWebknossosClient.getAnnotationIdForTracing(tracingId)
        tracing <- annotationService.findVolume(annotationId, tracingId) ?~> Msg.Annotation.notFound ~> NOT_FOUND
        existingMags = tracing.mags.map(vec3IntFromProto)
        dataSource <- remoteWebknossosClient.getDataSourceForAnnotation(annotationId) ~> NOT_FOUND
        omeNgffHeader = NgffMetadata.fromNameVoxelSizeAndMags(
          tracingId,
          dataSourceVoxelSize = dataSource.scale,
          mags = existingMags.toList
        )
      } yield Ok(Json.toJson(omeNgffHeader))
    }
  }

  def zArrayV14(tracingId: String, mag: String): Action[AnyContent] = Action.fox { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
      for {
        annotationId <- remoteWebknossosClient.getAnnotationIdForTracing(tracingId)
        tracing <- annotationService.findVolume(annotationId, tracingId) ?~> Msg.Annotation.notFound ~> NOT_FOUND
        existingMags = tracing.mags.map(vec3IntFromProto)
        magParsed <- Vec3Int.fromMagLiteral(mag, allowScalar = true).toFox ?~> Msg.Dataset.Mag
          .invalid(mag) ~> NOT_FOUND
        _ <- Fox
          .fromBool(existingMags.contains(magParsed)) ?~> Msg.Annotation.Volume.wrongMag(tracingId, mag) ~> NOT_FOUND
        cubeLength = DataLayer.bucketLength
        (channels, dtype) = ElementClass.toChannelAndZarrString(elementClassFromProto(tracing.elementClass))
        // data request method always decompresses before sending
        compressor = None
        shape = Array(
          channels,
          // Zarr can't handle data sets that don't start at 0, so we extend shape to include "true" coords
          (tracing.boundingBox.width + tracing.boundingBox.topLeft.x) / magParsed.x,
          (tracing.boundingBox.height + tracing.boundingBox.topLeft.y) / magParsed.y,
          (tracing.boundingBox.depth + tracing.boundingBox.topLeft.z) / magParsed.z
        )
        chunks = Array(channels, cubeLength, cubeLength, cubeLength)
        zarrHeader = ZarrHeader(
          zarr_format = 2,
          shape = shape.map(_.toLong),
          chunks = chunks,
          compressor = compressor,
          dtype = dtype,
          order = ArrayOrder.F
        )
      } yield Ok(Json.toJson(zarrHeader))
    }
  }

  def zarrSourceV14(tracingId: String, tracingName: Option[String]): Action[AnyContent] =
    Action.fox { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
        for {
          annotationId <- remoteWebknossosClient.getAnnotationIdForTracing(tracingId)
          tracing <- annotationService.findVolume(annotationId, tracingId) ?~> Msg.Annotation.notFound ~> NOT_FOUND
          layerName = tracingName.getOrElse(tracingId)
          zarrLayer = StaticSegmentationLayer(
            name = layerName,
            dataFormat = DataFormat.zarr,
            largestSegmentId = tracing.largestSegmentId,
            boundingBox = boundingBoxFromProto(tracing.boundingBox),
            elementClass = elementClassFromProto(tracing.elementClass),
            mags = tracing.mags.toList
              .map(vec3IntFromProto)
              .map(m =>
                MagLocator(
                  m,
                  Some(UPath.fromLocalPath(Path.of(s"./$layerName/${m.toMagLiteral(allowScalar = true)}"))),
                  None,
                  Some(AxisOrder.cxyz),
                  None,
                  None
                )
              ),
            mappings = None
          )
        } yield Ok(Json.toJson(zarrLayer))
      }
    }
}
