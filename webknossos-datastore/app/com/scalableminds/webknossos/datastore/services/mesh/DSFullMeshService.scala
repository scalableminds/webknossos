package com.scalableminds.webknossos.datastore.services.mesh

import com.google.inject.Inject
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.models.datasource.{DataSource, SegmentationLayer}
import com.scalableminds.webknossos.datastore.models.requests.Cuboid
import com.scalableminds.webknossos.datastore.models.{AdditionalCoordinate, VoxelPosition}
import com.scalableminds.webknossos.datastore.services._
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box.tryo
import play.api.i18n.MessagesProvider
import play.api.libs.json.{Json, OFormat}

import scala.concurrent.ExecutionContext

case class FullMeshRequest(
    meshFileName: Option[String], // None means ad-hoc meshing
    lod: Option[Int],
    segmentId: Long, // if mappingName is set, this is an agglomerate id
    mappingName: Option[String],
    mappingType: Option[String], // json, agglomerate, editableMapping
    editableMappingTracingId: Option[String],
    mag: Option[Vec3Int], // required for ad-hoc meshing
    seedPosition: Option[Vec3Int], // required for ad-hoc meshing
    additionalCoordinates: Option[Seq[AdditionalCoordinate]],
    meshFilePath: Option[String], // required for remote neuroglancer precomputed mesh files
    meshFileType: Option[String]
)

object FullMeshRequest {
  implicit val jsonFormat: OFormat[FullMeshRequest] = Json.format[FullMeshRequest]
}

