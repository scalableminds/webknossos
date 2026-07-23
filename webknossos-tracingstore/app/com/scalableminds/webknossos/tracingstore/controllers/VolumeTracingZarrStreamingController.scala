package com.scalableminds.webknossos.tracingstore.controllers

import com.google.inject.Inject
import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.mvc.ExtendedController
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.dataformats.zarr.{Zarr3OutputHelper, ZarrCoordinatesParser}
import com.scalableminds.webknossos.datastore.datareaders.zarr.NgffMetadataV0_5
import com.scalableminds.webknossos.datastore.datareaders.zarr3.*
import com.scalableminds.webknossos.datastore.datareaders.AxisOrder
import com.scalableminds.webknossos.datastore.helpers.{ProtoGeometryConversions, UPath}
import com.scalableminds.webknossos.datastore.models.datasource.*
import com.scalableminds.webknossos.datastore.models.{AdditionalCoordinate, WebknossosDataRequest}
import com.scalableminds.webknossos.datastore.services.UserAccessRequest
import com.scalableminds.webknossos.tracingstore.annotation.TSAnnotationService
import com.scalableminds.webknossos.tracingstore.tracings.editablemapping.EditableMappingService
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeTracingService
import com.scalableminds.webknossos.tracingstore.{
  TSRemoteDatastoreClient,
  TSRemoteWebknossosClient,
  TracingStoreAccessTokenService
}
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent}

import java.nio.file.Path
import scala.concurrent.ExecutionContext

