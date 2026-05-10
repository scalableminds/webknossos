package com.scalableminds.webknossos.datastore.services.mesh

import com.scalableminds.util.Msg
import com.google.inject.Inject
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, SegmentationLayer, UsableDataSource}
import com.scalableminds.webknossos.datastore.models.requests.Cuboid
import com.scalableminds.webknossos.datastore.models.{AdditionalCoordinate, VoxelPosition}
import com.scalableminds.webknossos.datastore.services._
import com.typesafe.scalalogging.LazyLogging
import com.scalableminds.util.tools.Box.tryo
import com.scalableminds.webknossos.datastore.services.mapping.MappingService
import com.scalableminds.webknossos.datastore.services.segmentindex.SegmentIndexFileService
import play.api.libs.json.{Json, OFormat}

import scala.concurrent.ExecutionContext

case class FullMeshRequest(
    meshFileName: Option[String], // None means ad-hoc meshing
    lod: Option[Int],
    segmentId: Long, // if mappingName is set, this is an agglomerate id
    mappingName: Option[String],
    mappingType: Option[String], // json, agglomerate, editableMapping
    editableMappingTracingId: Option[String],
    annotationVersion: Option[Long],
    mag: Option[Vec3Int], // required for ad-hoc meshing
    seedPosition: Option[Vec3Int], // required for ad-hoc meshing
    additionalCoordinates: Option[Seq[AdditionalCoordinate]]
)

object FullMeshRequest {
  implicit val jsonFormat: OFormat[FullMeshRequest] = Json.format[FullMeshRequest]
}

