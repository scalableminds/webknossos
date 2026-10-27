package com.scalableminds.webknossos.datastore.services.mesh

import com.scalableminds.util.Msg
import com.scalableminds.util.box.{Box, Full}
import com.scalableminds.util.geometry.Vec3Float
import com.scalableminds.util.box.Box.tryo
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.storage.{CachedHdf5File, Hdf5FileCache}
import jakarta.inject.Inject

import scala.concurrent.ExecutionContext

class Hdf5MeshFileService @Inject() extends NeuroglancerMeshHelper with MeshFileUtils {

  private lazy val fileHandleCache = new Hdf5FileCache(30)

  def mappingNameForMeshFile(meshFileKey: MeshFileKey): Box[Option[String]] = tryo {
    fileHandleCache
      .withCachedHdf5(meshFileKey) { cachedMeshFile =>
        cachedMeshFile.mappingName
      }
      .toOption
      .flatMap { value =>
        Option(value) // catch null
      }
  }

  private def readMeshFileMetadata(meshFileKey: MeshFileKey): Box[(String, Double, Array[Array[Double]])] =
    fileHandleCache.withCachedHdf5(meshFileKey) { cachedMeshFile =>
      val lodScaleMultiplier = cachedMeshFile.float64Reader.getAttr("/", attrKeyLodScaleMultiplier)
      val transform = cachedMeshFile.float64Reader.getMatrixAttr("/", attrKeyTransform)
      (cachedMeshFile.meshFormat, lodScaleMultiplier, transform)
    }

  // Leaves out the segments whose lookup failed, e.g. because of a read error.
  private def lookUpSegmentsSkippingFailed(
      meshFileKey: MeshFileKey,
      segmentIds: Seq[Long],
      lodScaleMultiplier: Double,
      transform: Array[Array[Double]]
  ): List[SegmentMeshLookup] =
    fileHandleCache
      .withCachedHdf5(meshFileKey) { (cachedMeshFile: CachedHdf5File) =>
        segmentIds.toList.flatMap(segmentId =>
          SegmentMeshLookup.fromBox(
            segmentId,
            listMeshChunksForSegment(cachedMeshFile, segmentId, lodScaleMultiplier, transform)
          )
        )
      }
      .toOption
      .getOrElse(List.empty)

  // Empty if the mesh file has no entry for the segment.
  private def listMeshChunksForSegment(
      cachedMeshFile: CachedHdf5File,
      segmentId: Long,
      lodScaleMultiplier: Double,
      transform: Array[Array[Double]]
  ): Box[List[MeshLodInfo]] =
    for {
      (manifestStart, manifestEnd) <- getNeuroglancerSegmentManifestOffsets(segmentId, cachedMeshFile)
      lods <- tryo {
        val manifestBytes = cachedMeshFile.uint8Reader.readArrayBlockWithOffset(
          "/neuroglancer",
          (manifestEnd - manifestStart).toInt,
          manifestStart
        )
        val segmentManifest = NeuroglancerSegmentManifest.fromBytes(manifestBytes)
        enrichSegmentInfo(segmentManifest, lodScaleMultiplier, transform, manifestStart, segmentId)
      }
    } yield lods

  // Empty if the mesh file has no entry for the segment.
  private def getNeuroglancerSegmentManifestOffsets(
      segmentId: Long,
      cachedMeshFile: CachedHdf5File
  ): Box[(Long, Long)] =
    for {
      bucketOffsets <- tryo {
        val bucketIndex =
          java.lang.Long.remainderUnsigned(cachedMeshFile.hashFunction(segmentId), cachedMeshFile.nBuckets)
        cachedMeshFile.uint64Reader.readArrayBlockWithOffset(keyBucketOffsets, 2, bucketIndex)
      }
      bucketStart = bucketOffsets(0)
      bucketEnd = bucketOffsets(1)
      _ <- Box.fromBool(bucketEnd - bucketStart > 0)
      buckets <- tryo(
        cachedMeshFile.uint64Reader.readMatrixBlockWithOffset(
          keyBuckets,
          (bucketEnd - bucketStart + 1).toInt,
          3,
          bucketStart,
          0
        )
      )
      bucketLocalOffset = buckets.map(_(0)).indexOf(segmentId)
      _ <- Box.fromBool(bucketLocalOffset >= 0)
    } yield (buckets(bucketLocalOffset)(1), buckets(bucketLocalOffset)(2))

