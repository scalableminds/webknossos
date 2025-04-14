package com.scalableminds.webknossos.datastore.services.mesh

import com.scalableminds.util.geometry.Vec3Float

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
                                  segmentId: Long): MeshSegmentInfo = {
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

    val lods: Seq[Int] = for (lod <- 0 until segmentInfo.numLods) yield lod

    def chunkCountsWithLod(lod: Int): IndexedSeq[(Int, Int)] =
      for (currentChunk <- 0 until segmentInfo.numChunksPerLod(lod))
        yield (lod, currentChunk)

    val chunks = lods.map(lod => chunkCountsWithLod(lod).map(x => computeGlobalPositionAndOffset(x._1, x._2)).toList)

    val meshfileLods = lods
      .map(
        lod =>
          MeshLodInfo(
            scale = segmentInfo.lodScales(lod).toInt,
            vertexOffset = segmentInfo.vertexOffsets(lod), // Ignored by fronted
            chunkShape = segmentInfo.chunkShape, // Ignored by frontend
            chunks = chunks(lod),
            transform = getLodTransform(segmentInfo, lodScaleMultiplier, transform, lod),
        ))
      .toList
    MeshSegmentInfo(chunkShape = segmentInfo.chunkShape, gridOrigin = segmentInfo.gridOrigin, lods = meshfileLods)
  }
}
