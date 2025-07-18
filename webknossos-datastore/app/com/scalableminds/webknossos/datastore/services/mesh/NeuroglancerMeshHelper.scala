package com.scalableminds.webknossos.datastore.services.mesh

import com.google.common.io.LittleEndianDataInputStream
import com.scalableminds.util.geometry.{Vec3Float, Vec3Int}
import com.scalableminds.util.tools.Box
import com.scalableminds.util.tools.Box.tryo
import play.api.libs.json.{Json, OFormat}

import java.io.ByteArrayInputStream
import scala.collection.mutable.ListBuffer

/**
  * Represents the multi-resolution mesh manifest file format for Neuroglancer Precomputed.
  * https://github.com/google/neuroglancer/blob/233fc39b07a0480a8e1c90fc5ca835330a0bf287/src/datasource/precomputed/meshes.md#multi-resolution-mesh-manifest-file-format
  * This is used for Neuroglancer Precomputed Meshes and local meshes.
  */
case class NeuroglancerSegmentManifest(chunkShape: Vec3Float,
                                       gridOrigin: Vec3Float,
                                       numLods: Int,
                                       lodScales: Array[Float],
                                       vertexOffsets: Array[Vec3Float],
                                       numChunksPerLod: Array[Int],
                                       chunkPositions: List[List[Vec3Int]],
                                       chunkByteSizes: List[List[Long]])

object NeuroglancerSegmentManifest {
  def fromBytes(manifestBytes: Array[Byte]): NeuroglancerSegmentManifest = {
    // All Ints here should be UInt32 per spec. We assume that the sign bit is not necessary (the encoded values are at most 2^31).
    // But they all are used to index into Arrays and JVM doesn't allow for Long Array Indexes,
    // we can't convert them.
    val byteInput = new ByteArrayInputStream(manifestBytes)
    val dis = new LittleEndianDataInputStream(byteInput)

    val chunkShape = Vec3Float(x = dis.readFloat, y = dis.readFloat, z = dis.readFloat)
    val gridOrigin = Vec3Float(x = dis.readFloat, y = dis.readFloat, z = dis.readFloat)

    val numLods = dis.readInt

    val lodScales = new Array[Float](numLods)
    for (d <- 0 until numLods) {
      lodScales(d) = dis.readFloat
    }

    val vertexOffsets = new Array[Vec3Float](numLods)
    for (d <- 0 until numLods) {
      vertexOffsets(d) = Vec3Float(x = dis.readFloat, y = dis.readFloat, z = dis.readFloat)
    }

    val numChunksPerLod = new Array[Int](numLods)
    for (lod <- 0 until numLods) {
      numChunksPerLod(lod) = dis.readInt()
    }

    val chunkPositionsList = new ListBuffer[List[Vec3Int]]
    val chunkSizes = new ListBuffer[List[Long]]
    for (lod <- 0 until numLods) {
      val currentChunkPositions = (ListBuffer[Int](), ListBuffer[Int](), ListBuffer[Int]())
      for (row <- 0 until 3; _ <- 0 until numChunksPerLod(lod)) {
        row match {
          case 0 => currentChunkPositions._1.append(dis.readInt)
          case 1 => currentChunkPositions._2.append(dis.readInt)
          case 2 => currentChunkPositions._3.append(dis.readInt)
        }
      }

      chunkPositionsList.append(
        currentChunkPositions._1
          .lazyZip(currentChunkPositions._2)
          .lazyZip(currentChunkPositions._3)
          .map(Vec3Int(_, _, _))
          .toList)

      val currentChunkSizes = ListBuffer[Long]()
      for (_ <- 0 until numChunksPerLod(lod)) {
        currentChunkSizes.append(dis.readInt.toLong) // Converting to long for convenient + safe summing later
      }
      chunkSizes.append(currentChunkSizes.toList)
    }

    NeuroglancerSegmentManifest(chunkShape,
                                gridOrigin,
                                numLods,
                                lodScales,
                                vertexOffsets,
                                numChunksPerLod,
                                chunkPositionsList.toList,
                                chunkSizes.toList)
  }
}

case class MeshChunk(position: Vec3Float, byteOffset: Long, byteSize: Int, unmappedSegmentId: Option[Long] = None)