  override def computeGlobalPosition(
      segmentInfo: NeuroglancerSegmentManifest,
      lod: Int,
      lodScaleMultiplier: Double,
      currentChunk: Int
  ): Vec3Float =
    segmentInfo.gridOrigin + segmentInfo.chunkPositions(lod)(currentChunk).toVec3Float * segmentInfo.chunkShape * Math
      .pow(2, lod) * segmentInfo.lodScales(lod) * lodScaleMultiplier

  override def getLodTransform(
      segmentInfo: NeuroglancerSegmentManifest,
      lodScaleMultiplier: Double,
      transform: Array[Array[Double]],
      lod: Int
  ): Array[Array[Double]] = transform

  def versionForMeshFile(meshFileKey: MeshFileKey): Long =
    fileHandleCache
      .withCachedHdf5(meshFileKey) { cachedMeshFile =>
        cachedMeshFile.artifactSchemaVersion
      }
      .toOption
      .getOrElse(0)

  def readMeshChunk(
      meshFileKey: MeshFileKey,
      meshChunkDataRequests: Seq[MeshChunkDataRequest]
  ): Box[(Array[Byte], String)] =
    for {
      resultBox <- fileHandleCache.withCachedHdf5(meshFileKey) { cachedMeshFile =>
        readMeshChunkFromCachedMeshFile(cachedMeshFile, meshChunkDataRequests)
      }
      (output, encoding) <- resultBox
    } yield (output, encoding)

  private def readMeshChunkFromCachedMeshFile(
      cachedMeshFile: CachedHdf5File,
      meshChunkDataRequests: Seq[MeshChunkDataRequest]
  ): Box[(Array[Byte], String)] = {
    val meshFormat = cachedMeshFile.meshFormat
    // Sort the requests by byte offset to optimize for spinning disk access
    val requestsReordered =
      meshChunkDataRequests.zipWithIndex.sortBy(requestAndIndex => requestAndIndex._1.byteOffset).toList
    val data: List[(Array[Byte], Int)] = requestsReordered.map { requestAndIndex =>
      val meshChunkDataRequest = requestAndIndex._1
      val data =
        cachedMeshFile.uint8Reader.readArrayBlockWithOffset(
          keyNeuroglancer,
          meshChunkDataRequest.byteSize,
          meshChunkDataRequest.byteOffset
        )
      (data, requestAndIndex._2)
    }
    val dataSorted = data.sortBy(d => d._2)
    Full((dataSorted.flatMap(d => d._1).toArray, meshFormat))
  }

  def listMeshChunksForMultipleSegments(meshFileKey: MeshFileKey, segmentIds: Seq[Long], failOnZeroChunks: Boolean)(
      implicit ec: ExecutionContext
  ): Fox[WebknossosSegmentInfo] =
    for {
      (meshFormat, lodScaleMultiplier, transform) <- readMeshFileMetadata(meshFileKey).toFox
      lookups = lookUpSegmentsSkippingFailed(meshFileKey, segmentIds, lodScaleMultiplier, transform)
      _ <- Fox.fromBool(lookups.exists(_.hasEntry) || !failOnZeroChunks) ?~> Msg.Mesh.File
        .zeroChunks(segmentIds.mkString(","), meshFileKey.attachment.name)
      wkChunkInfos <- WebknossosSegmentInfo.fromSegmentLookups(lookups, meshFormat).toFox
    } yield wkChunkInfos

  def clearCache(dataSourceId: DataSourceId, layerNameOpt: Option[String]): Int =
    fileHandleCache.clear(key => key.dataSourceId == dataSourceId && layerNameOpt.forall(_ == key.layerName))

}
