package com.scalableminds.webknossos.tracingstore.controllers

import com.google.inject.Inject
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.mvc.ExtendedController
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.dataformats.layers.ZarrSegmentationLayer
import com.scalableminds.webknossos.datastore.dataformats.zarr.ZarrCoordinatesParser
import com.scalableminds.webknossos.datastore.datareaders.zarr.{NgffGroupHeader, NgffMetadata, ZarrHeader}
import com.scalableminds.webknossos.datastore.datareaders.{ArrayOrder, AxisOrder}
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.datastore.models.WebknossosDataRequest
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, ElementClass}
import com.scalableminds.webknossos.datastore.services.UserAccessRequest
import com.scalableminds.webknossos.tracingstore.tracings.editablemapping.EditableMappingService
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeTracingService
import com.scalableminds.webknossos.tracingstore.{
  TSRemoteDatastoreClient,
  TSRemoteWebknossosClient,
  TracingStoreAccessTokenService
}
import play.api.i18n.Messages
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent}

import scala.concurrent.{ExecutionContext, Future}

class VolumeTracingZarrStreamingController @Inject()(
    tracingService: VolumeTracingService,
    accessTokenService: TracingStoreAccessTokenService,
    editableMappingService: EditableMappingService,
    remoteDataStoreClient: TSRemoteDatastoreClient,
    remoteWebknossosClient: TSRemoteWebknossosClient)(implicit ec: ExecutionContext)
    extends ExtendedController
    with ProtoGeometryImplicits
    with FoxImplicits {

  override def defaultErrorCode: Int = NOT_FOUND

  def volumeTracingFolderContent(token: Option[String], tracingId: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), urlOrHeaderToken(token, request)) {
        for {
          tracing <- tracingService.find(tracingId) ?~> Messages("tracing.notFound") ~> NOT_FOUND
          existingMags = tracing.resolutions.map(vec3IntFromProto)
        } yield
          Ok(
            views.html.datastoreZarrDatasourceDir(
              "Tracingstore",
              "%s".format(tracingId),
              List(".zattrs", ".zgroup") ++ existingMags.map(_.toMagLiteral(allowScalar = true))
            )).withHeaders()
      }
    }

  def volumeTracingFolderContentJson(token: Option[String], tracingId: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), urlOrHeaderToken(token, request)) {
        for {
          tracing <- tracingService.find(tracingId) ?~> Messages("tracing.notFound") ~> NOT_FOUND
          existingMags = tracing.resolutions.map(vec3IntFromProto(_).toMagLiteral(allowScalar = true))
        } yield Ok(Json.toJson(List(".zattrs", ".zgroup") ++ existingMags))
      }
    }

  def volumeTracingMagFolderContent(token: Option[String], tracingId: String, mag: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), urlOrHeaderToken(token, request)) {
        for {
          tracing <- tracingService.find(tracingId) ?~> Messages("tracing.notFound") ~> NOT_FOUND

          existingMags = tracing.resolutions.map(vec3IntFromProto)
          magParsed <- Vec3Int.fromMagLiteral(mag, allowScalar = true) ?~> Messages("dataLayer.invalidMag", mag) ~> NOT_FOUND
          _ <- bool2Fox(existingMags.contains(magParsed)) ?~> Messages("tracing.wrongMag", tracingId, mag) ~> NOT_FOUND
        } yield
          Ok(
            views.html.datastoreZarrDatasourceDir(
              "Tracingstore",
              "%s".format(tracingId),
              List(".zarray")
            )).withHeaders()
      }
    }

  def volumeTracingMagFolderContentJson(token: Option[String], tracingId: String, mag: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), urlOrHeaderToken(token, request)) {
        for {
          tracing <- tracingService.find(tracingId) ?~> Messages("tracing.notFound") ~> NOT_FOUND

          existingMags = tracing.resolutions.map(vec3IntFromProto)
          magParsed <- Vec3Int.fromMagLiteral(mag, allowScalar = true) ?~> Messages("dataLayer.invalidMag", mag) ~> NOT_FOUND
          _ <- bool2Fox(existingMags.contains(magParsed)) ?~> Messages("tracing.wrongMag", tracingId, mag) ~> NOT_FOUND
        } yield Ok(Json.toJson(List(".zarray")))
      }
    }

  def zArray(token: Option[String], tracingId: String, mag: String): Action[AnyContent] = Action.async {
    implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), urlOrHeaderToken(token, request)) {
        for {
          tracing <- tracingService.find(tracingId) ?~> Messages("tracing.notFound") ~> NOT_FOUND

          existingMags = tracing.resolutions.map(vec3IntFromProto)
          magParsed <- Vec3Int
            .fromMagLiteral(mag, allowScalar = true) ?~> Messages("dataLayer.invalidMag", mag) ~> NOT_FOUND
          _ <- bool2Fox(existingMags.contains(magParsed)) ?~> Messages("tracing.wrongMag", tracingId, mag) ~> NOT_FOUND

          cubeLength = DataLayer.bucketLength
          (channels, dtype) = ElementClass.toChannelAndZarrString(tracing.elementClass)
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

          zarrHeader = ZarrHeader(zarr_format = 2,
                                  shape = shape,
                                  chunks = chunks,
                                  compressor = compressor,
                                  dtype = dtype,
                                  order = ArrayOrder.F)
        } yield Ok(Json.toJson(zarrHeader))
      }
  }

  def zGroup(token: Option[String], tracingId: String): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), urlOrHeaderToken(token, request)) {
      Future(Ok(Json.toJson(NgffGroupHeader(zarr_format = 2))))
    }
  }

  /**
    * Handles a request for .zattrs file for a Volume Tracing via a HTTP GET.
    * Uses the OME-NGFF standard (see https://ngff.openmicroscopy.org/latest/)
    * Used by zarr-streaming.
    */
  def zAttrs(
      token: Option[String],
      tracingId: String,
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), urlOrHeaderToken(token, request)) {
      for {
        tracing <- tracingService.find(tracingId) ?~> Messages("tracing.notFound") ~> NOT_FOUND

        existingMags = tracing.resolutions.map(vec3IntFromProto)
        dataSource <- remoteWebknossosClient.getDataSourceForTracing(tracingId) ~> NOT_FOUND
        omeNgffHeader = NgffMetadata.fromNameVoxelSizeAndMags(tracingId,
                                                              dataSourceVoxelSize = dataSource.scale,
                                                              mags = existingMags.toList)
      } yield Ok(Json.toJson(omeNgffHeader))
    }
  }

  def zarrSource(token: Option[String], tracingId: String, tracingName: Option[String]): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), urlOrHeaderToken(token, request)) {
        for {
          tracing <- tracingService.find(tracingId) ?~> Messages("tracing.notFound") ~> NOT_FOUND

          zarrLayer = ZarrSegmentationLayer(
            name = tracingName.getOrElse(tracingId),
            largestSegmentId = tracing.largestSegmentId,
            boundingBox = tracing.boundingBox,
            elementClass = tracing.elementClass,
            mags = tracing.resolutions.toList.map(x => MagLocator(x, None, None, Some(AxisOrder.cxyz), None, None)),
            mappings = None,
            numChannels = Some(if (tracing.elementClass.isuint24) 3 else 1)
          )
        } yield Ok(Json.toJson(zarrLayer))
      }
    }

  def rawZarrCube(token: Option[String], tracingId: String, mag: String, cxyz: String): Action[AnyContent] =
    Action.async { implicit request =>
      {
        accessTokenService.validateAccess(UserAccessRequest.readTracing(tracingId), urlOrHeaderToken(token, request)) {
          for {
            tracing <- tracingService.find(tracingId) ?~> Messages("tracing.notFound") ~> NOT_FOUND

            existingMags = tracing.resolutions.map(vec3IntFromProto)
            magParsed <- Vec3Int.fromMagLiteral(mag, allowScalar = true) ?~> Messages("dataLayer.invalidMag", mag) ~> NOT_FOUND
            _ <- bool2Fox(existingMags.contains(magParsed)) ?~> Messages("tracing.wrongMag", tracingId, mag) ~> NOT_FOUND

            (c, x, y, z) <- ZarrCoordinatesParser.parseDotCoordinates(cxyz) ?~> Messages("zarr.invalidChunkCoordinates") ~> NOT_FOUND
            _ <- bool2Fox(c == 0) ~> Messages("zarr.invalidFirstChunkCoord") ~> NOT_FOUND
            cubeSize = DataLayer.bucketLength
            wkRequest = WebknossosDataRequest(
              position = Vec3Int(x, y, z) * cubeSize * magParsed,
              mag = magParsed,
              cubeSize = cubeSize,
              fourBit = Some(false),
              applyAgglomerate = None,
              version = None,
              additionalCoordinates = None
            )
            (data, missingBucketIndices) <- if (tracing.getMappingIsEditable)
              editableMappingService.volumeData(tracing, tracingId, List(wkRequest), urlOrHeaderToken(token, request))
            else tracingService.data(tracingId, tracing, List(wkRequest))
            dataWithFallback <- getFallbackLayerDataIfEmpty(tracing,
                                                            tracingId,
                                                            data,
                                                            missingBucketIndices,
                                                            magParsed,
                                                            Vec3Int(x, y, z),
                                                            cubeSize,
                                                            urlOrHeaderToken(token, request)) ~> NOT_FOUND
          } yield Ok(dataWithFallback)
        }
      }
    }

  private def getFallbackLayerDataIfEmpty(tracing: VolumeTracing,
                                          tracingId: String,
                                          data: Array[Byte],
                                          missingBucketIndices: List[Int],
                                          mag: Vec3Int,
                                          position: Vec3Int,
                                          cubeSize: Int,
                                          urlToken: Option[String]): Fox[Array[Byte]] =
    if (missingBucketIndices.nonEmpty) {
      for {
        remoteFallbackLayer <- tracingService.remoteFallbackLayerFromVolumeTracing(tracing, tracingId) ?~> "No data at coordinates, no fallback layer defined"
        request = WebknossosDataRequest(
          position = position * mag * cubeSize,
          mag = mag,
          cubeSize = cubeSize,
          fourBit = Some(false),
          applyAgglomerate = tracing.mappingName,
          version = None,
          additionalCoordinates = None
        )
        (fallbackData, fallbackMissingBucketIndices) <- remoteDataStoreClient.getData(remoteFallbackLayer,
                                                                                      List(request),
                                                                                      urlToken)
        _ <- bool2Fox(fallbackMissingBucketIndices.isEmpty) ?~> "No data at coordinations in fallback layer"
      } yield fallbackData
    } else Fox.successful(data)
}
