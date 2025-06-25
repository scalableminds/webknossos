package com.scalableminds.webknossos.datastore.services.mesh

import com.scalableminds.util.geometry.Vec3Float
import com.scalableminds.util.tools.Box.tryo
import com.scalableminds.util.tools.{Box, Fox, FoxImplicits, Full}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.storage.{CachedHdf5File, Hdf5FileCache}
import jakarta.inject.Inject
import play.api.i18n.{Messages, MessagesProvider}

import java.nio.file.Paths
import scala.concurrent.ExecutionContext

class Hdf5MeshFileService @Inject()(config: DataStoreConfig) extends NeuroglancerMeshHelper with FoxImplicits {

  private val dataBaseDir = Paths.get(config.Datastore.baseDirectory)

  private lazy val fileHandleCache = new Hdf5FileCache(30)

  def mappingNameForMeshFile(meshFileKey: MeshFileKey): Box[Option[String]] = tryo {
    fileHandleCache
      .withCachedHdf5(meshFileKey.attachment) { cachedMeshFile =>
        cachedMeshFile.mappingName
      }
      .toOption
      .flatMap { value =>
        Option(value) // catch null
      }
  }

  private def readMeshFileMetadata(meshFileKey: MeshFileKey): Box[(String, Double, Array[Array[Double]])] =
    fileHandleCache.withCachedHdf5(meshFileKey.attachment) { cachedMeshFile =>
      val lodScaleMultiplier = cachedMeshFile.float64Reader.getAttr("/", "lod_scale_multiplier")
      val transform = cachedMeshFile.float64Reader.getMatrixAttr("/", "transform")
      (cachedMeshFile.meshFormat, lodScaleMultiplier, transform)
    }

  private def listMeshChunksForSegmentsNested(meshFileKey: MeshFileKey,
                                              segmentIds: Seq[Long],
                                              lodScaleMultiplier: Double,
                                              transform: Array[Array[Double]]): List[List[MeshLodInfo]] =
    fileHandleCache
      .withCachedHdf5(meshFileKey.attachment) { cachedMeshFile: CachedHdf5File =>
        segmentIds.toList.flatMap(segmentId =>
          listMeshChunksForSegment(cachedMeshFile, segmentId, lodScaleMultiplier, transform))
      }
      .toOption
      .getOrElse(List.empty)

  private def listMeshChunksForSegment(cachedMeshFile: CachedHdf5File,
                                       segmentId: Long,
                                       lodScaleMultiplier: Double,
                                       transform: Array[Array[Double]]): Box[List[MeshLodInfo]] =
    tryo {
      val (neuroglancerSegmentManifestStart, neuroglancerSegmentManifestEnd) =
        getNeuroglancerSegmentManifestOffsets(segmentId, cachedMeshFile)

      val manifestBytes = cachedMeshFile.uint8Reader.readArrayBlockWithOffset(
        "/neuroglancer",
        (neuroglancerSegmentManifestEnd - neuroglancerSegmentManifestStart).toInt,
        neuroglancerSegmentManifestStart)
      val segmentManifest = NeuroglancerSegmentManifest.fromBytes(manifestBytes)
      enrichSegmentInfo(segmentManifest, lodScaleMultiplier, transform, neuroglancerSegmentManifestStart, segmentId)
    }

  private def getNeuroglancerSegmentManifestOffsets(segmentId: Long, cachedMeshFile: CachedHdf5File): (Long, Long) = {
    val bucketIndex = cachedMeshFile.hashFunction(segmentId) % cachedMeshFile.nBuckets
    val bucketOffsets = cachedMeshFile.uint64Reader.readArrayBlockWithOffset("bucket_offsets", 2, bucketIndex)
    val bucketStart = bucketOffsets(0)
    val bucketEnd = bucketOffsets(1)

    if (bucketEnd - bucketStart == 0) throw new Exception(s"No entry for segment $segmentId")

    val buckets = cachedMeshFile.uint64Reader.readMatrixBlockWithOffset("buckets",
                                                                        (bucketEnd - bucketStart + 1).toInt,
                                                                        3,
                                                                        bucketStart,
                                                                        0)

    val bucketLocalOffset = buckets.map(_(0)).indexOf(segmentId)
    if (bucketLocalOffset < 0) throw new Exception(s"SegmentId $segmentId not in bucket list")
    val neuroglancerStart = buckets(bucketLocalOffset)(1)
    val neuroglancerEnd = buckets(bucketLocalOffset)(2)

    (neuroglancerStart, neuroglancerEnd)
  }

