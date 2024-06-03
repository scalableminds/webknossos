package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.bool2Fox
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.dataformats.{BucketProvider, MagLocator}
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.datastore.models.{BucketPosition, WebknossosDataRequest}
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource.{
  AdditionalAxis,
  CoordinateTransformation,
  DataFormat,
  DataLayer,
  DataSourceId,
  ElementClass,
  SegmentationLayer
}
import ucar.ma2.{Array => MultiArray}
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import com.scalableminds.webknossos.datastore.storage.RemoteSourceDescriptorService

import scala.concurrent.ExecutionContext

class EditableMappingBucketProvider(layer: EditableMappingLayer) extends BucketProvider with ProtoGeometryImplicits {

  override def load(readInstruction: DataReadInstruction)(implicit ec: ExecutionContext): Fox[Array[Byte]] = {
    val bucket: BucketPosition = readInstruction.bucket
    for {
      editableMappingId <- Fox.successful(layer.name)
      _ <- bool2Fox(layer.doesContainBucket(bucket))
      remoteFallbackLayer <- layer.editableMappingService
        .remoteFallbackLayerFromVolumeTracing(layer.tracing, layer.tracingId)
      // called here to ensure updates are applied
      (editableMappingInfo, editableMappingVersion) <- layer.editableMappingService.getInfoAndActualVersion(
        editableMappingId,
        requestedVersion = None,
        remoteFallbackLayer = remoteFallbackLayer,
        userToken = layer.token)
      dataRequest: WebknossosDataRequest = WebknossosDataRequest(
        position = Vec3Int(bucket.topLeft.mag1X, bucket.topLeft.mag1Y, bucket.topLeft.mag1Z),
        mag = bucket.mag,
        cubeSize = layer.lengthOfUnderlyingCubes(bucket.mag),
        fourBit = None,
        applyAgglomerate = None,
        version = None,
        additionalCoordinates = readInstruction.bucket.additionalCoordinates
      )
      (unmappedData, indices) <- layer.editableMappingService.getFallbackDataFromDatastore(remoteFallbackLayer,
                                                                                           List(dataRequest),
                                                                                           layer.token)
      _ <- bool2Fox(indices.isEmpty)
      unmappedDataTyped <- layer.editableMappingService.bytesToUnsignedInt(unmappedData, layer.tracing.elementClass)
      segmentIds = layer.editableMappingService.collectSegmentIds(unmappedDataTyped)
      relevantMapping <- layer.editableMappingService.generateCombinedMappingForSegmentIds(segmentIds,
                                                                                           editableMappingInfo,
                                                                                           editableMappingVersion,
                                                                                           editableMappingId,
                                                                                           remoteFallbackLayer,
                                                                                           layer.token)
      mappedData: Array[Byte] <- layer.editableMappingService.mapData(unmappedDataTyped,
                                                                      relevantMapping,
                                                                      layer.elementClass)
    } yield mappedData
  }
}

case class EditableMappingLayer(name: String,
                                boundingBox: BoundingBox,
                                resolutions: List[Vec3Int],
                                largestSegmentId: Option[Long],
                                elementClass: ElementClass.Value,
                                token: Option[String],
                                tracing: VolumeTracing,
                                tracingId: String,
                                editableMappingService: EditableMappingService)
    extends SegmentationLayer {
  override val mags: List[MagLocator] = List.empty // MagLocators do not apply for annotation layers

  override def dataFormat: DataFormat.Value = DataFormat.wkw

  override def coordinateTransformations: Option[List[CoordinateTransformation]] = None

  override def lengthOfUnderlyingCubes(resolution: Vec3Int): Int = DataLayer.bucketLength

  override def bucketProvider(remoteSourceDescriptorServiceOpt: Option[RemoteSourceDescriptorService],
                              dataSourceId: DataSourceId,
                              sharedChunkContentsCache: Option[AlfuCache[String, MultiArray]]): BucketProvider =
    new EditableMappingBucketProvider(layer = this)

  override def bucketProviderCacheKey: String = s"$name-token=$token"

  override def mappings: Option[Set[String]] = None

  override def defaultViewConfiguration: Option[LayerViewConfiguration] = None

  override def adminViewConfiguration: Option[LayerViewConfiguration] = None

  override def additionalAxes: Option[Seq[AdditionalAxis]] = None
}
