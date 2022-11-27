package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.dataformats.BucketProvider
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.datastore.models.{BucketPosition, WebKnossosDataRequest}
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource.{DataFormat, DataLayer, ElementClass, SegmentationLayer}
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import com.scalableminds.webknossos.datastore.storage.{DataCubeCache, FileSystemService}

import scala.concurrent.ExecutionContext

class EditableMappingBucketProvider(layer: EditableMappingLayer) extends BucketProvider with ProtoGeometryImplicits {

  override def fileSystemServiceOpt: Option[FileSystemService] = None

  override def load(readInstruction: DataReadInstruction, cache: DataCubeCache)(
      implicit ec: ExecutionContext): Fox[Array[Byte]] = {
    val bucket: BucketPosition = readInstruction.bucket
    for {
      editableMappingId <- Fox.successful(layer.name)
      _ <- bool2Fox(layer.doesContainBucket(bucket))
      remoteFallbackLayer <- layer.editableMappingService
        .remoteFallbackLayerFromVolumeTracing(layer.tracing, layer.tracingId)
      editableMapping <- layer.editableMappingService.get(editableMappingId, remoteFallbackLayer, layer.token)
      dataRequest: WebKnossosDataRequest = WebKnossosDataRequest(
        position = Vec3Int(bucket.topLeft.mag1X, bucket.topLeft.mag1Y, bucket.topLeft.mag1Z),
        mag = bucket.mag,
        cubeSize = layer.lengthOfUnderlyingCubes(bucket.mag),
        fourBit = None,
        applyAgglomerate = None,
        version = None
      )
      (unmappedData, indices) <- layer.editableMappingService.getFallbackDataFromDatastore(remoteFallbackLayer,
                                                                                           List(dataRequest),
                                                                                           layer.token)
      _ <- bool2Fox(indices.isEmpty)
      unmappedDataTyped <- layer.editableMappingService.bytesToUnsignedInt(unmappedData, layer.tracing.elementClass)
      segmentIds = layer.editableMappingService.collectSegmentIds(unmappedDataTyped)
      relevantMapping <- layer.editableMappingService.generateCombinedMappingSubset(segmentIds,
                                                                                    editableMapping,
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
  override def dataFormat: DataFormat.Value = DataFormat.wkw

  override def lengthOfUnderlyingCubes(resolution: Vec3Int): Int = DataLayer.bucketLength

  override def bucketProvider(fileSystemServiceOpt: Option[FileSystemService]): BucketProvider = new EditableMappingBucketProvider(layer = this)

  override def mappings: Option[Set[String]] = None

  override def defaultViewConfiguration: Option[LayerViewConfiguration] = None

  override def adminViewConfiguration: Option[LayerViewConfiguration] = None
}
