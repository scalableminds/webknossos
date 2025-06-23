package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Fox, FoxImplicits}
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
  DataLayerLike,
  DataSourceId,
  DatasetLayerAttachments,
  ElementClass,
  SegmentationLayer
}
import ucar.ma2.{Array => MultiArray}
import com.scalableminds.webknossos.datastore.models.requests.DataReadInstruction
import com.scalableminds.webknossos.datastore.storage.RemoteSourceDescriptorService
import com.scalableminds.webknossos.tracingstore.annotation.TSAnnotationService
import com.typesafe.scalalogging.LazyLogging

import scala.concurrent.ExecutionContext

class EditableMappingBucketProvider(layer: EditableMappingLayer)
    extends BucketProvider
    with ProtoGeometryImplicits
    with LazyLogging
    with FoxImplicits {

  override def load(readInstruction: DataReadInstruction)(implicit ec: ExecutionContext,
                                                          tc: TokenContext): Fox[Array[Byte]] = {
    val bucket: BucketPosition = readInstruction.bucket
    for {
      elementClassProto <- ElementClass.toProto(layer.elementClass).toFox
      editableMappingService = layer.editableMappingService
      // The layer version is always current because EditableMappingBucketProvider is not cached across versions.
      // This is different from volumeTracingVersion, because we need a non-optional version here so the caching
      // in editableMappingService works properly.
      version = layer.version
      _ <- Fox.fromBool(layer.doesContainBucket(bucket))
      remoteFallbackLayer <- editableMappingService.remoteFallbackLayerForVolumeTracing(layer.tracing,
                                                                                        layer.annotationId)
      // called here to ensure updates are applied
      editableMappingInfo <- layer.annotationService.findEditableMappingInfo(layer.annotationId,
                                                                             layer.tracingId,
                                                                             Some(version))(ec, tc)
      dataRequest: WebknossosDataRequest = WebknossosDataRequest(
        position = Vec3Int(bucket.topLeft.mag1X, bucket.topLeft.mag1Y, bucket.topLeft.mag1Z),
        mag = bucket.mag,
        cubeSize = layer.lengthOfUnderlyingCubes(bucket.mag),
        fourBit = None,
        applyAgglomerate = None,
        version = None,
        additionalCoordinates = readInstruction.bucket.additionalCoordinates
      )
      unmappedData <- editableMappingService.getFallbackBucketFromDataStore(remoteFallbackLayer, dataRequest)(ec, tc)
      segmentIds <- editableMappingService.collectSegmentIds(unmappedData, layer.elementClass).toFox
      relevantMapping <- editableMappingService.generateCombinedMappingForSegmentIds(segmentIds,
                                                                                     editableMappingInfo,
                                                                                     version,
                                                                                     layer.tracingId,
                                                                                     remoteFallbackLayer)(tc)
      mappedData <- editableMappingService.mapData(unmappedData, relevantMapping, elementClassProto)
    } yield mappedData
  }
}

case class EditableMappingLayer(name: String, // set to tracing id
                                boundingBox: BoundingBox,
                                resolutions: List[Vec3Int],
                                largestSegmentId: Option[Long],
                                elementClass: ElementClass.Value,
                                tracing: VolumeTracing,
                                annotationId: ObjectId,
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

  // Do not cache EditableMappingBucketProviders across versions. This way, load can use the passed layer’s version.
  override def bucketProviderCacheKey: String = s"${this.name}-v${this.version}"

  override def mappings: Option[Set[String]] = None

  override def defaultViewConfiguration: Option[LayerViewConfiguration] = None

  override def adminViewConfiguration: Option[LayerViewConfiguration] = None

  override def additionalAxes: Option[Seq[AdditionalAxis]] = None

  override def attachments: Option[DatasetLayerAttachments] = None

  def version: Long = tracing.version

  def tracingId: String = name

  override def asAbstractLayer: DataLayerLike = ???
}
