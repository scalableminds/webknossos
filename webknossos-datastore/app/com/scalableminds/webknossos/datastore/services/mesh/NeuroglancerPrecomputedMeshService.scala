package com.scalableminds.webknossos.datastore.services.mesh

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.Vec3Float
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.datareaders.precomputed.{PrecomputedHeader, ShardingSpecification}
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.datasource.{
  Category,
  DataFormat,
  DataLayer,
  DataLayerWithMagLocators,
  GenericDataSource
}
import com.scalableminds.webknossos.datastore.storage.{DataVaultService, RemoteSourceDescriptor}
import net.liftweb.common.Box.tryo
import play.api.libs.json.{Json, OFormat}

import java.net.URI
import java.nio.file.Paths
import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class NeuroglancerPrecomputedMeshInfo(
    lod_scale_multiplier: Double,
    transform: Array[Double],
    sharding: Option[ShardingSpecification],
    vertex_quantization_bits: Int,
)
object NeuroglancerPrecomputedMeshInfo {
  implicit val jsonFormat: OFormat[NeuroglancerPrecomputedMeshInfo] = Json.format[NeuroglancerPrecomputedMeshInfo]
}

class NeuroglancerPrecomputedMeshService @Inject()(config: DataStoreConfig, dataVaultService: DataVaultService)(
    implicit ec: ExecutionContext)
    extends FoxImplicits {

  private val dataBaseDir = Paths.get(config.Datastore.baseDirectory)

  private lazy val neuroglancerPrecomputedMeshInfoCache = AlfuCache[VaultPath, NeuroglancerPrecomputedMeshInfo](100)

  private def loadRemoteMeshInfo(meshPath: VaultPath)(implicit tc: TokenContext): Fox[NeuroglancerPrecomputedMeshInfo] =
    for {
      _ <- Fox.successful(())
      meshInfoPath = meshPath / NeuroglancerMesh.FILENAME_INFO
      meshInfo <- meshInfoPath.parseAsJson[NeuroglancerPrecomputedMeshInfo] ?~> "Failed to read mesh info"
    } yield meshInfo

  def exploreMeshes(organizationId: String, datasetName: String, dataLayerName: String)(
      implicit tc: TokenContext): Fox[Set[MeshFileInfo]] = {
    def exploreMeshesForLayer(dataLayer: DataLayer): Fox[(NeuroglancerPrecomputedMeshInfo, VaultPath)] =
      for {
        dataLayerWithMagLocators <- tryo(dataLayer.asInstanceOf[DataLayerWithMagLocators]).toFox ?~> "Invalid DataLayer: Expected DataLayer to have mag locators"
        firstMag <- dataLayerWithMagLocators.mags.headOption.toFox ?~> "No mags found"
        magPath <- firstMag.path.toFox ?~> "Mag has no path"
        remotePath <- dataVaultService.getVaultPath(RemoteSourceDescriptor(new URI(magPath), None))
        infoPath = remotePath.parent / PrecomputedHeader.FILENAME_INFO
        precomputedHeader <- infoPath
          .parseAsJson[PrecomputedHeader] ?~> s"Failed to read neuroglancer precomputed metadata at $infoPath"
        meshPath = remotePath.parent / precomputedHeader.meshPath
        meshInfo <- neuroglancerPrecomputedMeshInfoCache.getOrLoad(meshPath, loadRemoteMeshInfo)
      } yield (meshInfo, meshPath)

    def isDataLayerValid(d: DataLayer) =
      d.name == dataLayerName && d.category == Category.segmentation && d.dataFormat == DataFormat.neuroglancerPrecomputed

    val datasetDir = dataBaseDir.resolve(organizationId).resolve(datasetName)
    val datasetPropertiesFile = datasetDir.resolve(GenericDataSource.FILENAME_DATASOURCE_PROPERTIES_JSON)
    for {
      datasetProperties <- JsonHelper
        .validatedJsonFromFile[GenericDataSource[DataLayer]](datasetPropertiesFile, datasetDir)
        .toFox
      meshInfosAndInfoPaths = datasetProperties.dataLayers.filter(isDataLayerValid).map(exploreMeshesForLayer)
      meshInfosResolved: List[(NeuroglancerPrecomputedMeshInfo, VaultPath)] <- Fox
        .sequenceOfFulls(meshInfosAndInfoPaths)
        .toFox
    } yield
      meshInfosResolved
        .map({
          case (_, vaultPath) =>
            MeshFileInfo(NeuroglancerMesh.meshName,
                         Some(vaultPath.toString),
                         Some(NeuroglancerMesh.meshTypeName),
                         None,
                         NeuroglancerMesh.meshInfoVersion)
        })
        .toSet
  }

  private def enrichSegmentInfo(segmentInfo: NeuroglancerSegmentManifest,
                                lodScaleMultiplier: Double,
                                neuroglancerOffsetStart: Long,
                                segmentId: Long,
                                storedToModelSpaceTransform: Array[Double]): MeshSegmentInfo = {
    val bytesPerLod = segmentInfo.chunkByteSizes.map(_.sum)
    val totalMeshSize = bytesPerLod.sum
    val meshByteStartOffset = neuroglancerOffsetStart - totalMeshSize
    val chunkByteOffsetsInLod = segmentInfo.chunkByteSizes.map(_.scanLeft(0L)(_ + _)) // builds cumulative sum

    def getChunkByteOffset(lod: Int, currentChunk: Int): Long =
      // get past the finer lods first, then take offset in selected lod
      bytesPerLod.take(lod).sum + chunkByteOffsetsInLod(lod)(currentChunk)

    def computeGlobalPositionAndOffset(lod: Int, currentChunk: Int): MeshChunk = {
      val globalPosition = segmentInfo.chunkPositions(lod)(currentChunk).toVec3Float

      MeshChunk(
        position = globalPosition,
        byteOffset = meshByteStartOffset + getChunkByteOffset(lod, currentChunk),
        byteSize = segmentInfo.chunkByteSizes(lod)(currentChunk).toInt, // size must be int32 to fit in java array
        unmappedSegmentId = Some(segmentId)
      )
    }

    val lods: Seq[Int] = for (lod <- 0 until segmentInfo.numLods) yield lod

    def chunkCountsWithLod(lod: Int): IndexedSeq[(Int, Int)] =
      for (currentChunk <- 0 until segmentInfo.numChunksPerLod(lod))
        yield (lod, currentChunk)

    val chunks = lods.map(lod => chunkCountsWithLod(lod).map(x => computeGlobalPositionAndOffset(x._1, x._2)).toList)

    val baseScale = Vec3Float(1, 1, 1) * lodScaleMultiplier * segmentInfo.chunkShape

    val meshfileLods = lods
      .map(
        lod =>
          MeshLodInfo(
            scale = 1, // Not used here, applied in the transform
            vertexOffset = segmentInfo.vertexOffsets(lod), // Not currently used by the frontend, thus we apply it in the transform
            chunkShape = segmentInfo.chunkShape, // Not currently used by the frontend, thus we apply it in the transform
            chunks = chunks(lod),
            transform = Array(
              Array(
                baseScale.x * storedToModelSpaceTransform(0) * segmentInfo.lodScales(lod),
                storedToModelSpaceTransform(1),
                storedToModelSpaceTransform(2),
                storedToModelSpaceTransform(3) + segmentInfo.gridOrigin.x + segmentInfo.vertexOffsets(lod).x
              ),
              Array(
                storedToModelSpaceTransform(4),
                baseScale.y * storedToModelSpaceTransform(5) * segmentInfo.lodScales(lod),
                storedToModelSpaceTransform(6),
                storedToModelSpaceTransform(7) + segmentInfo.gridOrigin.y + segmentInfo.vertexOffsets(lod).y
              ),
              Array(
                storedToModelSpaceTransform(8),
                storedToModelSpaceTransform(9),
                baseScale.z * storedToModelSpaceTransform(10) * segmentInfo.lodScales(lod),
                storedToModelSpaceTransform(11) + segmentInfo.gridOrigin.z + segmentInfo.vertexOffsets(lod).z
              ),
              Array(0.0, 0.0, 0.0, 1.0)
            )
        ))
      .toList
    MeshSegmentInfo(chunkShape = segmentInfo.chunkShape, gridOrigin = segmentInfo.gridOrigin, lods = meshfileLods)
  }

  def listMeshChunksForMultipleSegments(meshFilePathOpt: Option[String], segmentId: List[Long])(
      implicit tc: TokenContext): Fox[WebknossosSegmentInfo] =
    for {
      meshFilePath <- meshFilePathOpt.toFox ?~> "No mesh file path provided"
      vaultPath <- dataVaultService.getVaultPath(RemoteSourceDescriptor(new URI(meshFilePath), None))
      meshInfo <- neuroglancerPrecomputedMeshInfoCache.getOrLoad(vaultPath, loadRemoteMeshInfo)
      mesh = NeuroglancerMesh(meshInfo)
      chunkScale = Array.fill(3)(1 / math.pow(2, meshInfo.vertex_quantization_bits))
      meshSegmentInfos <- Fox.serialCombined(segmentId)(id => listMeshChunks(vaultPath, mesh, id))
      baseTransform = Array(Array(1.0, 0.0, 0.0, 0.0),
                            Array(0.0, 1.0, 0.0, 0.0),
                            Array(0.0, 0.0, 1.0, 0.0),
                            Array(0.0, 0.0, 0.0, 1.0))
      segmentInfo <- WebknossosSegmentInfo.fromMeshInfosAndMetadata(meshSegmentInfos,
                                                                    NeuroglancerMesh.meshEncoding,
                                                                    baseTransform,
                                                                    chunkScale)
    } yield segmentInfo

  private def listMeshChunks(vaultPath: VaultPath, mesh: NeuroglancerMesh, segmentId: Long)(
      implicit tc: TokenContext): Fox[MeshSegmentInfo] =
    for {
      _ <- Fox.successful(())
      minishardInfo = mesh.shardingSpecification.getMinishardInfo(segmentId)
      shardUrl = mesh.shardingSpecification.getPathForShard(vaultPath, minishardInfo._1)
      minishardIndex <- mesh.getMinishardIndex(shardUrl, minishardInfo._2.toInt)
      chunkRange <- mesh.getChunkRange(segmentId, minishardIndex)
      chunk <- mesh.getChunk(chunkRange, shardUrl)
      segmentManifest = NeuroglancerSegmentManifest.fromBytes(chunk)
      meshSegmentInfo = enrichSegmentInfo(segmentManifest,
                                          mesh.meshInfo.lod_scale_multiplier,
                                          chunkRange.start,
                                          segmentId,
                                          mesh.meshInfo.transform)
    } yield meshSegmentInfo

  def readMeshChunk(meshFilePathOpt: Option[String], meshChunkDataRequests: Seq[MeshChunkDataRequest])(
      implicit tc: TokenContext): Fox[(Array[Byte], String)] =
    for {
      meshFilePath <- meshFilePathOpt.toFox ?~> "Mesh file path is required"
      vaultPath <- dataVaultService.getVaultPath(RemoteSourceDescriptor(new URI(meshFilePath), None))
      meshInfo <- neuroglancerPrecomputedMeshInfoCache.getOrLoad(vaultPath, loadRemoteMeshInfo)
      mesh = NeuroglancerMesh(meshInfo)

      segmentId <- Fox.option2Fox(meshChunkDataRequests.head.segmentId) ?~> "Segment id parameter is required" // This assumes that all requests are for the same segment

      minishardInfo = mesh.shardingSpecification.getMinishardInfo(segmentId)
      shardUrl = mesh.shardingSpecification.getPathForShard(vaultPath, minishardInfo._1)
      chunks <- Fox.serialCombined(meshChunkDataRequests.toList)(request =>
        shardUrl.readBytes(Some(request.byteOffset until request.byteOffset + request.byteSize)))
      output = chunks.flatten.toArray
    } yield (output, NeuroglancerMesh.meshEncoding)

  def getVertexQuantizationBits(meshFilePathOpt: Option[String])(implicit tc: TokenContext): Fox[Int] =
    for {
      meshFilePath <- meshFilePathOpt.toFox ?~> "Mesh file path is required"
      vaultPath <- dataVaultService.getVaultPath(RemoteSourceDescriptor(new URI(meshFilePath), None))
      meshInfo <- neuroglancerPrecomputedMeshInfoCache.getOrLoad(vaultPath, loadRemoteMeshInfo)
    } yield meshInfo.vertex_quantization_bits

}