class DSFullMeshService @Inject()(meshFileService: MeshFileService,
                                  val binaryDataServiceHolder: BinaryDataServiceHolder,
                                  val dsRemoteWebknossosClient: DSRemoteWebknossosClient,
                                  val dsRemoteTracingstoreClient: DSRemoteTracingstoreClient,
                                  mappingService: MappingService,
                                  config: DataStoreConfig,
                                  segmentIndexFileService: SegmentIndexFileService,
                                  adHocMeshServiceHolder: AdHocMeshServiceHolder)
    extends LazyLogging
    with FullMeshHelper
    with FoxImplicits
    with MeshMappingHelper {

  val binaryDataService: BinaryDataService = binaryDataServiceHolder.binaryDataService
  adHocMeshServiceHolder.dataStoreAdHocMeshConfig =
    (binaryDataService, mappingService, config.Datastore.AdHocMesh.timeout, config.Datastore.AdHocMesh.actorPoolSize)
  val adHocMeshService: AdHocMeshService = adHocMeshServiceHolder.dataStoreAdHocMeshService

  lazy val segmentSurfaceAreaCache: AlfuCache[(ObjectId, String, FullMeshRequest), Float] =
    AlfuCache(maxCapacity = 10000)

  def clearCache(datasetId: ObjectId, layerNameOpt: Option[String]): Int =
    segmentSurfaceAreaCache.clear {
      case (keyDatasetId, keyLayerName, _) =>
        keyDatasetId == datasetId && layerNameOpt.forall(_ == keyLayerName)
    }

  // Computes surface area for a segment by summing per-chunk areas, never building the
  // combined STL buffer (which overflows Int for large segments).
  def computeSurfaceArea(
      datasetId: ObjectId,
      dataSource: UsableDataSource,
      dataLayer: DataLayer,
      fullMeshRequest: FullMeshRequest)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Float] =
    if (fullMeshRequest.meshFileName.isDefined)
      for {
        stlChunks <- loadMeshChunksFromMeshFile(dataSource, dataLayer, fullMeshRequest)
      } yield stlChunks.map(surfaceAreaFromRawChunkStlBytes).sum
    else
      computeSurfaceAreaAdHoc(datasetId, dataSource, dataLayer, fullMeshRequest)

  private def computeSurfaceAreaAdHoc(
      datasetId: ObjectId,
      dataSource: UsableDataSource,
      dataLayer: DataLayer,
      fullMeshRequest: FullMeshRequest)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Float] =
    for {
      mag <- fullMeshRequest.mag.toFox ?~> Msg.Mag.neededForAdHoc
      segmentationLayer <- tryo(dataLayer.asInstanceOf[SegmentationLayer]).toFox ?~> Msg.Dataset.layerMustBeSegmentation
      hasSegmentIndexFile = segmentationLayer.attachments.flatMap(_.segmentIndex).isDefined
      verticesForChunks <- if (hasSegmentIndexFile)
        getAllAdHocChunksWithSegmentIndex(datasetId, dataSource, segmentationLayer, fullMeshRequest, mag)
      else {
        for {
          seedPosition <- fullMeshRequest.seedPosition.toFox ?~> Msg.Mag.neededForAdHoc
          chunks <- getAllAdHocChunksWithNeighborLogic(
            datasetId,
            dataSource,
            segmentationLayer,
            fullMeshRequest,
            VoxelPosition(seedPosition.x, seedPosition.y, seedPosition.z, mag),
            adHocChunkSize)
        } yield chunks
      }
    } yield verticesForChunks.map(adHocMeshToStl).map(surfaceAreaFromRawChunkStlBytes).sum

  def loadFor(datasetId: ObjectId,
              dataSource: UsableDataSource,
              dataLayer: DataLayer,
              fullMeshRequest: FullMeshRequest)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Array[Byte]] =
    if (fullMeshRequest.meshFileName.isDefined)
      loadFullMeshFromMeshFile(dataSource, dataLayer, fullMeshRequest)
    else
      loadFullMeshFromAdHoc(datasetId, dataSource, dataLayer, fullMeshRequest)

  private def loadFullMeshFromAdHoc(
      datasetId: ObjectId,
      dataSource: UsableDataSource,
      dataLayer: DataLayer,
      fullMeshRequest: FullMeshRequest)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Array[Byte]] =
    for {
      mag <- fullMeshRequest.mag.toFox ?~> Msg.Mag.neededForAdHoc
      segmentationLayer <- tryo(dataLayer.asInstanceOf[SegmentationLayer]).toFox ?~> Msg.Dataset.layerMustBeSegmentation
      hasSegmentIndexFile = segmentationLayer.attachments.flatMap(_.segmentIndex).isDefined
      before = Instant.now
      verticesForChunks <- if (hasSegmentIndexFile)
        getAllAdHocChunksWithSegmentIndex(datasetId, dataSource, segmentationLayer, fullMeshRequest, mag)
      else {
        for {
          seedPosition <- fullMeshRequest.seedPosition.toFox ?~> Msg.Mag.neededForAdHoc
          chunks <- getAllAdHocChunksWithNeighborLogic(
            datasetId,
            dataSource,
            segmentationLayer,
            fullMeshRequest,
            VoxelPosition(seedPosition.x, seedPosition.y, seedPosition.z, mag),
            adHocChunkSize)
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
      mag: Vec3Int,
  )(implicit ec: ExecutionContext, tc: TokenContext): Fox[List[Array[Float]]] =
    for {
      segmentIndexFileKey <- segmentIndexFileService.lookUpSegmentIndexFileKey(dataSource.id, segmentationLayer)
      segmentIds <- segmentIdsForAgglomerateIdIfNeeded(
        dataSource.id,
        segmentationLayer,
        fullMeshRequest.mappingName,
        fullMeshRequest.editableMappingTracingId,
        fullMeshRequest.annotationVersion,
        fullMeshRequest.segmentId,
        mappingNameForMeshFile = None,
        omitMissing = false
      )
      topLeftsNested: Seq[Array[Vec3Int]] <- Fox.serialCombined(segmentIds)(sId =>
        segmentIndexFileService.readSegmentIndex(segmentIndexFileKey, sId))
      topLefts: Array[Vec3Int] = topLeftsNested.toArray.flatten
      targetMagPositions = segmentIndexFileService.topLeftsToDistinctTargetMagBucketPositions(topLefts, mag)
      // Dispatch chunks to the actor pool keeping actorPoolSize requests in flight at a time.
      vertexChunksWithNeighbors: List[(Array[Float], List[Int])] <- Fox.batchCombined(
        targetMagPositions.toIndexedSeq,
        config.Datastore.AdHocMesh.actorPoolSize) { targetMagPosition =>
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
          fullMeshRequest.segmentId,
          dataSource.scale.factor,
          tc,
          fullMeshRequest.mappingName,
          fullMeshRequest.mappingType,
          fullMeshRequest.additionalCoordinates,
          fullMeshRequest.annotationVersion,
          findNeighbors = false,
        )
        adHocMeshService.requestAdHocMeshViaActor(adHocMeshRequest)
      }
      allVertices = vertexChunksWithNeighbors.map(_._1)
    } yield allVertices

  private def getAllAdHocChunksWithNeighborLogic(
      datasetId: ObjectId,
      dataSource: UsableDataSource,
      segmentationLayer: SegmentationLayer,
      fullMeshRequest: FullMeshRequest,
      topLeft: VoxelPosition,
      chunkSize: Vec3Int)(implicit ec: ExecutionContext, tc: TokenContext): Fox[List[Array[Float]]] = {
    // Iterative parallel BFS. Each wave dispatches all frontier positions concurrently
    // (in actorPoolSize batches) rather than serially one at a time.
    // visited is marked before dispatch so parallel wave members don't queue the same position.
    // visited does not need to be thread-safe: it is mutated only at the start of each
    // processFrontier call (before any concurrent work begins); Fox.combined only reads it
    // (via generateNextTopLeftsFromNeighbors.filterNot), and waves execute sequentially
    // via Fox.serialCombined, so no two writes ever race.
    val visited = collection.mutable.Set[VoxelPosition]()

    def processFrontier(frontier: List[VoxelPosition], acc: List[Array[Float]]): Fox[List[Array[Float]]] =
      if (frontier.isEmpty) Fox.successful(acc)
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
                fullMeshRequest.segmentId,
                dataSource.scale.factor,
                tc,
                fullMeshRequest.mappingName,
                fullMeshRequest.mappingType,
                fullMeshRequest.additionalCoordinates,
                fullMeshRequest.annotationVersion
              )
              adHocMeshService.requestAdHocMeshViaActor(adHocMeshRequest).map {
                case (vertices, neighborIds) =>
                  (vertices, generateNextTopLeftsFromNeighbors(position, neighborIds, chunkSize, visited))
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
  // Used both for serving the full mesh and for per-chunk surface-area computation.
  private def loadMeshChunksFromMeshFile(
      dataSource: UsableDataSource,
      dataLayer: DataLayer,
      fullMeshRequest: FullMeshRequest)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Seq[Array[Byte]]] =
    for {
      meshFileName <- fullMeshRequest.meshFileName.toFox ?~> Msg.Mesh.meshFileNameRequired
      meshFileKey <- meshFileService.lookUpMeshFileKey(dataSource.id, dataLayer, meshFileName)
      mappingNameForMeshFile <- meshFileService.mappingNameForMeshFile(meshFileKey)
      segmentIds <- segmentIdsForAgglomerateIdIfNeeded(
        dataSource.id,
        dataLayer,
        fullMeshRequest.mappingName,
        fullMeshRequest.editableMappingTracingId,
        fullMeshRequest.annotationVersion,
        fullMeshRequest.segmentId,
        mappingNameForMeshFile,
        omitMissing = false
      )
      vertexQuantizationBits <- meshFileService.getVertexQuantizationBits(meshFileKey)
      chunkInfos: WebknossosSegmentInfo <- meshFileService.listMeshChunksForSegmentsMerged(meshFileKey, segmentIds)
      selectedLod = fullMeshRequest.lod.getOrElse(0)
      allChunkRanges: List[MeshChunk] = chunkInfos.lods(selectedLod).chunks
      // Right now only the scale is used, so we only need to supply these values
      lodTransform = chunkInfos.lods(selectedLod).transform
      transform = Array(
        Array(lodTransform(0)(0), 0, 0),
        Array(0, lodTransform(1)(1), 0),
        Array(0, 0, lodTransform(2)(2))
      )
      stlEncodedChunks: Seq[Array[Byte]] <- Fox.serialCombined(allChunkRanges) { chunkRange: MeshChunk =>
        readMeshChunkAsStl(fullMeshRequest.segmentId, meshFileKey, chunkRange, transform, vertexQuantizationBits)
      }
    } yield stlEncodedChunks

  private def loadFullMeshFromMeshFile(
      dataSource: UsableDataSource,
      dataLayer: DataLayer,
      fullMeshRequest: FullMeshRequest)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Array[Byte]] =
    for {
      before <- Instant.nowFox
      stlEncodedChunks <- loadMeshChunksFromMeshFile(dataSource, dataLayer, fullMeshRequest)
      stlOutput = combineEncodedChunksToStl(stlEncodedChunks)
      _ = logMeshingDuration(before, "meshFile", stlOutput.length)
    } yield stlOutput

  private def readMeshChunkAsStl(
      segmentId: Long, // only used in neuroglancerPrecomputed case
      meshFileKey: MeshFileKey,
      chunkInfo: MeshChunk,
      transform: Array[Array[Double]],
      vertexQuantizationBits: Int)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Array[Byte]] =
    for {
      (dracoMeshChunkBytes, encoding) <- meshFileService.readMeshChunk(
        meshFileKey,
        List(MeshChunkDataRequest(chunkInfo.byteOffset, chunkInfo.byteSize, Some(segmentId)))
      ) ?~> Msg.Mesh.File.loadChunkFailed
      _ <- Fox.fromBool(encoding == "draco") ?~> s"mesh file encoding is $encoding, only draco is supported"
      stlEncodedChunk <- getStlEncodedChunkFromDraco(chunkInfo, transform, dracoMeshChunkBytes, vertexQuantizationBits)
    } yield stlEncodedChunk

  private def getStlEncodedChunkFromDraco(
      chunkInfo: MeshChunk,
      transform: Array[Array[Double]],
      dracoBytes: Array[Byte],
      vertexQuantizationBits: Int)(implicit ec: ExecutionContext): Fox[Array[Byte]] =
    for {
      scale <- tryo(Vec3Double(transform(0)(0), transform(1)(1), transform(2)(2))).toFox ?~> "could not extract scale from mesh file transform attribute"
      stlEncodedChunk <- tryo(
        dracoToStlConverter.dracoToStl(dracoBytes,
                                       chunkInfo.position.x,
                                       chunkInfo.position.y,
                                       chunkInfo.position.z,
                                       scale.x,
                                       scale.y,
                                       scale.z,
                                       vertexQuantizationBits)).toFox
    } yield stlEncodedChunk

}