  override def computeGlobalPosition(segmentInfo: NeuroglancerSegmentManifest,
                                     lod: Int,
                                     lodScaleMultiplier: Double,
                                     currentChunk: Int): Vec3Float =
    segmentInfo.gridOrigin + segmentInfo.chunkPositions(lod)(currentChunk).toVec3Float * segmentInfo.chunkShape * Math
      .pow(2, lod) * segmentInfo.lodScales(lod) * lodScaleMultiplier

  override def getLodTransform(segmentInfo: NeuroglancerSegmentManifest,
                               lodScaleMultiplier: Double,
                               transform: Array[Array[Double]],
                               lod: Int): Array[Array[Double]] = transform

  def versionForMeshFile(meshFileKey: MeshFileKey): Long =
    fileHandleCache
      .withCachedHdf5(meshFileKey.attachment) { cachedMeshFile =>
        cachedMeshFile.artifactSchemaVersion
      }
      .toOption
      .getOrElse(0)

  def readMeshChunk(meshFileKey: MeshFileKey,
                    meshChunkDataRequests: Seq[MeshChunkDataRequest]): Box[(Array[Byte], String)] =
    for {
      resultBox <- fileHandleCache.withCachedHdf5(meshFileKey.attachment) { cachedMeshFile =>
        readMeshChunkFromCachedMeshFile(cachedMeshFile, meshChunkDataRequests)
      }
      (output, encoding) <- resultBox
    } yield (output, encoding)

  private def readMeshChunkFromCachedMeshFile(
      cachedMeshFile: CachedHdf5File,
      meshChunkDataRequests: Seq[MeshChunkDataRequest]): Box[(Array[Byte], String)] = {
    val meshFormat = cachedMeshFile.meshFormat
    // Sort the requests by byte offset to optimize for spinning disk access
    val requestsReordered =
      meshChunkDataRequests.zipWithIndex.sortBy(requestAndIndex => requestAndIndex._1.byteOffset).toList
    val data: List[(Array[Byte], Int)] = requestsReordered.map { requestAndIndex =>
      val meshChunkDataRequest = requestAndIndex._1
      val data =
        cachedMeshFile.uint8Reader.readArrayBlockWithOffset("neuroglancer",
                                                            meshChunkDataRequest.byteSize,
                                                            meshChunkDataRequest.byteOffset)
      (data, requestAndIndex._2)
    }
    val dataSorted = data.sortBy(d => d._2)
    Full((dataSorted.flatMap(d => d._1).toArray, meshFormat))
  }

  def listMeshChunksForMultipleSegments(meshFileKey: MeshFileKey, segmentIds: Seq[Long])(
      implicit ec: ExecutionContext,
      m: MessagesProvider): Fox[WebknossosSegmentInfo] =
    for {
      (meshFormat, lodScaleMultiplier, transform) <- readMeshFileMetadata(meshFileKey).toFox
      meshChunksForUnmappedSegments: List[List[MeshLodInfo]] = listMeshChunksForSegmentsNested(meshFileKey,
                                                                                               segmentIds,
                                                                                               lodScaleMultiplier,
                                                                                               transform)
      _ <- Fox.fromBool(meshChunksForUnmappedSegments.nonEmpty) ?~> "zero chunks" ?~> Messages(
        "mesh.file.listChunks.failed",
        segmentIds.mkString(","),
        meshFileKey.attachment.name)
      wkChunkInfos <- WebknossosSegmentInfo.fromMeshInfosAndMetadata(meshChunksForUnmappedSegments, meshFormat).toFox
    } yield wkChunkInfos

  def clearCache(dataSourceId: DataSourceId, layerNameOpt: Option[String]): Int = {
    val datasetPath = dataBaseDir.resolve(dataSourceId.organizationId).resolve(dataSourceId.directoryName)
    val relevantPath = layerNameOpt.map(l => datasetPath.resolve(l)).getOrElse(datasetPath)
    fileHandleCache.clear(key => key.startsWith(relevantPath.toString))
  }

}
