package com.scalableminds.webknossos.datastore.services.mesh

import com.scalableminds.util.Msg
import com.google.inject.Inject
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{JsonAutoFormat, Fox}
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, SegmentationLayer, UsableDataSource}
import com.scalableminds.webknossos.datastore.models.requests.Cuboid
import com.scalableminds.webknossos.datastore.models.{AdditionalCoordinate, VoxelPosition}
import com.scalableminds.webknossos.datastore.helpers.UnsignedLong
import com.scalableminds.webknossos.datastore.services.*
import com.typesafe.scalalogging.LazyLogging
import com.scalableminds.util.box.Box.tryo
import com.scalableminds.webknossos.datastore.services.mapping.MappingService
import com.scalableminds.webknossos.datastore.services.segmentindex.SegmentIndexFileService

import scala.concurrent.ExecutionContext

case class FullMeshRequest(
    meshFileName: Option[String], // None means ad-hoc meshing
    lod: Option[Int],
    segmentId: UnsignedLong, // if mappingName is set, this is an agglomerate id
    mappingName: Option[String],
    // An editable mapping is signaled via editableMappingTracingId below, not via mappingType (which stays AGGLOMERATE for it).
    mappingType: Option[MappingType.Value],
    editableMappingTracingId: Option[String],
    annotationVersion: Option[Long],
    mag: Option[Vec3Int], // required for ad-hoc meshing
    seedPosition: Option[Vec3Int], // required for ad-hoc meshing
    additionalCoordinates: Option[Seq[AdditionalCoordinate]]
) derives JsonAutoFormat

