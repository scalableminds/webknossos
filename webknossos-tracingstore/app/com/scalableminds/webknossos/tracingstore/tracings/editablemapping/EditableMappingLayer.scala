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
import com.scalableminds.webknossos.datastore.storage.DataCubeCache

import scala.concurrent.ExecutionContext

class EditableMappingBucketProvider(layer: EditableMappingLayer) extends BucketProvider with ProtoGeometryImplicits {
  override def load(readInstruction: DataReadInstruction, cache: DataCubeCache)(
      implicit ec: ExecutionContext): Fox[Array[Byte]] = {
    val bucket: BucketPosition = readInstruction.bucket
    for {
      editableMappingId <- Fox.successful(layer.name)
      _ <- bool2Fox(layer.doesContainBucket(bucket))
      remoteFallbackLayer <- layer.editableMappingService.remoteFallbackLayer(layer.tracing)
      beforeGet = System.currentTimeMillis()
      editableMapping <- layer.editableMappingService.get(editableMappingId, remoteFallbackLayer, layer.token)
      afterGet = System.currentTimeMillis()
      dataRequest: WebKnossosDataRequest = WebKnossosDataRequest(
        position = Vec3Int(bucket.topLeft.x, bucket.topLeft.y, bucket.topLeft.z),
        mag = bucket.mag,
        cubeSize = layer.lengthOfUnderlyingCubes(bucket.mag),
        fourBit = None,
        applyAgglomerate = None,
        version = None
      )
      dataRequestCollection = List(dataRequest)
      (unmappedData, indices) <- layer.editableMappingService.getUnmappedDataFromDatastore(remoteFallbackLayer,
                                                                                           dataRequestCollection,
                                                                                           layer.token)
      afterGetUnmapped = System.currentTimeMillis()
      _ <- bool2Fox(indices.isEmpty)
      segmentIds <- layer.editableMappingService.collectSegmentIds(unmappedData, layer.tracing.elementClass)
      afterCollectSegmentIds = System.currentTimeMillis()
      relevantMapping <- layer.editableMappingService.generateCombinedMappingSubset(segmentIds,
                                                                                    editableMapping,
                                                                                    remoteFallbackLayer,
                                                                                    layer.token)
      afterCombineMapping = System.currentTimeMillis()
      mappedData: Array[Byte] <- layer.editableMappingService.mapData(unmappedData, relevantMapping, layer.elementClass)
      afterMapData = System.currentTimeMillis()
      _ = logger.info(
        s"load bucket timing: getMapping: ${afterGet - beforeGet} ms, getUnmapped: ${afterGetUnmapped - afterGet} ms, collectSegments: ${afterCollectSegmentIds - afterGet} ms, combine: ${afterCombineMapping - afterCollectSegmentIds}, mapData: ${afterMapData - afterCombineMapping}. Total ${afterMapData - beforeGet}. ${mappedData.length} bytes, ${segmentIds.size} segments")
    } yield mappedData
  }
}

case class EditableMappingLayer(name: String,
                                boundingBox: BoundingBox,
                                resolutions: List[Vec3Int],
                                largestSegmentId: Long,
                                elementClass: ElementClass.Value,
                                token: Option[String],
                                tracing: VolumeTracing,
                                editableMappingService: EditableMappingService)
    extends SegmentationLayer {
  override def dataFormat: DataFormat.Value = DataFormat.editableMapping

  override def lengthOfUnderlyingCubes(resolution: Vec3Int): Int = DataLayer.bucketLength

  override def bucketProvider: BucketProvider = new EditableMappingBucketProvider(layer = this)

  override def mappings: Option[Set[String]] = None

  override def defaultViewConfiguration: Option[LayerViewConfiguration] = None

  override def adminViewConfiguration: Option[LayerViewConfiguration] = None
}
