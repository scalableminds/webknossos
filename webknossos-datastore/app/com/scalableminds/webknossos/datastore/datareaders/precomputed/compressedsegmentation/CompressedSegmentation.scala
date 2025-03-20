package com.scalableminds.webknossos.datastore.datareaders.precomputed.compressedsegmentation

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.ByteUtils

import java.nio.{ByteBuffer, ByteOrder}
import scala.reflect.ClassTag

// Implementation of compressed segmentation as specified in:
// https://github.com/google/neuroglancer/tree/master/src/neuroglancer/sliceview/compressed_segmentation
// For a reference implementation, see also:
// https://github.com/janelia-flyem/compressedseg

trait CompressedSegmentation[T <: AnyVal] extends ByteUtils {

  private val kBlockHeaderSize = 2
  val defaultBlockSize: Vec3Int = Vec3Int(8, 8, 8)

  val typeWidthBytes: Int

  def readValue(input: Array[Int], position: Int): T

  def initializeArray(length: Int): Array[T]

  private def decompressChannel(input: Array[Int], volumeSize: Array[Int], blockSize: Vec3Int): Array[T] = {
    val numElements = volumeSize(0) * volumeSize(1) * volumeSize(2)
    val output = initializeArray(numElements)

    val gridSize: Array[Int] = volumeSize.zip(blockSize.toList).map { case (v, b) => (v + b - 1) / b }
    for (block2 <- 0 until gridSize(2)) {
      for (block1 <- 0 until gridSize(1)) {
        for (block0 <- 0 until gridSize(0)) {
          val blockOffset = block0 + gridSize(0) * (block1 + gridSize(1) * block2)
          val tableOffset = input(blockOffset * kBlockHeaderSize) & 0xffffff
          val encodedBits = (input(blockOffset * kBlockHeaderSize) >> 24) & 0xff
          val encodedValueStart = input(blockOffset * kBlockHeaderSize + 1)
          val tableEntrySize = typeWidthBytes / 4

          val xmin = block0 * blockSize.x
          val xmax = (xmin + blockSize.x).min(volumeSize(0))

          val ymin = block1 * blockSize.y
          val ymax = (ymin + blockSize.y).min(volumeSize(1))

          val zmin = block2 * blockSize.z
          val zmax = (zmin + blockSize.z).min(volumeSize(2))

          val bitmask = (1 << encodedBits) - 1
          for (z <- zmin until zmax) {
            for (y <- ymin until ymax) {
              var outindex = (z * volumeSize(1) + y) * volumeSize(0) + xmin
              var bitpos = blockSize.x * ((z - zmin) * blockSize.y + (y - ymin)) * encodedBits
              for (_ <- xmin until xmax) {
                val bitshift = bitpos % 32
                val arraypos = bitpos / 32
                var bitval = 0
                if (encodedBits > 0) {
                  bitval = (input(encodedValueStart + arraypos) >> bitshift) & bitmask
                }
                val value = readValue(input, tableOffset + bitval * tableEntrySize)
                output(outindex) = value
                bitpos += encodedBits
                outindex += 1
              }
            }
          }
        }
      }
    }
    output
  }

  private def decompressChannels(input: Array[Int], volumeSize: Array[Int], blockSize: Vec3Int)(
      implicit c: ClassTag[T]): Array[T] =
    (0 until volumeSize(3))
      .flatMap(channel => decompressChannel(input.drop(input(channel)), volumeSize, blockSize))
      .toArray

  def valueToBytes(v: T): Array[Byte]

  def decompress(encodedBytes: Array[Byte], volumeSize: Array[Int], blockSize: Vec3Int)(
      implicit c: ClassTag[T]): Array[Byte] = {
    val vs = if (volumeSize.length == 3) {
      volumeSize :+ 1
    } else {
      volumeSize
    }
    val input32 = new Array[Int](encodedBytes.length / 4)
    ByteBuffer.wrap(encodedBytes).order(ByteOrder.LITTLE_ENDIAN).asIntBuffer().get(input32)
    val values: Array[T] = decompressChannels(input32, vs, blockSize)
    values.flatMap(v => valueToBytes(v))
  }
}

object CompressedSegmentation32 extends CompressedSegmentation[Int] {
  override val typeWidthBytes: Int = 4

  override def initializeArray(length: Int): Array[Int] =
    new Array[Int](length)

  override def readValue(input: Array[Int], position: Int): Int =
    input(position)

  def valueToBytes(v: Int): Array[Byte] = intToBytes(v)
}

object CompressedSegmentation64 extends CompressedSegmentation[Long] {
  override val typeWidthBytes: Int = 8

  override def initializeArray(length: Int): Array[Long] =
    new Array[Long](length)

  override def readValue(input: Array[Int], position: Int): Long =
    ByteBuffer.wrap(ByteBuffer.allocate(8).putInt(input(position + 1)).putInt(input(position)).array()).getLong

  def valueToBytes(v: Long): Array[Byte] = longToBytes(v)
}
