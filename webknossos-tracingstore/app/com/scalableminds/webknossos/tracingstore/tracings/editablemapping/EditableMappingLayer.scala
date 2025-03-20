package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.{bool2Fox, box2Fox}
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
import com.scalableminds.webknossos.tracingstore.annotation.TSAnnotationService

import scala.concurrent.ExecutionContext

class EditableMappingBucketProvider(layer: EditableMappingLayer) extends BucketProvider with ProtoGeometryImplicits {

  override def load(readInstruction: DataReadInstruction)(implicit ec: ExecutionContext,
                                                          tc: TokenContext): Fox[Array[Byte]] = {
    val bucket: BucketPosition = readInstruction.bucket
    for {
      tracingId <- Fox.successful(layer.name)
      elementClassProto <- ElementClass.toProto(layer.elementClass).toFox
      _ <- bool2Fox(layer.doesContainBucket(bucket))
      remoteFallbackLayer <- layer.editableMappingService
        .remoteFallbackLayerFromVolumeTracing(layer.tracing, layer.annotationId)
      // called here to ensure updates are applied
      editableMappingInfo <- layer.annotationService.findEditableMappingInfo(layer.annotationId,
                                                                             tracingId,
                                                                             Some(layer.version))(ec, tc)
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
                                                                                           List(dataRequest))(ec, tc)
      _ <- bool2Fox(indices.isEmpty)
      unmappedDataTyped <- layer.editableMappingService.bytesToSegmentInt(unmappedData, layer.tracing.elementClass)
      segmentIds = layer.editableMappingService.collectSegmentIds(unmappedDataTyped)
      relevantMapping <- layer.editableMappingService.generateCombinedMappingForSegmentIds(segmentIds,
                                                                                           editableMappingInfo,
                                                                                           layer.version,
                                                                                           tracingId,
                                                                                           remoteFallbackLayer)(tc)
      mappedData: Array[Byte] <- layer.editableMappingService.mapData(unmappedDataTyped,
                                                                      relevantMapping,
                                                                      elementClassProto)
    } yield mappedData
  }
}

case class EditableMappingLayer(name: String, // set to tracing id
                                boundingBox: BoundingBox,
                                resolutions: List[Vec3Int],
                                largestSegmentId: Option[Long],
                                elementClass: ElementClass.Value,
                                tracing: VolumeTracing,
                                annotationId: String,
                                annotationService: TSAnnotationService,
                                editableMappingService: EditableMappingService)
    extends SegmentationLayer {
  override val mags: List[MagLocator] = List.empty // MagLocators do not apply for annotation layers

  override def dataFormat: DataFormat.Value = DataFormat.wkw

  override def coordinateTransformations: Option[List[CoordinateTransformation]] = None

  override def lengthOfUnderlyingCubes(mag: Vec3Int): Int = DataLayer.bucketLength

  override def bucketProvider(remoteSourceDescriptorServiceOpt: Option[RemoteSourceDescriptorService],
                              dataSourceId: DataSourceId,
                              sharedChunkContentsCache: Option[AlfuCache[String, MultiArray]]): BucketProvider =
    new EditableMappingBucketProvider(layer = this)

  override def mappings: Option[Set[String]] = None

  override def defaultViewConfiguration: Option[LayerViewConfiguration] = None

  override def adminViewConfiguration: Option[LayerViewConfiguration] = None

  override def additionalAxes: Option[Seq[AdditionalAxis]] = None

  def version: Long = tracing.version
}
