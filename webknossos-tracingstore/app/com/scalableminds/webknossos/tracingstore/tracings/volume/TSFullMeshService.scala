package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}
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
    with FoxImplicits
    with LazyLogging {

  def loadFor(annotationId: ObjectId, tracingId: String, fullMeshRequest: FullMeshRequest, version: Option[Long])(
      using ec: ExecutionContext,
      tc: TokenContext): Fox[Array[Byte]] =
    for {
      tracing <- annotationService.findVolume(annotationId, tracingId, version) ?~> Msg.Annotation.notFound
      data <- if (fullMeshRequest.meshFileName.isDefined)
        loadFullMeshFromMeshFile(annotationId, tracingId, tracing, fullMeshRequest)
      else loadFullMeshFromAdHoc(annotationId, tracingId, tracing, fullMeshRequest)
    } yield data

  private def loadFullMeshFromMeshFile(
      annotationId: ObjectId,
      tracingId: String,
      tracing: VolumeTracing,
      fullMeshRequest: FullMeshRequest)(using ec: ExecutionContext, tc: TokenContext): Fox[Array[Byte]] =
    for {
      remoteFallbackLayer <- remoteFallbackLayerForVolumeTracing(tracing, annotationId)
      baseMappingName <- annotationService.baseMappingName(annotationId, tracingId, tracing)
      fullMeshRequestAdapted = if (tracing.getHasEditableMapping)
        fullMeshRequest.copy(
          mappingName = baseMappingName,
          editableMappingTracingId = Some(tracingId),
          annotationVersion = fullMeshRequest.annotationVersion.orElse(Some(tracing.version)),
          mappingType = Some("HDF5")
        )
      else fullMeshRequest
      array <- remoteDatastoreClient.loadFullMeshStl(remoteFallbackLayer, fullMeshRequestAdapted)
    } yield array

  private def loadFullMeshFromAdHoc(
      annotationId: ObjectId,
      tracingId: String,
      tracing: VolumeTracing,
      fullMeshRequest: FullMeshRequest)(using ec: ExecutionContext, tc: TokenContext): Fox[Array[Byte]] =
    for {
      mag <- fullMeshRequest.mag.toFox ?~> Msg.Mesh.magNeededForAdHoc
      _ <- Fox.fromBool(tracing.mags.contains(vec3IntToProto(mag))) ?~> Msg.Annotation.Volume
        .wrongMag(tracingId, mag.toMagLiteral(allowScalar = true))
      before = Instant.now
      voxelSize <- remoteWebknossosClient.voxelSizeForAnnotationWithCache(annotationId) ?~> Msg.Dataset.voxelSizeFailedToFetch
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
      annotationId: ObjectId,
      tracingId: String,
      tracing: VolumeTracing,
      mag: Vec3Int,
      voxelSize: VoxelSize,
      fullMeshRequest: FullMeshRequest)(using ec: ExecutionContext, tc: TokenContext): Fox[List[Array[Float]]] =
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
        tracing.version,
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
            fullMeshRequest.annotationVersion,
            findNeighbors = false
          )
          loadMeshChunkFromAdHoc(annotationId, tracingId, tracing, adHocMeshRequest)
      }
      allVertices = vertexChunksWithNeighbors.map(_._1)
    } yield allVertices

  private def getAllAdHocChunksWithNeighborLogic(
      annotationId: ObjectId,
      tracingId: String,
      tracing: VolumeTracing,
      mag: Vec3Int,
      voxelSize: VoxelSize,
      fullMeshRequest: FullMeshRequest,
      topLeftOpt: Option[VoxelPosition],
      chunkSize: Vec3Int)(using ec: ExecutionContext, tc: TokenContext): Fox[List[Array[Float]]] = {
    // visited does not need to be thread-safe: it is mutated only at the start of each
    // processFrontier call (before any concurrent work begins); Fox.combined only reads it
    // (via generateNextTopLeftsFromNeighbors.filterNot), and waves execute sequentially
    // via Fox.serialCombined, so no two writes ever race.
    val visited = collection.mutable.Set[VoxelPosition]()

    def processFrontier(frontier: List[VoxelPosition], acc: List[Array[Float]]): Fox[List[Array[Float]]] =
      if (frontier.isEmpty) Fox.successful(acc)
      else {
        visited ++= frontier
        val batches = frontier.grouped(adHocMeshingBatchSize).toList
        for {
          batchResults <- Fox.serialCombined(batches) { batch =>
            Fox.combined(batch.map { position =>
              val adHocMeshRequest = WebknossosAdHocMeshRequest(
                position = Vec3Int(position.mag1X, position.mag1Y, position.mag1Z),
                mag = mag,
                cubeSize = Vec3Int(chunkSize.x + 1, chunkSize.y + 1, chunkSize.z + 1),
                fullMeshRequest.segmentId,
                voxelSize.factor,
                fullMeshRequest.mappingName,
                fullMeshRequest.mappingType,
                fullMeshRequest.additionalCoordinates,
                fullMeshRequest.annotationVersion,
              )
              loadMeshChunkFromAdHoc(annotationId, tracingId, tracing, adHocMeshRequest).map {
                case (vertices, neighborIds) =>
                  (vertices, generateNextTopLeftsFromNeighbors(position, neighborIds, chunkSize, visited))
              }
            })
          }
          results = batchResults.flatten
          newVertices = results.map(_._1)
          nextFrontier = results.flatMap(_._2).distinct
          allVertices <- processFrontier(nextFrontier, newVertices ::: acc)
        } yield allVertices
      }

    for {
      topLeft <- topLeftOpt.toFox ?~> Msg.Mesh.seedPosNeededForAdHoc
      result <- processFrontier(List(topLeft), List.empty)
    } yield result
  }

  private val adHocMeshingBatchSize = 8

  private def loadMeshChunkFromAdHoc(
      annotationId: ObjectId,
      tracingId: String,
      tracing: VolumeTracing,
      adHocMeshRequest: WebknossosAdHocMeshRequest)(using tc: TokenContext): Fox[(Array[Float], List[Int])] =
    if (tracing.getHasEditableMapping) {
      val mappingLayer = annotationService.editableMappingLayer(annotationId, tracingId, tracing)
      editableMappingService.createAdHocMesh(mappingLayer, adHocMeshRequest)
    } else volumeTracingService.createAdHocMesh(annotationId, tracingId, tracing, adHocMeshRequest)
}
