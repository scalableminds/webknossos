package com.scalableminds.webknossos.tracingstore.controllers

import com.google.inject.Inject
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.mvc.ExtendedController
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.dataformats.layers.ZarrSegmentationLayer
import com.scalableminds.webknossos.datastore.dataformats.zarr.{Zarr3OutputHelper, ZarrCoordinatesParser}
import com.scalableminds.webknossos.datastore.datareaders.zarr.{
  NgffGroupHeader,
  NgffMetadata,
  NgffMetadataV0_5,
  ZarrHeader
}
import com.scalableminds.webknossos.datastore.datareaders.zarr3.{
  BytesCodecConfiguration,
  ChunkGridConfiguration,
  ChunkGridSpecification,
  ChunkKeyEncoding,
  ChunkKeyEncodingConfiguration,
  TransposeCodecConfiguration,
  TransposeSetting,
  Zarr3ArrayHeader,
  Zarr3GroupHeader
}
import com.scalableminds.webknossos.datastore.datareaders.{ArrayOrder, AxisOrder}
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.datastore.models.{AdditionalCoordinate, WebknossosDataRequest}
import com.scalableminds.webknossos.datastore.models.datasource.{AdditionalAxis, DataFormat, DataLayer, ElementClass}
import com.scalableminds.webknossos.datastore.services.UserAccessRequest
import com.scalableminds.webknossos.tracingstore.annotation.TSAnnotationService
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
    annotationService: TSAnnotationService,
    remoteDataStoreClient: TSRemoteDatastoreClient,
    remoteWebknossosClient: TSRemoteWebknossosClient)(implicit ec: ExecutionContext)
    extends ExtendedController
    with ProtoGeometryImplicits
    with FoxImplicits
    with Zarr3OutputHelper {

  override def defaultErrorCode: Int = NOT_FOUND

  def volumeTracingDirectoryContent(tracingId: String, zarrVersion: Int): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
        for {
          annotationId <- remoteWebknossosClient.getAnnotationIdForTracing(tracingId)
          tracing <- annotationService.findVolume(annotationId, tracingId) ?~> Messages("tracing.notFound") ~> NOT_FOUND
          existingMags = tracing.mags.map(vec3IntFromProto)
          additionalFiles = if (zarrVersion == 2)
            List(NgffMetadata.FILENAME_DOT_ZATTRS, NgffGroupHeader.FILENAME_DOT_ZGROUP)
          else List(Zarr3ArrayHeader.FILENAME_ZARR_JSON)
        } yield
          Ok(
            views.html.datastoreZarrDatasourceDir(
              "Tracingstore",
              "%s".format(tracingId),
              additionalFiles ++ existingMags.map(_.toMagLiteral(allowScalar = true))
            )).withHeaders()
      }
    }

  def volumeTracingDirectoryContentJson(tracingId: String, zarrVersion: Int): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
        for {
          annotationId <- remoteWebknossosClient.getAnnotationIdForTracing(tracingId)
          tracing <- annotationService.findVolume(annotationId, tracingId) ?~> Messages("tracing.notFound") ~> NOT_FOUND
          existingMags = tracing.mags.map(vec3IntFromProto(_).toMagLiteral(allowScalar = true))
          additionalFiles = if (zarrVersion == 2)
            List(NgffMetadata.FILENAME_DOT_ZATTRS, NgffGroupHeader.FILENAME_DOT_ZGROUP)
          else List(Zarr3ArrayHeader.FILENAME_ZARR_JSON)
        } yield Ok(Json.toJson(additionalFiles ++ existingMags))
      }
    }

  def volumeTracingMagDirectoryContent(tracingId: String, mag: String, zarrVersion: Int): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
        for {
          annotationId <- remoteWebknossosClient.getAnnotationIdForTracing(tracingId)
          tracing <- annotationService.findVolume(annotationId, tracingId) ?~> Messages("tracing.notFound") ~> NOT_FOUND
          existingMags = tracing.mags.map(vec3IntFromProto)
          magParsed <- Vec3Int.fromMagLiteral(mag, allowScalar = true) ?~> Messages("dataLayer.invalidMag", mag) ~> NOT_FOUND
          _ <- bool2Fox(existingMags.contains(magParsed)) ?~> Messages("tracing.wrongMag", tracingId, mag) ~> NOT_FOUND
          files = if (zarrVersion == 2) List(".zarray") else List(Zarr3ArrayHeader.FILENAME_ZARR_JSON)
        } yield
          Ok(
            views.html.datastoreZarrDatasourceDir(
              "Tracingstore",
              "%s".format(tracingId),
              files
            )).withHeaders()
      }
    }

  def volumeTracingMagDirectoryContentJson(tracingId: String, mag: String, zarrVersion: Int): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
        for {
          annotationId <- remoteWebknossosClient.getAnnotationIdForTracing(tracingId)
          tracing <- annotationService.findVolume(annotationId, tracingId) ?~> Messages("tracing.notFound") ~> NOT_FOUND
          existingMags = tracing.mags.map(vec3IntFromProto)
          magParsed <- Vec3Int.fromMagLiteral(mag, allowScalar = true) ?~> Messages("dataLayer.invalidMag", mag) ~> NOT_FOUND
          _ <- bool2Fox(existingMags.contains(magParsed)) ?~> Messages("tracing.wrongMag", tracingId, mag) ~> NOT_FOUND
          files = if (zarrVersion == 2) List(".zarray") else List(Zarr3ArrayHeader.FILENAME_ZARR_JSON)
        } yield Ok(Json.toJson(files))
      }
    }

  def zArray(tracingId: String, mag: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
        for {
          annotationId <- remoteWebknossosClient.getAnnotationIdForTracing(tracingId)
          tracing <- annotationService.findVolume(annotationId, tracingId) ?~> Messages("tracing.notFound") ~> NOT_FOUND
          existingMags = tracing.mags.map(vec3IntFromProto)
          magParsed <- Vec3Int.fromMagLiteral(mag, allowScalar = true) ?~> Messages("dataLayer.invalidMag", mag) ~> NOT_FOUND
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

  def zarrJsonForMag(tracingId: String, mag: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
        for {
          annotationId <- remoteWebknossosClient.getAnnotationIdForTracing(tracingId)
          tracing <- annotationService.findVolume(annotationId, tracingId) ?~> Messages("tracing.notFound") ~> NOT_FOUND

          existingMags = tracing.mags.map(vec3IntFromProto)
          magParsed <- Vec3Int.fromMagLiteral(mag, allowScalar = true) ?~> Messages("dataLayer.invalidMag", mag) ~> NOT_FOUND
          _ <- bool2Fox(existingMags.contains(magParsed)) ?~> Messages("tracing.wrongMag", tracingId, mag) ~> NOT_FOUND

          additionalAxes = AdditionalAxis.fromProtos(tracing.additionalAxes)
          dimNames = Some(Array("c") ++ additionalAxes.map(_.name).toArray ++ Seq("x", "y", "z"))

          zarrHeader = Zarr3ArrayHeader(
            zarr_format = 3,
            node_type = "array",
            // channel, additional axes, XYZ
            shape = Array(1) ++ additionalAxes.map(_.highestValue).toArray ++ Array(
              (tracing.boundingBox.width + tracing.boundingBox.topLeft.x) / magParsed.x,
              (tracing.boundingBox.height + tracing.boundingBox.topLeft.y) / magParsed.y,
              (tracing.boundingBox.depth + tracing.boundingBox.topLeft.z) / magParsed.z
            ),
            data_type = Left(tracing.elementClass.toString),
            chunk_grid = Left(
              ChunkGridSpecification(
                "regular",
                ChunkGridConfiguration(
                  chunk_shape = Array.fill(1 + additionalAxes.length)(1) ++ Array(DataLayer.bucketLength,
                                                                                  DataLayer.bucketLength,
                                                                                  DataLayer.bucketLength))
              )),
            chunk_key_encoding =
              ChunkKeyEncoding("v2", configuration = Some(ChunkKeyEncodingConfiguration(separator = Some(".")))),
            fill_value = Right(0),
            attributes = None,
            codecs = Seq(
              TransposeCodecConfiguration(TransposeSetting.fOrderFromRank(additionalAxes.length + 4)),
              BytesCodecConfiguration(Some("little")),
            ),
            storage_transformers = None,
            dimension_names = dimNames
          )
        } yield Ok(Json.toJson(zarrHeader))
      }
    }

  def zGroup(tracingId: String): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
      Future(Ok(Json.toJson(NgffGroupHeader(zarr_format = 2))))
    }
  }

  /**
    * Handles a request for .zattrs file for a Volume Tracing via a HTTP GET.
    * Uses the OME-NGFF standard (see https://ngff.openmicroscopy.org/latest/)
    * Used by zarr-streaming.
    */
  def zAttrs(
      tracingId: String,
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
      for {
        annotationId <- remoteWebknossosClient.getAnnotationIdForTracing(tracingId)
        tracing <- annotationService.findVolume(annotationId, tracingId) ?~> Messages("tracing.notFound") ~> NOT_FOUND
        existingMags = tracing.mags.map(vec3IntFromProto)
        dataSource <- remoteWebknossosClient.getDataSourceForAnnotation(annotationId) ~> NOT_FOUND
        omeNgffHeader = NgffMetadata.fromNameVoxelSizeAndMags(tracingId,
                                                              dataSourceVoxelSize = dataSource.scale,
                                                              mags = existingMags.toList)
      } yield Ok(Json.toJson(omeNgffHeader))
    }
  }

  def zarrJson(
      tracingId: String,
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
      for {
        annotationId <- remoteWebknossosClient.getAnnotationIdForTracing(tracingId)
        tracing <- annotationService.findVolume(annotationId, tracingId) ?~> Messages("tracing.notFound") ~> NOT_FOUND
        sortedExistingMags = tracing.mags.map(vec3IntFromProto).toList.sortBy(_.maxDim)
        dataSource <- remoteWebknossosClient.getDataSourceForAnnotation(annotationId) ~> NOT_FOUND
        omeNgffHeader = NgffMetadataV0_5.fromNameVoxelSizeAndMags(tracingId,
                                                                  dataSourceVoxelSize = dataSource.scale,
                                                                  mags = sortedExistingMags,
                                                                  additionalAxes = dataSource.additionalAxesUnion)
        zarr3GroupHeader = Zarr3GroupHeader(3, "group", Some(omeNgffHeader))
      } yield Ok(Json.toJson(zarr3GroupHeader))
    }
  }

  def zarrSource(tracingId: String, tracingName: Option[String], zarrVersion: Int): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
        for {
          annotationId <- remoteWebknossosClient.getAnnotationIdForTracing(tracingId)
          tracing <- annotationService.findVolume(annotationId, tracingId) ?~> Messages("tracing.notFound") ~> NOT_FOUND
          zarrLayer = ZarrSegmentationLayer(
            name = tracingName.getOrElse(tracingId),
            largestSegmentId = tracing.largestSegmentId,
            boundingBox = tracing.boundingBox,
            elementClass = tracing.elementClass,
            mags = tracing.mags.toList.map(x => MagLocator(x, None, None, Some(AxisOrder.cxyz), None, None)),
            mappings = None,
            numChannels = Some(if (tracing.elementClass.isuint24) 3 else 1),
            dataFormat = if (zarrVersion == 2) DataFormat.zarr else DataFormat.zarr3
          )
        } yield Ok(Json.toJson(zarrLayer))
      }
    }

  def rawZarrCube(tracingId: String, mag: String, coordinates: String): Action[AnyContent] =
    Action.async { implicit request =>
      {
        accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
          for {
            annotationId <- remoteWebknossosClient.getAnnotationIdForTracing(tracingId)
            tracing <- annotationService.findVolume(annotationId, tracingId) ?~> Messages("tracing.notFound") ~> NOT_FOUND

            existingMags = tracing.mags.map(vec3IntFromProto)
            magParsed <- Vec3Int.fromMagLiteral(mag, allowScalar = true) ?~> Messages("dataLayer.invalidMag", mag) ~> NOT_FOUND
            _ <- bool2Fox(existingMags.contains(magParsed)) ?~> Messages("tracing.wrongMag", tracingId, mag) ~> NOT_FOUND

            reorderedAdditionalAxes = reorderAdditionalAxes(AdditionalAxis.fromProtos(tracing.additionalAxes))
            (x, y, z, additionalCoordinates) <- ZarrCoordinatesParser.parseNDimensionalDotCoordinates(
              coordinates,
              Some(reorderedAdditionalAxes)) ?~> Messages("zarr.invalidChunkCoordinates") ~> NOT_FOUND
            cubeSize = DataLayer.bucketLength
            wkRequest = WebknossosDataRequest(
              position = Vec3Int(x, y, z) * cubeSize * magParsed,
              mag = magParsed,
              cubeSize = cubeSize,
              fourBit = Some(false),
              applyAgglomerate = None,
              version = None,
              additionalCoordinates = additionalCoordinates
            )
            (data, missingBucketIndices) <- if (tracing.getHasEditableMapping) {
              val mappingLayer = annotationService.editableMappingLayer(annotationId, tracingId, tracing)
              editableMappingService.volumeData(mappingLayer, List(wkRequest))
            } else tracingService.data(annotationId, tracingId, tracing, List(wkRequest))
            dataWithFallback <- getFallbackLayerDataIfEmpty(tracing,
                                                            annotationId,
                                                            data,
                                                            missingBucketIndices,
                                                            magParsed,
                                                            Vec3Int(x, y, z),
                                                            cubeSize,
                                                            additionalCoordinates) ~> NOT_FOUND
          } yield Ok(dataWithFallback)
        }
      }
    }

  private def getFallbackLayerDataIfEmpty(
      tracing: VolumeTracing,
      annotationId: String,
      data: Array[Byte],
      missingBucketIndices: List[Int],
      mag: Vec3Int,
      position: Vec3Int,
      cubeSize: Int,
      additionalCoordinates: Option[Seq[AdditionalCoordinate]])(implicit tc: TokenContext): Fox[Array[Byte]] =
    if (missingBucketIndices.nonEmpty) {
      for {
        remoteFallbackLayer <- tracingService.remoteFallbackLayerFromVolumeTracing(tracing, annotationId) ?~> "No data at coordinates, no fallback layer defined"
        request = WebknossosDataRequest(
          position = position * mag * cubeSize,
          mag = mag,
          cubeSize = cubeSize,
          fourBit = Some(false),
          applyAgglomerate = tracing.mappingName,
          version = None,
          additionalCoordinates = additionalCoordinates
        )
        (fallbackData, fallbackMissingBucketIndices) <- remoteDataStoreClient.getData(remoteFallbackLayer,
                                                                                      List(request))
        _ <- bool2Fox(fallbackMissingBucketIndices.isEmpty) ?~> "No data at coordinations in fallback layer"
      } yield fallbackData
    } else Fox.successful(data)
}
