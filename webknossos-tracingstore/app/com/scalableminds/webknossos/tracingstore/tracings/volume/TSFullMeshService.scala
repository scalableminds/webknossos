package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.{bool2Fox, option2Fox}
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.geometry.Vec3IntProto
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import com.scalableminds.webknossos.datastore.models.{
  BucketPosition,
  VoxelPosition,
  VoxelSize,
  WebknossosAdHocMeshRequest
}
import com.scalableminds.webknossos.datastore.services.mesh.{FullMeshHelper, FullMeshRequest}
import com.scalableminds.webknossos.tracingstore.annotation.TSAnnotationService
import com.scalableminds.webknossos.tracingstore.tracings.FallbackDataHelper
import com.scalableminds.webknossos.tracingstore.tracings.editablemapping.EditableMappingService
import com.scalableminds.webknossos.tracingstore.{TSRemoteDatastoreClient, TSRemoteWebknossosClient}
import com.typesafe.scalalogging.LazyLogging

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class TSFullMeshService @Inject()(volumeTracingService: VolumeTracingService,
                                  editableMappingService: EditableMappingService,
                                  annotationService: TSAnnotationService,
                                  volumeSegmentIndexService: VolumeSegmentIndexService,
                                  val remoteDatastoreClient: TSRemoteDatastoreClient,
                                  val remoteWebknossosClient: TSRemoteWebknossosClient)
    extends FallbackDataHelper
    with ProtoGeometryImplicits
    with FullMeshHelper
    with LazyLogging {

  def loadFor(annotationId: String, tracingId: String, fullMeshRequest: FullMeshRequest)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[Array[Byte]] =
    for {
      tracing <- annotationService.findVolume(annotationId, tracingId) ?~> "tracing.notFound"
      data <- if (fullMeshRequest.meshFileName.isDefined)
        loadFullMeshFromMeshfile(annotationId, tracingId, tracing, fullMeshRequest)
      else loadFullMeshFromAdHoc(annotationId, tracingId, tracing, fullMeshRequest)
    } yield data

  private def loadFullMeshFromMeshfile(
      annotationId: String,
      tracingId: String,
      tracing: VolumeTracing,
      fullMeshRequest: FullMeshRequest)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Array[Byte]] =
    for {
      remoteFallbackLayer <- remoteFallbackLayerForVolumeTracing(tracing, annotationId)
      baseMappingName <- annotationService.baseMappingName(annotationId, tracingId, tracing)
      fullMeshRequestAdapted = if (tracing.getHasEditableMapping)
        fullMeshRequest.copy(mappingName = baseMappingName,
                             editableMappingTracingId = Some(tracingId),
                             mappingType = Some("HDF5"))
      else fullMeshRequest
      array <- remoteDatastoreClient.loadFullMeshStl(remoteFallbackLayer, fullMeshRequestAdapted)
    } yield array

  private def loadFullMeshFromAdHoc(
      annotationId: String,
      tracingId: String,
      tracing: VolumeTracing,
      fullMeshRequest: FullMeshRequest)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Array[Byte]] =
    for {
      mag <- fullMeshRequest.mag.toFox ?~> "mag.neededForAdHoc"
      _ <- bool2Fox(tracing.mags.contains(vec3IntToProto(mag))) ?~> "mag.notPresentInTracing"
      before = Instant.now
      voxelSize <- remoteDatastoreClient.voxelSizeForAnnotationWithCache(annotationId) ?~> "voxelSize.failedToFetch"
      verticesForChunks <- if (tracing.hasSegmentIndex.getOrElse(false))
        getAllAdHocChunksWithSegmentIndex(annotationId, tracingId, tracing, mag, voxelSize, fullMeshRequest)
      else
        getAllAdHocChunksWithNeighborLogic(
          annotationId,
          tracingId,
          tracing,
          mag,
          voxelSize,
          fullMeshRequest,
          fullMeshRequest.seedPosition.map(sp => VoxelPosition(sp.x, sp.y, sp.z, mag)),
          adHocChunkSize
        )
      encoded = verticesForChunks.map(adHocMeshToStl)
      array = combineEncodedChunksToStl(encoded)
      _ = logMeshingDuration(before, "ad-hoc meshing (tracingstore)", array.length)
    } yield array

  private def getAllAdHocChunksWithSegmentIndex(
      annotationId: String,
      tracingId: String,
      tracing: VolumeTracing,
      mag: Vec3Int,
      voxelSize: VoxelSize,
      fullMeshRequest: FullMeshRequest)(implicit ec: ExecutionContext, tc: TokenContext): Fox[List[Array[Float]]] =
    for {
      fallbackLayer <- volumeTracingService.getFallbackLayer(annotationId, tracing)
      mappingName <- annotationService.baseMappingName(annotationId, tracingId, tracing)
      bucketPositionsRaw: Set[Vec3IntProto] <- volumeSegmentIndexService.getSegmentToBucketIndex(
        tracing,
        fallbackLayer,
        tracingId,
        fullMeshRequest.segmentId,
        mag,
        mappingName,
        volumeTracingService.editableMappingTracingId(tracing, tracingId),
        fullMeshRequest.additionalCoordinates
      )
      bucketPositions = bucketPositionsRaw.toSeq
        .map(vec3IntFromProto)
        .map(_ * mag * DataLayer.bucketLength)
        .map(bp => BucketPosition(bp.x, bp.y, bp.z, mag, fullMeshRequest.additionalCoordinates))
        .toList
      vertexChunksWithNeighbors: List[(Array[Float], List[Int])] <- Fox.serialCombined(bucketPositions) {
        bucketPosition =>
          val adHocMeshRequest = WebknossosAdHocMeshRequest(
            position = Vec3Int(bucketPosition.voxelMag1X, bucketPosition.voxelMag1Y, bucketPosition.voxelMag1Z),
            mag = mag,
            cubeSize = Vec3Int.full(DataLayer.bucketLength + 1),
            fullMeshRequest.segmentId,
            voxelSize.factor,
            fullMeshRequest.mappingName,
            fullMeshRequest.mappingType,
            fullMeshRequest.additionalCoordinates,
            findNeighbors = false
          )
          loadMeshChunkFromAdHoc(annotationId, tracingId, tracing, adHocMeshRequest)
      }
      allVertices = vertexChunksWithNeighbors.map(_._1)
    } yield allVertices

  private def getAllAdHocChunksWithNeighborLogic(annotationId: String,
                                                 tracingId: String,
                                                 tracing: VolumeTracing,
                                                 mag: Vec3Int,
                                                 voxelSize: VoxelSize,
                                                 fullMeshRequest: FullMeshRequest,
                                                 topLeftOpt: Option[VoxelPosition],
                                                 chunkSize: Vec3Int,
                                                 visited: collection.mutable.Set[VoxelPosition] =
                                                   collection.mutable.Set[VoxelPosition]())(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[List[Array[Float]]] =
    for {
      topLeft <- topLeftOpt.toFox ?~> "seedPosition.neededForAdHoc"
      adHocMeshRequest = WebknossosAdHocMeshRequest(
        position = Vec3Int(topLeft.mag1X, topLeft.mag1Y, topLeft.mag1Z),
        mag = mag,
        cubeSize = Vec3Int(chunkSize.x + 1, chunkSize.y + 1, chunkSize.z + 1),
        fullMeshRequest.segmentId,
        voxelSize.factor,
        fullMeshRequest.mappingName,
        fullMeshRequest.mappingType,
        fullMeshRequest.additionalCoordinates
      )
      _ = visited += topLeft
      (vertices: Array[Float], neighbors) <- loadMeshChunkFromAdHoc(annotationId, tracingId, tracing, adHocMeshRequest)
      nextPositions: List[VoxelPosition] = generateNextTopLeftsFromNeighbors(topLeft, neighbors, chunkSize, visited)
      _ = visited ++= nextPositions
      neighborVerticesNested <- Fox.serialCombined(nextPositions) { position: VoxelPosition =>
        getAllAdHocChunksWithNeighborLogic(annotationId,
                                           tracingId,
                                           tracing,
                                           mag,
                                           voxelSize,
                                           fullMeshRequest,
                                           Some(position),
                                           chunkSize,
                                           visited)
      }
      allVertices: List[Array[Float]] = vertices +: neighborVerticesNested.flatten
    } yield allVertices

  private def loadMeshChunkFromAdHoc(
      annotationId: String,
      tracingId: String,
      tracing: VolumeTracing,
      adHocMeshRequest: WebknossosAdHocMeshRequest)(implicit tc: TokenContext): Fox[(Array[Float], List[Int])] =
    if (tracing.getHasEditableMapping) {
      val mappingLayer = annotationService.editableMappingLayer(annotationId, tracingId, tracing)
      editableMappingService.createAdHocMesh(mappingLayer, adHocMeshRequest)
    } else volumeTracingService.createAdHocMesh(annotationId, tracingId, tracing, adHocMeshRequest)
}
