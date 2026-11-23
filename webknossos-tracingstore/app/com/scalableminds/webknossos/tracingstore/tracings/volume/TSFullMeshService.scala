package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.geometry.Vec3IntProto
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryConversions
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import com.scalableminds.webknossos.datastore.models.{
  BucketPosition,
  VoxelPosition,
  VoxelSize,
  WebknossosAdHocMeshRequest
}
import com.scalableminds.webknossos.datastore.services.mesh.{
  AdHocMesh,
  FullMeshHelper,
  FullMeshRequest,
  MappingType,
  SegmentSurface,
  SurfaceChunk
}
import com.scalableminds.webknossos.tracingstore.annotation.TSAnnotationService
import com.scalableminds.webknossos.tracingstore.tracings.FallbackDataHelper
import com.scalableminds.webknossos.tracingstore.tracings.editablemapping.EditableMappingService
import com.scalableminds.webknossos.tracingstore.{TSRemoteDatastoreClient, TSRemoteWebknossosClient}
import com.typesafe.scalalogging.LazyLogging

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class TSFullMeshService @Inject() (
    volumeTracingService: VolumeTracingService,
    editableMappingService: EditableMappingService,
    annotationService: TSAnnotationService,
    volumeSegmentIndexService: VolumeSegmentIndexService,
    val remoteDatastoreClient: TSRemoteDatastoreClient,
    val remoteWebknossosClient: TSRemoteWebknossosClient
) extends FallbackDataHelper
    with ProtoGeometryConversions
    with FullMeshHelper
    with LazyLogging {

  def loadFor(annotationId: ObjectId, tracingId: String, fullMeshRequest: FullMeshRequest, version: Option[Long])(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[Array[Byte]] =
    for {
      tracing <- annotationService.findVolume(annotationId, tracingId, version) ?~> Msg.Annotation.notFound
      data <-
        if (fullMeshRequest.meshFileName.isDefined)
          loadFullMeshFromMeshFile(annotationId, tracingId, tracing, fullMeshRequest)
        else loadFullMeshFromAdHoc(annotationId, tracingId, tracing, fullMeshRequest)
    } yield data

  // Keyed by tracing id, the annotation version and the request: at a fixed version, the buckets do not change.
  private lazy val segmentSurfaceCache: AlfuCache[(String, Long, FullMeshRequest), SegmentSurface] =
    AlfuCache(maxCapacity = 1000)

  /** Measures the surface area and voxel count of a segment in the mag of the request, see NativeSegmentSurface. The
    * chunks are the buckets of the segment index, some grouped (see SurfaceChunk.forSegmentBuckets). Needs a segment
    * index. The buckets are read at the version of the given tracing.
    */
  def measureSurface(
      annotationId: ObjectId,
      tracingId: String,
      tracing: VolumeTracing,
      fullMeshRequest: FullMeshRequest
  )(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[SegmentSurface] =
    for {
      // Temporary tracings are not versioned, so their surfaces cannot be cached.
      isTemporaryTracing <- volumeTracingService.temporaryTracingService.isTemporaryTracing(tracingId)
      surface <-
        if (isTemporaryTracing) measureSurfaceUncached(annotationId, tracingId, tracing, fullMeshRequest)
        else
          segmentSurfaceCache.getOrLoad(
            (tracingId, tracing.version, fullMeshRequest),
            _ => measureSurfaceUncached(annotationId, tracingId, tracing, fullMeshRequest)
          )
    } yield surface

  private def measureSurfaceUncached(
      annotationId: ObjectId,
      tracingId: String,
      tracing: VolumeTracing,
      fullMeshRequest: FullMeshRequest
  )(using ec: ExecutionContext, tc: TokenContext): Fox[SegmentSurface] =
    for {
      mag <- fullMeshRequest.mag.toFox ?~> Msg.Mesh.magNeededForAdHoc
      _ <- Fox.fromBool(fullMeshRequest.segmentId.toLong != 0L) ?~> Msg.Mesh.segmentIdZeroForAdHoc
      _ <- Fox.fromBool(tracing.mags.contains(vec3IntToProto(mag))) ?~> Msg.Annotation.Volume
        .wrongMag(tracingId, mag.toMagLiteral(allowScalar = true))
      _ <- Fox.fromBool(tracing.hasSegmentIndex.getOrElse(false)) ?~> Msg.Mesh.segmentIndexNeededForSurface
      voxelSize <- remoteWebknossosClient.voxelSizeForAnnotationWithCache(
        annotationId
      ) ?~> Msg.Dataset.voxelSizeFailedToFetch
      bucketPositions <- segmentIndexBucketPositions(annotationId, tracingId, tracing, mag, fullMeshRequest)
      chunks = SurfaceChunk.forSegmentBuckets(bucketPositions)
      // Keeping several chunks in flight, as each one waits for its buckets to load.
      surfaces <- Fox.batchCombined(chunks, adHocMeshingBatchSize) { chunk =>
        val adHocMeshRequest = WebknossosAdHocMeshRequest(
          position = chunk.topLeft * mag,
          mag = mag,
          cubeSize = chunk.size,
          fullMeshRequest.segmentId,
          voxelSize.factor,
          fullMeshRequest.mappingName,
          fullMeshRequest.mappingType,
          fullMeshRequest.additionalCoordinates,
          // The version of the segment index, which the result is cached under.
          Some(tracing.version),
          findNeighbors = false
        )
        if (tracing.getHasEditableMapping) {
          val mappingLayer = annotationService.editableMappingLayer(annotationId, tracingId, tracing)
          editableMappingService.measureAdHocSurface(
            mappingLayer,
            adHocMeshRequest,
            chunk.interiorStart,
            chunk.interiorEnd
          )
        } else
          volumeTracingService.measureAdHocSurface(
            annotationId,
            tracingId,
            tracing,
            adHocMeshRequest,
            chunk.interiorStart,
            chunk.interiorEnd
          )
      }
    } yield surfaces.foldLeft(SegmentSurface.empty)(_ + _)

  private def loadFullMeshFromMeshFile(
      annotationId: ObjectId,
      tracingId: String,
      tracing: VolumeTracing,
      fullMeshRequest: FullMeshRequest
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Array[Byte]] =
    for {
      remoteFallbackLayer <- remoteFallbackLayerForVolumeTracing(tracing, annotationId)
      baseMappingName <- annotationService.baseMappingName(annotationId, tracingId, tracing)
      fullMeshRequestAdapted =
        if (tracing.getHasEditableMapping)
          fullMeshRequest.copy(
            mappingName = baseMappingName,
            editableMappingTracingId = Some(tracingId),
            annotationVersion = fullMeshRequest.annotationVersion.orElse(Some(tracing.version)),
            mappingType = Some(MappingType.AGGLOMERATE)
          )
        else fullMeshRequest
      array <- remoteDatastoreClient.loadFullMeshStl(remoteFallbackLayer, fullMeshRequestAdapted)
    } yield array

  private def loadFullMeshFromAdHoc(
      annotationId: ObjectId,
      tracingId: String,
      tracing: VolumeTracing,
      fullMeshRequest: FullMeshRequest
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Array[Byte]] =
    for {
      mag <- fullMeshRequest.mag.toFox ?~> Msg.Mesh.magNeededForAdHoc
      _ <- Fox.fromBool(fullMeshRequest.segmentId.toLong != 0L) ?~> Msg.Mesh.segmentIdZeroForAdHoc
      _ <- Fox.fromBool(tracing.mags.contains(vec3IntToProto(mag))) ?~> Msg.Annotation.Volume
        .wrongMag(tracingId, mag.toMagLiteral(allowScalar = true))
      before = Instant.now
      voxelSize <- remoteWebknossosClient.voxelSizeForAnnotationWithCache(
        annotationId
      ) ?~> Msg.Dataset.voxelSizeFailedToFetch
      verticesForChunks <-
        if (tracing.hasSegmentIndex.getOrElse(false))
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
      fullMeshRequest: FullMeshRequest
  )(using ec: ExecutionContext, tc: TokenContext): Fox[List[Array[Float]]] =
    for {
      segmentBuckets <- segmentIndexBucketPositions(annotationId, tracingId, tracing, mag, fullMeshRequest)
      bucketsWithNeighbors = bucketsToMesh(segmentBuckets)
      _ <- Fox.fromBool(bucketsWithNeighbors.length <= maxAdHocFullMeshChunksWithNeighbors) ?~> Msg.Mesh
        .tooManyAdHocMeshRequests(maxAdHocFullMeshChunksWithNeighbors)
      bucketPositions = bucketsWithNeighbors.toList
        .map(_ * mag * DataLayer.bucketLength)
        .map(bp => BucketPosition(bp.x, bp.y, bp.z, mag, fullMeshRequest.additionalCoordinates))
      // Keeping several chunks in flight, as each one waits for its buckets to load.
      meshChunks: List[AdHocMesh] <- Fox.batchCombined(bucketPositions, adHocMeshingBatchSize) { bucketPosition =>
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
    } yield meshChunks.map(_.triangleSoup)

  // The buckets (in buckets of mag) with a voxel of the segment, from the segment index.
  private def segmentIndexBucketPositions(
      annotationId: ObjectId,
      tracingId: String,
      tracing: VolumeTracing,
      mag: Vec3Int,
      fullMeshRequest: FullMeshRequest
  )(using ec: ExecutionContext, tc: TokenContext): Fox[List[Vec3Int]] =
    for {
      fallbackLayer <- volumeTracingService.getFallbackLayer(annotationId, tracing)
      mappingName <- annotationService.baseMappingName(annotationId, tracingId, tracing)
      bucketPositionsRaw: Set[Vec3IntProto] <- volumeSegmentIndexService.getSegmentToBucketIndex(
        tracing,
        fallbackLayer,
        tracingId,
        fullMeshRequest.segmentId.toLong,
        mag,
        mappingName,
        volumeTracingService.editableMappingTracingId(tracing, tracingId),
        tracing.version,
        fullMeshRequest.additionalCoordinates
      )
      bucketPositions = bucketPositionsRaw.toList.map(vec3IntFromProto)
      _ <- Fox.fromBool(bucketPositions.length <= maxAdHocFullMeshChunks) ?~> Msg.Mesh.tooManyAdHocMeshRequests(
        maxAdHocFullMeshChunks
      )
    } yield bucketPositions

  private def getAllAdHocChunksWithNeighborLogic(
      annotationId: ObjectId,
      tracingId: String,
      tracing: VolumeTracing,
      mag: Vec3Int,
      voxelSize: VoxelSize,
      fullMeshRequest: FullMeshRequest,
      topLeftOpt: Option[VoxelPosition],
      chunkSize: Vec3Int
  )(using ec: ExecutionContext, tc: TokenContext): Fox[List[Array[Float]]] = {
    // visited does not need to be thread-safe: it is mutated only at the start of each
    // processFrontier call (before any concurrent work begins); Fox.combined only reads it
    // (via generateNextTopLeftsFromNeighbors), and waves execute sequentially
    // via Fox.serialCombined, so no two writes ever race.
    val visited = collection.mutable.Set[VoxelPosition]()

    def processFrontier(
        frontier: List[VoxelPosition],
        acc: List[Array[Float]],
        datasetBoundingBox: BoundingBox
    ): Fox[List[Array[Float]]] =
      if (frontier.isEmpty) Fox.successful(acc)
      else if (visited.size + frontier.size > maxAdHocFullMeshChunks)
        Fox.failure(Msg.Mesh.tooManyAdHocMeshRequests(maxAdHocFullMeshChunks))
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
                fullMeshRequest.annotationVersion
              )
              loadMeshChunkFromAdHoc(annotationId, tracingId, tracing, adHocMeshRequest).map { mesh =>
                (
                  mesh.triangleSoup,
                  generateNextTopLeftsFromNeighbors(
                    position,
                    mesh.neighbors,
                    chunkSize,
                    visited,
                    datasetBoundingBox
                  )
                )
              }
            })
          }
          results = batchResults.flatten
          newVertices = results.map(_._1)
          nextFrontier = results.flatMap(_._2).distinct
          allVertices <- processFrontier(nextFrontier, newVertices ::: acc, datasetBoundingBox)
        } yield allVertices
      }

    for {
      topLeft <- topLeftOpt.toFox ?~> Msg.Mesh.seedPosNeededForAdHoc
      // Not tracing.boundingBox, which may be a smaller task bounding box
      dataSource <- remoteWebknossosClient.getDataSourceForAnnotation(annotationId)
      result <- processFrontier(List(topLeft), List.empty, dataSource.boundingBox)
    } yield result
  }

  private val adHocMeshingBatchSize = 8

  private def loadMeshChunkFromAdHoc(
      annotationId: ObjectId,
      tracingId: String,
      tracing: VolumeTracing,
      adHocMeshRequest: WebknossosAdHocMeshRequest
  )(using tc: TokenContext): Fox[AdHocMesh] =
    if (tracing.getHasEditableMapping) {
      val mappingLayer = annotationService.editableMappingLayer(annotationId, tracingId, tracing)
      editableMappingService.createAdHocMesh(mappingLayer, adHocMeshRequest)
    } else volumeTracingService.createAdHocMesh(annotationId, tracingId, tracing, adHocMeshRequest)
}