class DSFullMeshService @Inject() (
    meshFileService: MeshFileService,
    val binaryDataServiceHolder: BinaryDataServiceHolder,
    val dsRemoteWebknossosClient: DSRemoteWebknossosClient,
    val dsRemoteTracingstoreClient: DSRemoteTracingstoreClient,
    mappingService: MappingService,
    config: DataStoreConfig,
    segmentIndexFileService: SegmentIndexFileService,
    adHocMeshServiceHolder: AdHocMeshServiceHolder
) extends LazyLogging
    with FullMeshHelper
    with MeshMappingHelper {

  val binaryDataService: BinaryDataService = binaryDataServiceHolder.binaryDataService
  adHocMeshServiceHolder.dataStoreAdHocMeshConfig =
    (binaryDataService, mappingService, config.Datastore.AdHocMesh.timeout, config.Datastore.AdHocMesh.actorPoolSize)
  val adHocMeshService: AdHocMeshService = adHocMeshServiceHolder.dataStoreAdHocMeshService

  // Keyed by requests without a mesh file name: the surface of the segment's ad-hoc mesh and its voxel count.
  lazy val segmentSurfaceCache: AlfuCache[(ObjectId, String, FullMeshRequest), SegmentSurface] =
    AlfuCache(maxCapacity = 10000)

  // Keyed by requests with a mesh file name: the surface area of the segment's mesh in that mesh file.
  lazy val meshFileSurfaceAreaCache: AlfuCache[(ObjectId, String, FullMeshRequest), Double] =
    AlfuCache(maxCapacity = 10000)

  def clearCache(datasetId: ObjectId, layerNameOpt: Option[String]): Int = {
    def matches(key: (ObjectId, String, FullMeshRequest)): Boolean =
      key._1 == datasetId && layerNameOpt.forall(_ == key._2)
    segmentSurfaceCache.clear(matches) + meshFileSurfaceAreaCache.clear(matches)
  }

  /** Measures the surface area and voxel count of a segment in the mag of the request, see [[NativeSegmentSurface]].
    * Each bucket of the segment index is one chunk, measured on the actor pool like an ad-hoc mesh. Needs a segment
    * index.
    */
  def measureSurface(
      datasetId: ObjectId,
      dataSource: UsableDataSource,
      dataLayer: DataLayer,
      fullMeshRequest: FullMeshRequest
  )(using ec: ExecutionContext, tc: TokenContext): Fox[SegmentSurface] =
    for {
      mag <- fullMeshRequest.mag.toFox ?~> Msg.Mesh.magNeededForAdHoc
      _ <- Fox.fromBool(fullMeshRequest.segmentId.toLong != 0L) ?~> Msg.Mesh.segmentIdZeroForAdHoc
      segmentationLayer <- tryo(
        dataLayer.asInstanceOf[SegmentationLayer]
      ).toFox ?~> Msg.Dataset.Layer.mustBeSegmentation
      _ <- Fox.fromBool(
        segmentationLayer.attachments.flatMap(_.segmentIndex).isDefined
      ) ?~> Msg.Mesh.segmentIndexNeededForSurface
      before = Instant.now
      bucketPositions <- segmentIndexBucketPositions(dataSource, segmentationLayer, fullMeshRequest, mag)
      surfaces <- Fox.batchCombined(bucketPositions.toIndexedSeq, config.Datastore.AdHocMesh.actorPoolSize) {
        bucketPosition =>
          val chunk = SurfaceChunk.forBucket(bucketPosition)
          val meshRequest = AdHocMeshRequest(
            Some(datasetId),
            Some(dataSource.id),
            segmentationLayer,
            Cuboid(
              VoxelPosition(chunk.topLeft.x * mag.x, chunk.topLeft.y * mag.y, chunk.topLeft.z * mag.z, mag),
              chunk.size.x,
              chunk.size.y,
              chunk.size.z
            ),
            fullMeshRequest.segmentId.toLong,
            dataSource.scale.factor,
            tc,
            fullMeshRequest.mappingName,
            fullMeshRequest.mappingType,
            fullMeshRequest.additionalCoordinates,
            fullMeshRequest.annotationVersion,
            findNeighbors = false
          )
          adHocMeshService.requestSurfaceViaActor(
            SegmentSurfaceRequest(meshRequest, chunk.interiorStart, chunk.interiorEnd)
          )
      }
      surface = surfaces.foldLeft(SegmentSurface.empty)(_ + _)
      _ = Instant.logSince(before, s"Measured the surface of a segment in ${bucketPositions.length} buckets,", logger)
    } yield surface

  /** The surface area of the segment's mesh in the mesh file of the request. */
  def surfaceAreaFromMeshFile(
      dataSource: UsableDataSource,
      dataLayer: DataLayer,
      fullMeshRequest: FullMeshRequest
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Double] =
    for {
      chunkAreas <- mapMeshFileChunks(dataSource, dataLayer, fullMeshRequest) {
        (chunkInfo, dracoBytes, scale, vertexQuantizationBits) =>
          tryo(
            dracoToStlConverter.dracoSurfaceArea(
              dracoBytes,
              chunkInfo.position.x,
              chunkInfo.position.y,
              chunkInfo.position.z,
              scale.x,
              scale.y,
              scale.z,
              vertexQuantizationBits
            )
          ).toFox
      }
    } yield chunkAreas.sum

  def loadFor(
      datasetId: ObjectId,
      dataSource: UsableDataSource,
      dataLayer: DataLayer,
      fullMeshRequest: FullMeshRequest
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Array[Byte]] =
    if (fullMeshRequest.meshFileName.isDefined)
      loadFullMeshFromMeshFile(dataSource, dataLayer, fullMeshRequest)
    else
      loadFullMeshFromAdHoc(datasetId, dataSource, dataLayer, fullMeshRequest)

  private def loadFullMeshFromAdHoc(
      datasetId: ObjectId,
      dataSource: UsableDataSource,
      dataLayer: DataLayer,
      fullMeshRequest: FullMeshRequest
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Array[Byte]] =
    for {
      mag <- fullMeshRequest.mag.toFox ?~> Msg.Mesh.magNeededForAdHoc
      _ <- Fox.fromBool(fullMeshRequest.segmentId.toLong != 0L) ?~> Msg.Mesh.segmentIdZeroForAdHoc
      segmentationLayer <- tryo(
        dataLayer.asInstanceOf[SegmentationLayer]
      ).toFox ?~> Msg.Dataset.Layer.mustBeSegmentation
      hasSegmentIndexFile = segmentationLayer.attachments.flatMap(_.segmentIndex).isDefined
      before = Instant.now
      verticesForChunks <-
        if (hasSegmentIndexFile)
          getAllAdHocChunksWithSegmentIndex(datasetId, dataSource, segmentationLayer, fullMeshRequest, mag)
        else {
          for {
            seedPosition <- fullMeshRequest.seedPosition.toFox ?~> Msg.Mesh.magNeededForAdHoc
            chunks <- getAllAdHocChunksWithNeighborLogic(
              datasetId,
              dataSource,
              segmentationLayer,
              fullMeshRequest,
              VoxelPosition(seedPosition.x, seedPosition.y, seedPosition.z, mag),
              adHocChunkSize
            )
          } yield chunks
        }

      encoded = verticesForChunks.map(adHocMeshToStl)
      array = combineEncodedChunksToStl(encoded)
      _ = logMeshingDuration(before, "ad-hoc meshing", array.length)
    } yield array

  private def getAllAdHocChunksWithSegmentIndex(
      datasetId: ObjectId,
      dataSource: UsableDataSource,
      segmentationLayer: SegmentationLayer,
      fullMeshRequest: FullMeshRequest,
      mag: Vec3Int
  )(using ec: ExecutionContext, tc: TokenContext): Fox[List[Array[Float]]] =
    for {
      segmentBuckets <- segmentIndexBucketPositions(dataSource, segmentationLayer, fullMeshRequest, mag)
      targetMagPositions = bucketsToMesh(segmentBuckets.toSeq)
      // Dispatch chunks to the actor pool keeping actorPoolSize requests in flight at a time.
      meshChunks: List[AdHocMesh] <- Fox.batchCombined(
        targetMagPositions.toIndexedSeq,
        config.Datastore.AdHocMesh.actorPoolSize
      ) { targetMagPosition =>
        val adHocMeshRequest = AdHocMeshRequest(
          Some(datasetId),
          Some(dataSource.id),
          segmentationLayer,
          Cuboid(
            VoxelPosition(
              targetMagPosition.x * mag.x * DataLayer.bucketLength,
              targetMagPosition.y * mag.y * DataLayer.bucketLength,
              targetMagPosition.z * mag.z * DataLayer.bucketLength,
              mag
            ),
            DataLayer.bucketLength + 1,
            DataLayer.bucketLength + 1,
            DataLayer.bucketLength + 1
          ),
          fullMeshRequest.segmentId.toLong,
          dataSource.scale.factor,
          tc,
          fullMeshRequest.mappingName,
          fullMeshRequest.mappingType,
          fullMeshRequest.additionalCoordinates,
          fullMeshRequest.annotationVersion,
          findNeighbors = false
        )
        adHocMeshService.requestAdHocMeshViaActor(adHocMeshRequest)
      }
    } yield meshChunks.map(_.triangleSoup)

  // The buckets (in buckets of mag) with a voxel of the segment (or of the agglomerate's segments), from the segment
  // index.
  private def segmentIndexBucketPositions(
      dataSource: UsableDataSource,
      segmentationLayer: SegmentationLayer,
      fullMeshRequest: FullMeshRequest,
      mag: Vec3Int
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Array[Vec3Int]] =
    for {
      segmentIndexFileKey <- segmentIndexFileService.lookUpSegmentIndexFileKey(dataSource.id, segmentationLayer)
      segmentIds <- segmentIdsForAgglomerateIdIfNeeded(
        dataSource.id,
        segmentationLayer,
        fullMeshRequest.mappingName,
        fullMeshRequest.editableMappingTracingId,
        fullMeshRequest.annotationVersion,
        fullMeshRequest.segmentId.toLong,
        mappingNameForMeshFile = None,
        omitMissing = false
      )
      topLeftsNested: Seq[Array[Vec3Int]] <- Fox.serialCombined(segmentIds)(sId =>
        segmentIndexFileService.readSegmentIndex(segmentIndexFileKey, sId)
      )
      topLefts: Array[Vec3Int] = topLeftsNested.toArray.flatten
      targetMagPositions = segmentIndexFileService.topLeftsToDistinctTargetMagBucketPositions(topLefts, mag)
      _ <- Fox.fromBool(targetMagPositions.length <= maxAdHocFullMeshChunks) ?~> Msg.Mesh.tooManyAdHocMeshRequests(
        maxAdHocFullMeshChunks
      )
    } yield targetMagPositions

  private def getAllAdHocChunksWithNeighborLogic(
      datasetId: ObjectId,
      dataSource: UsableDataSource,
      segmentationLayer: SegmentationLayer,
      fullMeshRequest: FullMeshRequest,
      topLeft: VoxelPosition,
      chunkSize: Vec3Int
  )(using ec: ExecutionContext, tc: TokenContext): Fox[List[Array[Float]]] = {
    // Iterative parallel BFS. Each wave dispatches all frontier positions concurrently
    // (in actorPoolSize batches) rather than serially one at a time.
    // visited is marked before dispatch so parallel wave members don't queue the same position.
    // visited does not need to be thread-safe: it is mutated only at the start of each
    // processFrontier call (before any concurrent work begins); Fox.combined only reads it
    // (via generateNextTopLeftsFromNeighbors), and waves execute sequentially
    // via Fox.serialCombined, so no two writes ever race.
    val visited = collection.mutable.Set[VoxelPosition]()

    def processFrontier(frontier: List[VoxelPosition], acc: List[Array[Float]]): Fox[List[Array[Float]]] =
      if (frontier.isEmpty) Fox.successful(acc)
      else if (visited.size + frontier.size > maxAdHocFullMeshChunks)
        Fox.failure(Msg.Mesh.tooManyAdHocMeshRequests(maxAdHocFullMeshChunks))
      else {
        visited ++= frontier
        val batches = frontier.grouped(config.Datastore.AdHocMesh.actorPoolSize).toList
        for {
          batchResults <- Fox.serialCombined(batches) { batch =>
            Fox.combined(batch.map { position =>
              val adHocMeshRequest = AdHocMeshRequest(
                Some(datasetId),
                Some(dataSource.id),
                segmentationLayer,
                Cuboid(position, chunkSize.x + 1, chunkSize.y + 1, chunkSize.z + 1),
                fullMeshRequest.segmentId.toLong,
                dataSource.scale.factor,
                tc,
                fullMeshRequest.mappingName,
                fullMeshRequest.mappingType,
                fullMeshRequest.additionalCoordinates,
                fullMeshRequest.annotationVersion
              )
              adHocMeshService.requestAdHocMeshViaActor(adHocMeshRequest).map { mesh =>
                (
                  mesh.triangleSoup,
                  generateNextTopLeftsFromNeighbors(
                    position,
                    mesh.neighbors,
                    chunkSize,
                    visited,
                    segmentationLayer.boundingBox
                  )
                )
              }
            })
          }
          results = batchResults.flatten
          newVertices = results.map(_._1)
          // Two wave members may share a border and independently report the same neighbor position
          nextFrontier = results.flatMap(_._2).distinct
          allVertices <- processFrontier(nextFrontier, newVertices ::: acc)
        } yield allVertices
      }

    processFrontier(List(topLeft), List.empty)
  }

  // Returns individual raw STL chunks (50 bytes/face, no header) for a mesh-file request.
  private def loadMeshChunksFromMeshFile(
      dataSource: UsableDataSource,
      dataLayer: DataLayer,
      fullMeshRequest: FullMeshRequest
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Seq[Array[Byte]]] =
    mapMeshFileChunks(dataSource, dataLayer, fullMeshRequest) { (chunkInfo, dracoBytes, scale, vertexQuantizationBits) =>
      tryo(
        dracoToStlConverter.dracoToStl(
          dracoBytes,
          chunkInfo.position.x,
          chunkInfo.position.y,
          chunkInfo.position.z,
          scale.x,
          scale.y,
          scale.z,
          vertexQuantizationBits
        )
      ).toFox
    }

  // Reads the Draco-encoded chunks of the segment's mesh in the mesh file of the request one by one, and converts each
  // with the scale of the requested LOD and the vertex quantization bits of the mesh file.
  private def mapMeshFileChunks[T](
      dataSource: UsableDataSource,
      dataLayer: DataLayer,
      fullMeshRequest: FullMeshRequest
  )(
      convert: (MeshChunk, Array[Byte], Vec3Double, Int) => Fox[T]
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Seq[T]] =
    for {
      meshFileName <- fullMeshRequest.meshFileName.toFox ?~> Msg.Mesh.File.meshFileNameRequired
      meshFileKey <- meshFileService.lookUpMeshFileKey(dataSource.id, dataLayer, meshFileName)
      mappingNameForMeshFile <- meshFileService.mappingNameForMeshFile(meshFileKey)
      segmentIds <- segmentIdsForAgglomerateIdIfNeeded(
        dataSource.id,
        dataLayer,
        fullMeshRequest.mappingName,
        fullMeshRequest.editableMappingTracingId,
        fullMeshRequest.annotationVersion,
        fullMeshRequest.segmentId.toLong,
        mappingNameForMeshFile,
        omitMissing = false
      )
      vertexQuantizationBits <- meshFileService.getVertexQuantizationBits(meshFileKey)
      chunkInfos: WebknossosSegmentInfo <- meshFileService.listMeshChunksForSegmentsMerged(meshFileKey, segmentIds)
      selectedLod = fullMeshRequest.lod.getOrElse(0)
      allChunkRanges: List[MeshChunk] = chunkInfos.lods(selectedLod).chunks
      // Of the transform, only the scale is used
      lodTransform = chunkInfos.lods(selectedLod).transform
      scale <- tryo(
        Vec3Double(lodTransform(0)(0), lodTransform(1)(1), lodTransform(2)(2))
      ).toFox ?~> "could not extract scale from mesh file transform attribute"
      converted: Seq[T] <- Fox.serialCombined(allChunkRanges) { (chunkInfo: MeshChunk) =>
        for {
          (dracoBytes, encoding) <- meshFileService.readMeshChunk(
            meshFileKey,
            List(
              MeshChunkDataRequest(
                chunkInfo.byteOffset,
                chunkInfo.byteSize,
                Some(UnsignedLong(fullMeshRequest.segmentId.toLong)) // only used in neuroglancerPrecomputed case
              )
            )
          ) ?~> Msg.Mesh.File.loadChunkFailed
          _ <- Fox.fromBool(encoding == "draco") ?~> s"mesh file encoding is $encoding, only draco is supported"
          result <- convert(chunkInfo, dracoBytes, scale, vertexQuantizationBits)
        } yield result
      }
    } yield converted

  private def loadFullMeshFromMeshFile(
      dataSource: UsableDataSource,
      dataLayer: DataLayer,
      fullMeshRequest: FullMeshRequest
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Array[Byte]] =
    for {
      before <- Instant.nowFox
      stlEncodedChunks <- loadMeshChunksFromMeshFile(dataSource, dataLayer, fullMeshRequest)
      stlOutput = combineEncodedChunksToStl(stlEncodedChunks)
      _ = logMeshingDuration(before, "meshFile", stlOutput.length)
    } yield stlOutput

}
