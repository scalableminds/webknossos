package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.dataformats.BucketProvider
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.datastore.models.{BucketPosition, WebKnossosDataRequest}
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource.{
  CoordinateTransformation,
  DataFormat,
  DataLayer,
  ElementClass,
  SegmentationLayer
}
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import com.scalableminds.webknossos.datastore.storage.{DataCubeCache, DataVaultService}

import scala.concurrent.ExecutionContext

class EditableMappingBucketProvider(layer: EditableMappingLayer) extends BucketProvider with ProtoGeometryImplicits {

  override def dataVaultServiceOpt: Option[DataVaultService] = None

  override def load(readInstruction: DataReadInstruction, cache: DataCubeCache)(
      implicit ec: ExecutionContext): Fox[Array[Byte]] = {
    val bucket: BucketPosition = readInstruction.bucket
    for {
      editableMappingId <- Fox.successful(layer.name)
      i1 = Instant.now
      _ <- bool2Fox(layer.doesContainBucket(bucket))
      remoteFallbackLayer <- layer.editableMappingService
        .remoteFallbackLayerFromVolumeTracing(layer.tracing, layer.tracingId)
      (editableMapping, editableMappingVersion) <- layer.editableMappingService.getInfoAndActualVersion(
        editableMappingId,
        requestedVersion = None,
        remoteFallbackLayer = remoteFallbackLayer,
        userToken = layer.token)
      dataRequest: WebKnossosDataRequest = WebKnossosDataRequest(
        position = Vec3Int(bucket.topLeft.mag1X, bucket.topLeft.mag1Y, bucket.topLeft.mag1Z),
        mag = bucket.mag,
        cubeSize = layer.lengthOfUnderlyingCubes(bucket.mag),
        fourBit = None,
        applyAgglomerate = None,
        version = None
      )
      i2 = Instant.now
      (unmappedData, indices) <- layer.editableMappingService.getFallbackDataFromDatastore(remoteFallbackLayer,
                                                                                           List(dataRequest),
                                                                                           layer.token)
      _ <- bool2Fox(indices.isEmpty)
      i3 = Instant.now
      _ = logger.info(s"get fallback data took ${i3 - i2}")
      unmappedDataTyped <- layer.editableMappingService.bytesToUnsignedInt(unmappedData, layer.tracing.elementClass)
      i4 = Instant.now
      segmentIds = layer.editableMappingService.collectSegmentIds(unmappedDataTyped)
      i5 = Instant.now
      _ = logger.info(s"collectSegmentIds took ${i5 - i4}")
      relevantMapping <- layer.editableMappingService.generateCombinedMappingSubset(segmentIds,
                                                                                    editableMapping,
                                                                                    editableMappingVersion,
                                                                                    editableMappingId,
                                                                                    remoteFallbackLayer,
                                                                                    layer.token)
      i6 = Instant.now
      _ = logger.info(s"generateCombinedMappingSubset took ${i6 - i5}")
      mappedData: Array[Byte] <- layer.editableMappingService.mapData(unmappedDataTyped,
                                                                      relevantMapping,
                                                                      layer.elementClass)
      i7 = Instant.now
      _ = logger.info(s"bucket loading total took ${i7 - i1}")
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
  override def dataFormat: DataFormat.Value = DataFormat.wkw

  override def coordinateTransformations: Option[List[CoordinateTransformation]] = None

  override def lengthOfUnderlyingCubes(resolution: Vec3Int): Int = DataLayer.bucketLength

  override def bucketProvider(dataVaultServiceOpt: Option[DataVaultService]): BucketProvider =
    new EditableMappingBucketProvider(layer = this)

  override def mappings: Option[Set[String]] = None

  override def defaultViewConfiguration: Option[LayerViewConfiguration] = None

  override def adminViewConfiguration: Option[LayerViewConfiguration] = None
}
