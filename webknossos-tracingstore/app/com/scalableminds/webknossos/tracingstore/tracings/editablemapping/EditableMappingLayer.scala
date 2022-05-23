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
      remoteFallbackLayer <- layer.editableMappingService.remoteFallbackLayer(layer.tracing)
      editableMapping <- layer.editableMappingService.get(editableMappingId, remoteFallbackLayer, layer.token)
      dataRequest: WebKnossosDataRequest = WebKnossosDataRequest(
        position = Vec3Int(bucket.globalX, bucket.globalY, bucket.globalZ),
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
      _ <- bool2Fox(indices.isEmpty)
      segmentIds <- layer.editableMappingService.collectSegmentIds(unmappedData, layer.tracing.elementClass)
      relevantMapping <- layer.editableMappingService.generateCombinedMappingSubset(segmentIds,
                                                                                    editableMapping,
                                                                                    remoteFallbackLayer,
                                                                                    layer.token)
      mappedData <- layer.editableMappingService.mapData(unmappedData, relevantMapping, layer.elementClass)
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