object MeshChunk {
  implicit val jsonFormat: OFormat[MeshChunk] = Json.format[MeshChunk]
}
case class MeshLodInfo(chunks: List[MeshChunk], transform: Array[Array[Double]])

object MeshLodInfo {
  implicit val jsonFormat: OFormat[MeshLodInfo] = Json.format[MeshLodInfo]
}
case class WebknossosSegmentInfo(
    meshFormat: String,
    lods: List[MeshLodInfo],
    chunkScale: Array[Double] = Array(1.0, 1.0, 1.0) // Used for Neuroglancer Precomputed Meshes to account for vertex quantization
)

object WebknossosSegmentInfo {
  implicit val jsonFormat: OFormat[WebknossosSegmentInfo] = Json.format[WebknossosSegmentInfo]

  def fromMeshInfosAndMetadata(chunkInfos: List[List[MeshLodInfo]],
                               meshFormat: String,
                               chunkScale: Array[Double] = Array(1.0, 1.0, 1.0)): Box[WebknossosSegmentInfo] =
    Box(chunkInfos.headOption).flatMap { firstChunkInfo =>
      tryo {
        WebknossosSegmentInfo(
          meshFormat = meshFormat,
          lods = chunkInfos.transpose.map(mergeLod),
          chunkScale = chunkScale
        )
      }
    }

  private def mergeLod(thisLodFromAllChunks: List[MeshLodInfo]): MeshLodInfo = {
    val first = thisLodFromAllChunks.head
    first.copy(chunks = thisLodFromAllChunks.flatMap(_.chunks))
  }

}

trait NeuroglancerMeshHelper {

  def computeGlobalPosition(segmentInfo: NeuroglancerSegmentManifest,
                            lod: Int,
                            lodScaleMultiplier: Double,
                            currentChunk: Int): Vec3Float

  def getLodTransform(segmentInfo: NeuroglancerSegmentManifest,
                      lodScaleMultiplier: Double,
                      transform: Array[Array[Double]],
                      lod: Int): Array[Array[Double]]

  protected def enrichSegmentInfo(segmentInfo: NeuroglancerSegmentManifest,
                                  lodScaleMultiplier: Double,
                                  transform: Array[Array[Double]],
                                  neuroglancerOffsetStart: Long,
                                  segmentId: Long): List[MeshLodInfo] = {
    val bytesPerLod = segmentInfo.chunkByteSizes.map(_.sum)
    val totalMeshSize = bytesPerLod.sum
    val meshByteStartOffset = neuroglancerOffsetStart - totalMeshSize
    val chunkByteOffsetsInLod = segmentInfo.chunkByteSizes.map(_.scanLeft(0L)(_ + _)) // builds cumulative sum

    def getChunkByteOffset(lod: Int, currentChunk: Int): Long =
      // get past the finer lods first, then take offset in selected lod
      bytesPerLod.take(lod).sum + chunkByteOffsetsInLod(lod)(currentChunk)

    def computeGlobalPositionAndOffset(lod: Int, currentChunk: Int): MeshChunk = {
      val globalPosition = computeGlobalPosition(segmentInfo, lod, lodScaleMultiplier, currentChunk)

      MeshChunk(
        position = globalPosition, // This position is in Voxel Space
        byteOffset = meshByteStartOffset + getChunkByteOffset(lod, currentChunk),
        byteSize = segmentInfo.chunkByteSizes(lod)(currentChunk).toInt, // size must be int32 to fit in java array
        unmappedSegmentId = Some(segmentId)
      )
    }

    val lods: Seq[Int] = 0 until segmentInfo.numLods

    def chunkCountsWithLod(lod: Int): IndexedSeq[(Int, Int)] =
      for (currentChunk <- 0 until segmentInfo.numChunksPerLod(lod))
        yield (lod, currentChunk)

    val chunks = lods.map(lod => chunkCountsWithLod(lod).map(x => computeGlobalPositionAndOffset(x._1, x._2)).toList)

    val meshFileLods = lods
      .map(
        lod =>
          MeshLodInfo(
            chunks = chunks(lod),
            transform = getLodTransform(segmentInfo, lodScaleMultiplier, transform, lod),
        ))
      .toList
    meshFileLods
  }
}
