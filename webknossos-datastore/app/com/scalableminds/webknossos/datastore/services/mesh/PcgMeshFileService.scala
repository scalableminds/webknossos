package com.scalableminds.webknossos.datastore.services.mesh

import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.box.Box.tryo
import com.scalableminds.util.box.{Box, Empty, Failure, Full}
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.Vec3Float
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.datavault.{ByteRange, VaultPath}
import com.scalableminds.webknossos.datastore.helpers.{UPath, UnsignedLong}
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.services.mapping.{PcgClient, PcgMeshInfo}
import com.scalableminds.webknossos.datastore.storage.DataVaultService

import javax.inject.Inject
import scala.concurrent.ExecutionContext

/** One fragment of a CAVE mesh. CAVE has no mesh per supervoxel. It stores one mesh per graph node of a chunk, and the
  * mesh of an agglomerate is the set of node meshes its meshing service lists for it.
  */
private case class PcgMeshFragment(nodeId: Long, location: PcgMeshFragmentLocation) {
  def byteSize: Int = location match {
    case ShardedPcgMeshFragment(_, _, byteSize) => byteSize
    case UnshardedPcgMeshFragment(bytes)        => bytes.length
  }
}

private sealed trait PcgMeshFragmentLocation

// A byte range in a shard file below `initial`, as the meshing service resolved it.
private case class ShardedPcgMeshFragment(shardPath: VaultPath, byteOffset: Long, byteSize: Int)
    extends PcgMeshFragmentLocation

// A whole file in the unsharded mesh directory. It is read while listing, because only reading it tells its size.
private case class UnshardedPcgMeshFragment(bytes: Array[Byte]) extends PcgMeshFragmentLocation

/** Serves the precomputed meshes of a CAVE graph for the agglomerates of the PCG mapping with the same name. The mesh
  * attachment has data format pcg and the same path (the PCG API url) and credential as the agglomerate attachment.
  *
  * The fragments are draco meshes in absolute nanometer coordinates, so every chunk is placed at the origin with the
  * identity transform. The mesh chunk requests of the frontend only carry the agglomerate id, a byte offset and a byte
  * size. So the byte offset of a chunk is the index of its fragment in the agglomerate's fragment list, sorted by name.
  * The list of an agglomerate id does not change, since edits create new agglomerate ids.
  */