class DSFullMeshService @Inject()(dataSourceRepository: DataSourceRepository,
                                  meshFileService: MeshFileService,
                                  val binaryDataServiceHolder: BinaryDataServiceHolder,
                                  val dsRemoteWebknossosClient: DSRemoteWebknossosClient,
                                  val dsRemoteTracingstoreClient: DSRemoteTracingstoreClient,
                                  mappingService: MappingService,
                                  config: DataStoreConfig,
                                  adHocMeshServiceHolder: AdHocMeshServiceHolder)
    extends LazyLogging
    with FullMeshHelper
    with FoxImplicits
    with MeshMappingHelper {

  val binaryDataService: BinaryDataService = binaryDataServiceHolder.binaryDataService
  adHocMeshServiceHolder.dataStoreAdHocMeshConfig =
    (binaryDataService, mappingService, config.Datastore.AdHocMesh.timeout, config.Datastore.AdHocMesh.actorPoolSize)
  val adHocMeshService: AdHocMeshService = adHocMeshServiceHolder.dataStoreAdHocMeshService

  def loadFor(organizationId: String,
              datasetDirectoryName: String,
              dataLayerName: String,
              fullMeshRequest: FullMeshRequest)(implicit ec: ExecutionContext,
                                                m: MessagesProvider,
                                                tc: TokenContext): Fox[Array[Byte]] =
    if (fullMeshRequest.meshFileName.isDefined)
      loadFullMeshFromMeshfile(organizationId, datasetDirectoryName, dataLayerName, fullMeshRequest)
    else
      loadFullMeshFromAdHoc(organizationId, datasetDirectoryName, dataLayerName, fullMeshRequest)

  private def loadFullMeshFromAdHoc(organizationId: String,
                                    datasetName: String,
                                    dataLayerName: String,
                                    fullMeshRequest: FullMeshRequest)(implicit ec: ExecutionContext,
                                                                      m: MessagesProvider,
                                                                      tc: TokenContext): Fox[Array[Byte]] =
    for {
      mag <- fullMeshRequest.mag.toFox ?~> "mag.neededForAdHoc"
      seedPosition <- fullMeshRequest.seedPosition.toFox ?~> "seedPosition.neededForAdHoc"
      (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationId,
                                                                                datasetName,
                                                                                dataLayerName)
      segmentationLayer <- tryo(dataLayer.asInstanceOf[SegmentationLayer]).toFox ?~> "dataLayer.mustBeSegmentation"
      before = Instant.now
      verticesForChunks <- getAllAdHocChunks(dataSource,
                                             segmentationLayer,
                                             fullMeshRequest,
                                             VoxelPosition(seedPosition.x, seedPosition.y, seedPosition.z, mag),
                                             adHocChunkSize)
      encoded = verticesForChunks.map(adHocMeshToStl)
      array = combineEncodedChunksToStl(encoded)
      _ = logMeshingDuration(before, "ad-hoc meshing", array.length)
    } yield array

  private def getAllAdHocChunks(
      dataSource: DataSource,
      segmentationLayer: SegmentationLayer,
      fullMeshRequest: FullMeshRequest,
      topLeft: VoxelPosition,
      chunkSize: Vec3Int,
      visited: collection.mutable.Set[VoxelPosition] = collection.mutable.Set[VoxelPosition]())(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[List[Array[Float]]] = {
    val adHocMeshRequest = AdHocMeshRequest(
      Some(dataSource.id),
      segmentationLayer,
      Cuboid(topLeft, chunkSize.x + 1, chunkSize.y + 1, chunkSize.z + 1),
      fullMeshRequest.segmentId,
      dataSource.scale.factor,
      tc,
      fullMeshRequest.mappingName,
      fullMeshRequest.mappingType,
      fullMeshRequest.additionalCoordinates
    )
    visited += topLeft
    for {
      (vertices: Array[Float], neighbors) <- adHocMeshService.requestAdHocMeshViaActor(adHocMeshRequest)
      nextPositions: List[VoxelPosition] = generateNextTopLeftsFromNeighbors(topLeft, neighbors, chunkSize, visited)
      _ = visited ++= nextPositions
      neighborVerticesNested <- Fox.serialCombined(nextPositions) { position: VoxelPosition =>
        getAllAdHocChunks(dataSource, segmentationLayer, fullMeshRequest, position, chunkSize, visited)
      }
      allVertices: List[Array[Float]] = vertices +: neighborVerticesNested.flatten
    } yield allVertices
  }

  // TODO make sure this also works for the remote neuroglancer variant. if so, delete other implementation
  private def loadFullMeshFromMeshfile(organizationId: String,
                                       datasetDirectoryName: String,
                                       dataLayerName: String,
                                       fullMeshRequest: FullMeshRequest)(implicit ec: ExecutionContext,
                                                                         m: MessagesProvider,
                                                                         tc: TokenContext): Fox[Array[Byte]] =
    for {
      before <- Instant.nowFox
      (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationId,
                                                                                datasetDirectoryName,
                                                                                dataLayerName)
      meshFileName <- fullMeshRequest.meshFileName.toFox ?~> "meshFileName.required"
      meshFileKey <- meshFileService.lookUpMeshFile(dataSource.id, dataLayer, meshFileName)
      mappingNameForMeshFile <- meshFileService.mappingNameForMeshFile(meshFileKey)
      segmentIds <- segmentIdsForAgglomerateIdIfNeeded(
        dataSource.id,
        dataLayer,
        fullMeshRequest.mappingName,
        fullMeshRequest.editableMappingTracingId,
        fullMeshRequest.segmentId,
        mappingNameForMeshFile,
        omitMissing = false
      )
      chunkInfos: WebknossosSegmentInfo <- meshFileService.listMeshChunksForSegmentsMerged(meshFileKey, segmentIds)
      allChunkRanges: List[MeshChunk] = chunkInfos.lods.head.chunks
      transform = chunkInfos.lods.head.transform
      stlEncodedChunks: Seq[Array[Byte]] <- Fox.serialCombined(allChunkRanges) { chunkRange: MeshChunk =>
        readMeshChunkAsStl(meshFileKey, chunkRange, transform)
      }
      stlOutput = combineEncodedChunksToStl(stlEncodedChunks)
      _ = logMeshingDuration(before, "meshfile", stlOutput.length)
    } yield stlOutput

  private def readMeshChunkAsStl(meshFileKey: MeshfileKey, chunkInfo: MeshChunk, transform: Array[Array[Double]])(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[Array[Byte]] =
    for {
      (dracoMeshChunkBytes, encoding) <- meshFileService.readMeshChunk(
        meshFileKey,
        List(MeshChunkDataRequest(chunkInfo.byteOffset, chunkInfo.byteSize, None))
      ) ?~> "mesh.file.loadChunk.failed"
      _ <- Fox.fromBool(encoding == "draco") ?~> s"mesh file encoding is $encoding, only draco is supported"
      stlEncodedChunk <- getStlEncodedChunkFromDraco(chunkInfo, transform, dracoMeshChunkBytes)
    } yield stlEncodedChunk

  /*
  // TODO delete if above works also for neuroglancer
  private def loadFullMeshFromRemoteNeuroglancerMeshFile(meshFileKey: MeshfileKey, fullMeshRequest: FullMeshRequest)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[Array[Byte]] =
    for {
      chunkInfos: WebknossosSegmentInfo <- neuroglancerPrecomputedMeshService.listMeshChunksForMultipleSegments(
        meshFileKey,
        List(fullMeshRequest.segmentId)
      )
      _ <- Fox.fromBool(fullMeshRequest.mappingName.isEmpty) ?~> "Mapping is not supported for remote neuroglancer mesh files"
      selectedLod = fullMeshRequest.lod.getOrElse(0)
      allChunkRanges: List[MeshChunk] = chunkInfos.lods(selectedLod).chunks
      meshFileName <- fullMeshRequest.meshFileName.toFox ?~> "mesh file name needed"
      // Right now only the scale is used, so we only need to supply these values
      lodTransform = chunkInfos.lods(selectedLod).transform
      transform = Array(
        Array(lodTransform(0)(0), 0, 0),
        Array(0, lodTransform(1)(1), 0),
        Array(0, 0, lodTransform(2)(2))
      )
      vertexQuantizationBits <- neuroglancerPrecomputedMeshService.getVertexQuantizationBits(meshFileKey)
      stlEncodedChunks: Seq[Array[Byte]] <- Fox.serialCombined(allChunkRanges) { chunkRange: MeshChunk =>
        readNeuroglancerPrecomputedMeshChunkAsStl(
          meshFileKey,
          chunkRange,
          transform,
          Some(fullMeshRequest.segmentId),
          vertexQuantizationBits
        )
      }
      stlOutput = combineEncodedChunksToStl(stlEncodedChunks)
    } yield stlOutput

  private def readNeuroglancerPrecomputedMeshChunkAsStl(
                                                         meshFileKey: MeshfileKey,
                                                         chunkInfo: MeshChunk,
                                                         transform: Array[Array[Double]],
                                                         segmentId: Option[Long],
                                                         vertexQuantizationBits: Int)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Array[Byte]] =
    for {
      (dracoMeshChunkBytes, encoding) <- meshFileService.readMeshChunk(
        meshFileKey,
        Seq(MeshChunkDataRequest(chunkInfo.byteOffset, chunkInfo.byteSize, segmentId))
      ) ?~> "mesh.file.loadChunk.failed"
      _ <- Fox.fromBool(encoding == "draco") ?~> s"mesh file encoding is $encoding, only draco is supported"
      stlEncodedChunk <- getStlEncodedChunkFromDraco(chunkInfo, transform, dracoMeshChunkBytes, vertexQuantizationBits)
    } yield stlEncodedChunk


   */

  private def getStlEncodedChunkFromDraco(
      chunkInfo: MeshChunk,
      transform: Array[Array[Double]],
      dracoBytes: Array[Byte],
      vertexQuantizationBits: Int = 0)(implicit ec: ExecutionContext): Fox[Array[Byte]] =
    for {
      scale <- tryo(Vec3Double(transform(0)(0), transform(1)(1), transform(2)(2))).toFox ?~> "could not extract scale from meshfile transform attribute"
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