class VolumeTracingZarrStreamingController @Inject() (
    tracingService: VolumeTracingService,
    accessTokenService: TracingStoreAccessTokenService,
    editableMappingService: EditableMappingService,
    annotationService: TSAnnotationService,
    remoteDataStoreClient: TSRemoteDatastoreClient,
    remoteWebknossosClient: TSRemoteWebknossosClient
)(implicit ec: ExecutionContext)
    extends ExtendedController
    with ProtoGeometryConversions
    with Zarr3OutputHelper {

  override def defaultErrorCode: Int = NOT_FOUND

  def volumeTracingDirectoryContent(tracingId: String): Action[AnyContent] =
    Action.fox { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
        for {
          annotationId <- remoteWebknossosClient.getAnnotationIdForTracing(tracingId)
          tracing <- annotationService.findVolume(annotationId, tracingId) ?~> Msg.Annotation.notFound ~> NOT_FOUND
          existingMags = tracing.mags.map(vec3IntFromProto)
        } yield Ok(
          views.html.datastoreZarrDatasourceDir(
            "Tracingstore",
            "%s".format(tracingId),
            List(Zarr3ArrayHeader.FILENAME_ZARR_JSON) ++ existingMags.map(_.toMagLiteral(allowScalar = true))
          )
        ).withHeaders()
      }
    }

  def volumeTracingDirectoryContentJson(tracingId: String): Action[AnyContent] =
    Action.fox { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
        for {
          annotationId <- remoteWebknossosClient.getAnnotationIdForTracing(tracingId)
          tracing <- annotationService.findVolume(annotationId, tracingId) ?~> Msg.Annotation.notFound ~> NOT_FOUND
          existingMags = tracing.mags.map(vec3IntFromProto(_).toMagLiteral(allowScalar = true))
        } yield Ok(Json.toJson(List(Zarr3ArrayHeader.FILENAME_ZARR_JSON) ++ existingMags))
      }
    }

  def volumeTracingMagDirectoryContent(tracingId: String, mag: String): Action[AnyContent] =
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
            List(Zarr3ArrayHeader.FILENAME_ZARR_JSON)
          )
        ).withHeaders()
      }
    }

  def volumeTracingMagDirectoryContentJson(tracingId: String, mag: String): Action[AnyContent] =
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
        } yield Ok(Json.toJson(List(Zarr3ArrayHeader.FILENAME_ZARR_JSON)))
      }
    }

  def zarrJsonForMag(tracingId: String, mag: String): Action[AnyContent] =
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

          additionalAxes = AdditionalAxis.fromProtos(tracing.additionalAxes)
          dimNames = Some(Array("c") ++ additionalAxes.map(_.name).toArray ++ Seq("x", "y", "z"))

          zarrHeader = Zarr3ArrayHeader(
            zarr_format = 3,
            node_type = "array",
            // channel, additional axes, XYZ
            shape = (Array(1) ++ additionalAxes.map(_.highestValue).toArray ++ Array(
              (tracing.boundingBox.width + tracing.boundingBox.topLeft.x) / magParsed.x,
              (tracing.boundingBox.height + tracing.boundingBox.topLeft.y) / magParsed.y,
              (tracing.boundingBox.depth + tracing.boundingBox.topLeft.z) / magParsed.z
            )).map(_.toLong),
            data_type = Left(tracing.elementClass.toString),
            chunk_grid = Left(
              ChunkGridSpecification(
                "regular",
                ChunkGridConfiguration(
                  chunk_shape = Array.fill(1 + additionalAxes.length)(1) ++ Array(
                    DataLayer.bucketLength,
                    DataLayer.bucketLength,
                    DataLayer.bucketLength
                  )
                )
              )
            ),
            chunk_key_encoding =
              ChunkKeyEncoding("v2", configuration = Some(ChunkKeyEncodingConfiguration(separator = Some(".")))),
            fill_value = Right(0),
            attributes = None,
            codecs = Seq(
              TransposeCodecConfiguration(TransposeSetting.fOrderFromRank(additionalAxes.length + 4)),
              BytesCodecConfiguration(Some("little"))
            ),
            storage_transformers = None,
            dimension_names = dimNames
          )
        } yield Ok(Json.toJson(zarrHeader))
      }
    }

  def zarrJson(
      tracingId: String
  ): Action[AnyContent] = Action.fox { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
      for {
        annotationId <- remoteWebknossosClient.getAnnotationIdForTracing(tracingId)
        tracing <- annotationService.findVolume(annotationId, tracingId) ?~> Msg.Annotation.notFound ~> NOT_FOUND
        sortedExistingMags = tracing.mags.map(vec3IntFromProto).toList.sortBy(_.maxDim)
        dataSource <- remoteWebknossosClient.getDataSourceForAnnotation(annotationId) ~> NOT_FOUND
        omeNgffHeader = NgffMetadataV0_5.fromNameVoxelSizeAndMags(
          tracingId,
          dataSourceVoxelSize = dataSource.scale,
          mags = sortedExistingMags,
          additionalAxes = dataSource.additionalAxesUnion
        )
        zarr3GroupHeader = NgffZarr3GroupHeader(3, "group", omeNgffHeader)
      } yield Ok(Json.toJson(zarr3GroupHeader))
    }
  }

  def zarrSource(tracingId: String, tracingName: Option[String]): Action[AnyContent] =
    Action.fox { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
        for {
          annotationId <- remoteWebknossosClient.getAnnotationIdForTracing(tracingId)
          tracing <- annotationService.findVolume(annotationId, tracingId) ?~> Msg.Annotation.notFound ~> NOT_FOUND
          layerName = tracingName.getOrElse(tracingId)
          zarrLayer = StaticSegmentationLayer(
            name = layerName,
            dataFormat = DataFormat.zarr3,
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

  def rawZarrCube(tracingId: String, mag: String, coordinates: String): Action[AnyContent] =
    Action.fox { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readTracing(tracingId)) {
        for {
          annotationId <- remoteWebknossosClient.getAnnotationIdForTracing(tracingId)
          tracing <- annotationService.findVolume(annotationId, tracingId) ?~> Msg.Annotation.notFound ~> BAD_REQUEST
          existingMags = tracing.mags.map(vec3IntFromProto)
          // Failures in parsing coordinates or mag need to still be NOT_FOUND, not BAD_REQUEST because neuroglancer tries to access :layer_name/:mag/.zattrs
          magParsed <- Vec3Int.fromMagLiteral(mag, allowScalar = true).toFox ?~> Msg.Dataset.Mag
            .invalid(mag) ~> NOT_FOUND
          _ <- Fox
            .fromBool(existingMags.contains(magParsed)) ?~> Msg.Annotation.Volume.wrongMag(tracingId, mag) ~> NOT_FOUND
          reorderedAdditionalAxes = reorderAdditionalAxes(AdditionalAxis.fromProtos(tracing.additionalAxes))
          (x, y, z, additionalCoordinates) <- ZarrCoordinatesParser.parseNDimensionalDotCoordinates(
            coordinates,
            Some(reorderedAdditionalAxes)
          ) ?~> Msg.Zarr.invalidChunkCoordinates(coordinates) ~> NOT_FOUND
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
          (data, emptyIndices, failureIndices) <-
            if (tracing.getHasEditableMapping) {
              val mappingLayer = annotationService.editableMappingLayer(annotationId, tracingId, tracing)
              editableMappingService.volumeData(mappingLayer, List(wkRequest))
            } else tracingService.data(annotationId, tracingId, tracing, List(wkRequest))
          _ <- Fox.fromBool(failureIndices.isEmpty) ?~> Msg.Zarr.chunkLoadingError ~> INTERNAL_SERVER_ERROR
          dataWithFallback <- getFallbackLayerDataIfEmpty(
            tracing,
            annotationId,
            data,
            emptyIndices,
            magParsed,
            Vec3Int(x, y, z),
            cubeSize,
            additionalCoordinates
          )
        } yield Ok(dataWithFallback)
      }
    }

  /** zarr3_experimental is deprecated: /volume/zarr now defaults to Zarr v3. Redirect old URLs to their new
    * home, preserving the query string.
    */
  def redirectZarr3(tracingId: String, rest: String): Action[AnyContent] = Action { implicit request =>
    val suffix = if (rest.isEmpty) "" else s"/$rest"
    Redirect(s"/volume/zarr/$tracingId$suffix", request.queryString, MOVED_PERMANENTLY)
  }

  private def getFallbackLayerDataIfEmpty(
      tracing: VolumeTracing,
      annotationId: ObjectId,
      data: Array[Byte],
      emptyBucketIndices: Seq[Int],
      mag: Vec3Int,
      position: Vec3Int,
      cubeSize: Int,
      additionalCoordinates: Option[Seq[AdditionalCoordinate]]
  )(using tc: TokenContext): Fox[Array[Byte]] =
    if (emptyBucketIndices.nonEmpty) {
      for {
        remoteFallbackLayer <- tracingService.remoteFallbackLayerForVolumeTracing(
          tracing,
          annotationId
        ) ?~> "No data at coordinates, no fallback layer defined"
        request = WebknossosDataRequest(
          position = position * mag * cubeSize,
          mag = mag,
          cubeSize = cubeSize,
          fourBit = Some(false),
          applyAgglomerate = tracing.mappingName,
          version = None,
          additionalCoordinates = additionalCoordinates
        )
        (fallbackData, fallbackEmptyBucketIndices, fallbackFailureBucketIndices) <- remoteDataStoreClient.getData(
          remoteFallbackLayer,
          List(request)
        ) ~> SERVICE_UNAVAILABLE // return 503 if the request fails, assuming the datastore is still initializing
        // We only expect missing buckets if something went wrong with loading the fallback layer, e.g. applying the agglomerate. Otherwise, a fill value is used and returned to us.
        _ <- Fox.fromBool(
          fallbackEmptyBucketIndices.isEmpty && fallbackFailureBucketIndices.isEmpty
        ) ?~> Msg.Annotation.Volume.fallbackDataLoadingFailed ~> INTERNAL_SERVER_ERROR
      } yield fallbackData
    } else Fox.successful(data)
}