class PcgMeshFileService @Inject() (pcgClient: PcgClient, dataVaultService: DataVaultService)(implicit
    ec: ExecutionContext
) {

  private lazy val meshDirectoryCache = AlfuCache[MeshFileKey, (VaultPath, PcgMeshInfo)](maxCapacity = 100)

  // Weighed in KiB, since the unsharded fragments are cached with their bytes, and a heavily edited agglomerate can
  // have hundreds of them.
  private lazy val fragmentsCache = AlfuCache[(MeshFileKey, Long), Seq[PcgMeshFragment]](
    maxCapacity = 256 * 1024,
    weighFn = Some((_, fragmentsBox) => 1 + fragmentsBox.toOption.map(cachedBytes).getOrElse(0) / 1024)
  )

  private def cachedBytes(fragments: Seq[PcgMeshFragment]): Int =
    fragments.map(_.location).collect { case UnshardedPcgMeshFragment(bytes) => bytes.length }.sum

  private val identityTransform: Array[Array[Double]] =
    Array(Array(1.0, 0.0, 0.0, 0.0), Array(0.0, 1.0, 0.0, 0.0), Array(0.0, 0.0, 1.0, 0.0))

  def mappingNameForMeshFile(meshFileKey: MeshFileKey): Option[String] = Some(meshFileKey.attachment.name)

  private def meshDirectory(meshFileKey: MeshFileKey)(using ec: ExecutionContext): Fox[(VaultPath, PcgMeshInfo)] =
    meshDirectoryCache.getOrLoad(
      meshFileKey,
      key =>
        for {
          meshInfo <- pcgClient.getMeshInfo(key.attachment)
          meshDirectoryPath <- UPath
            .fromString(s"${meshInfo.dataDirectory.stripSuffix("/")}/${meshInfo.meshDirectory}")
            .toFox
          vaultPath <- dataVaultService.vaultPathFor(meshDirectoryPath)
        } yield (vaultPath, meshInfo)
    )

  private def fragments(meshFileKey: MeshFileKey, agglomerateId: Long)(using
      tc: TokenContext
  ): Fox[Seq[PcgMeshFragment]] =
    fragmentsCache.getOrLoad(
      (meshFileKey, agglomerateId),
      _ =>
        for {
          (directory, meshInfo) <- meshDirectory(meshFileKey)
          fragmentNames <- pcgClient.getMeshManifest(meshFileKey.attachment, agglomerateId)
          fragments <- Fox.combined(fragmentNames.sorted.map(loadFragment(directory, meshInfo, _)))
        } yield fragments
    )

  /** Parses a fragment as the meshing service lists it, `~<node id>:<location>`. The location is either
    * `~<layer>/<shard file>:<byte offset>:<byte size>` below `initial`, or the name of a file in the unsharded
    * directory.
    */
  private def loadFragment(directory: VaultPath, meshInfo: PcgMeshInfo, fragment: String)(using
      tc: TokenContext
  ): Fox[PcgMeshFragment] =
    fragment.stripPrefix("~").split(":", 2) match {
      case Array(nodeIdLiteral, location) =>
        for {
          nodeId <- tryo(java.lang.Long.parseUnsignedLong(nodeIdLiteral)).toFox
          fragmentLocation <-
            if (location.startsWith("~")) parseShardedLocation(directory, location.drop(1)).toFox
            else (directory / meshInfo.unshardedMeshDirectory / location).readBytes().map(UnshardedPcgMeshFragment(_))
        } yield PcgMeshFragment(nodeId, fragmentLocation)
      case _ => Fox.failure(Msg.Mesh.File.Pcg.invalidFragment(fragment))
    }

  private def parseShardedLocation(directory: VaultPath, location: String): Box[ShardedPcgMeshFragment] =
    location.split(":") match {
      case Array(shardFile, byteOffset, byteSize) =>
        for {
          offset <- tryo(byteOffset.toLong)
          size <- tryo(byteSize.toInt)
        } yield ShardedPcgMeshFragment(directory / "initial" / shardFile, offset, size)
      case _ => Failure(Msg.Mesh.File.Pcg.invalidFragment(location))
    }

  def listMeshChunksForMultipleSegments(meshFileKey: MeshFileKey, agglomerateIds: Seq[Long], failOnZeroChunks: Boolean)(
      using tc: TokenContext
  ): Fox[WebknossosSegmentInfo] =
    for {
      lookups <- Fox.serialCombined(agglomerateIds)(agglomerateId =>
        fragments(meshFileKey, agglomerateId).shiftBox.map(fragmentsBox =>
          SegmentMeshLookup.fromBox(agglomerateId, fragmentsBox.flatMap(lodsForFragments))
        )
      )
      foundLookups = lookups.flatten
      _ <- Fox.fromBool(foundLookups.exists(_.hasEntry) || !failOnZeroChunks) ?~>
        Msg.Mesh.File.zeroChunks(agglomerateIds.mkString(","), meshFileKey.attachment.name)
      segmentInfo <- WebknossosSegmentInfo.fromSegmentLookups(foundLookups, NeuroglancerMesh.meshEncoding).toFox
    } yield segmentInfo

  // Empty if the agglomerate has no mesh fragments, which SegmentMeshLookup reads as "no mesh".
  private def lodsForFragments(fragments: Seq[PcgMeshFragment]): Box[List[MeshLodInfo]] =
    if (fragments.isEmpty) Empty
    else {
      val chunks = fragments.zipWithIndex.map { case (fragment, index) =>
        MeshChunk(Vec3Float(0, 0, 0), index.toLong, fragment.byteSize, UnsignedLong(fragment.nodeId))
      }
      Full(List(MeshLodInfo(chunks.toList, identityTransform)))
    }

  def readMeshChunk(meshFileKey: MeshFileKey, meshChunkDataRequests: Seq[MeshChunkDataRequest])(using
      tc: TokenContext
  ): Fox[(Array[Byte], String)] =
    for {
      agglomerateIds <- Fox.successful(meshChunkDataRequests.flatMap(_.segmentId).distinct)
      agglomerateId <- agglomerateIds match {
        case Seq(id) => Fox.successful(id.toLong)
        case _       => Fox.failure(Msg.Mesh.File.Pcg.oneAgglomeratePerChunkRequest)
      }
      fragments <- fragments(meshFileKey, agglomerateId)
      chunks <- Fox.combined(meshChunkDataRequests.map(readFragment(fragments, _)))
    } yield (chunks.flatten.toArray, NeuroglancerMesh.meshEncoding)

  private def readFragment(fragments: Seq[PcgMeshFragment], request: MeshChunkDataRequest)(using
      tc: TokenContext
  ): Fox[Array[Byte]] =
    for {
      fragment <- fragments.lift(request.byteOffset.toInt).toFox ?~> Msg.Mesh.File.Pcg.unknownChunk(request.byteOffset)
      _ <- Fox.fromBool(fragment.byteSize == request.byteSize) ?~> Msg.Mesh.File.Pcg.unknownChunk(request.byteOffset)
      bytes <- fragment.location match {
        case ShardedPcgMeshFragment(shardPath, byteOffset, byteSize) =>
          shardPath.readBytes(ByteRange.startEndExclusive(byteOffset, byteOffset + byteSize))
        case UnshardedPcgMeshFragment(bytes) => Fox.successful(bytes)
      }
    } yield bytes

  def clearCache(dataSourceId: DataSourceId, layerNameOpt: Option[String]): Int = {
    def matches(meshFileKey: MeshFileKey) =
      meshFileKey.dataSourceId == dataSourceId && layerNameOpt.forall(meshFileKey.layerName == _)
    meshDirectoryCache.clear(matches) + fragmentsCache.clear { case (meshFileKey, _) => matches(meshFileKey) }
  }
}
