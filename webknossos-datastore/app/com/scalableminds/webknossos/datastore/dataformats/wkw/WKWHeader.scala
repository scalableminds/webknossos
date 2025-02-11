package com.scalableminds.webknossos.datastore.dataformats.wkw

import com.google.common.io.{LittleEndianDataInputStream => DataInputStream}
import com.scalableminds.util.tools.BoxImplicits
import com.scalableminds.webknossos.datastore.dataformats.wkw.util.ResourceBox
import com.scalableminds.webknossos.datastore.datareaders.ArrayDataType.ArrayDataType
import com.scalableminds.webknossos.datastore.datareaders.ArrayOrder.ArrayOrder
import com.scalableminds.webknossos.datastore.datareaders.DimensionSeparator.DimensionSeparator
import com.scalableminds.webknossos.datastore.datareaders.{
  ArrayOrder,
  Compressor,
  DatasetHeader,
  DimensionSeparator,
  Lz4Compressor,
  NullCompressor
}
import org.apache.commons.io.IOUtils

import java.io._
import java.nio.{ByteBuffer, ByteOrder}
import com.scalableminds.util.tools.Box
import com.scalableminds.util.tools.Box.tryo

object ChunkType extends Enumeration(1) {
  val Raw, LZ4, LZ4HC = Value

  def isCompressed(blockType: ChunkType.Value): Boolean = blockType == LZ4 || blockType == LZ4HC
}

case class WKWHeader(
    version: Int,
    numChunksPerShardDimension: Int,
    numVoxelsPerChunkDimension: Int,
    blockType: ChunkType.Value,
    voxelType: VoxelType.Value,
    numBytesPerVoxel: Int, // this encodes the channel count together with voxelType
    jumpTable: Array[Long]
) extends DatasetHeader
    with WKWDataFormatHelper {

  def dataOffset: Long = jumpTable.head

  def isCompressed: Boolean = ChunkType.isCompressed(blockType)

  def numChunksPerShard: Int = numChunksPerShardDimension * numChunksPerShardDimension * numChunksPerShardDimension

  def numBytesPerChunk: Int =
    numVoxelsPerChunkDimension * numVoxelsPerChunkDimension * numVoxelsPerChunkDimension * numBytesPerVoxel

  def numChannels: Int = numBytesPerVoxel / VoxelType.bytesPerVoxelPerChannel(voxelType)

  def blockLengths: Iterator[Int] =
    if (isCompressed) {
      jumpTable.sliding(2).map(a => (a(1) - a(0)).toInt)
    } else {
      Iterator.fill(numChunksPerShard)(numBytesPerChunk)
    }

  def writeTo(output: DataOutput, isHeaderFile: Boolean = false): Unit = {
    output.write(WKWHeader.magicBytes)
    output.writeByte(WKWHeader.currentVersion)
    val numChunksPerShardDimensionLog2 = (math.log(numChunksPerShardDimension) / math.log(2)).toInt
    val numVoxelsPerChunkDimensionLog2 = (math.log(numVoxelsPerChunkDimension) / math.log(2)).toInt
    val sideLengths = (numChunksPerShardDimensionLog2 << 4) + numVoxelsPerChunkDimensionLog2
    output.writeByte(sideLengths)
    output.writeByte(blockType.id)
    output.writeByte(voxelType.id)
    output.writeByte(numBytesPerVoxel)
    if (isHeaderFile) {
      output.writeLong(0L)
    } else {
      val realDataOffset = 8L + jumpTable.length * 8L
      val jumpTableBuffer = ByteBuffer.allocate(jumpTable.length * 8)
      jumpTableBuffer.order(ByteOrder.LITTLE_ENDIAN)
      jumpTable.map(_ - dataOffset + realDataOffset).foreach(jumpTableBuffer.putLong)
      output.write(jumpTableBuffer.array)
    }
  }

  override def datasetShape: Option[Array[Int]] = None

  override def chunkShape: Array[Int] =
    Array(numChannels, numVoxelsPerChunkDimension, numVoxelsPerChunkDimension, numVoxelsPerChunkDimension)

  def shardShape: Array[Int] =
    Array(
      numChannels,
      numChunksPerShardDimension * numVoxelsPerChunkDimension,
      numChunksPerShardDimension * numVoxelsPerChunkDimension,
      numChunksPerShardDimension * numVoxelsPerChunkDimension
    )

  override def dimension_separator: DimensionSeparator = DimensionSeparator.SLASH

  override def fill_value: Either[String, Number] = Right(0)

  override def order: ArrayOrder = ArrayOrder.F

  override def resolvedDataType: ArrayDataType = VoxelType.toArrayDataType(voxelType)

  override def compressorImpl: Compressor = blockType match {
    case ChunkType.Raw                   => nullCompressor
    case ChunkType.LZ4 | ChunkType.LZ4HC => lz4Compressor
  }

  override def voxelOffset: Array[Int] = Array(0, 0, 0, 0)

  private lazy val nullCompressor = new NullCompressor
  private lazy val lz4Compressor = new Lz4Compressor

  override def isSharded: Boolean = true
}

object WKWHeader extends BoxImplicits {

  private def error(msg: String, expected: Any, actual: Any): String =
    s"""Error reading WKW header: $msg [expected: $expected, actual: $actual]."""

  private def error(msg: String): String =
    s"""Error reading WKW header: $msg."""

  val magicBytes: Array[Byte] = "WKW".getBytes
  val currentVersion = 1

  def apply(dataStream: DataInputStream, readJumpTable: Boolean): Box[WKWHeader] = {
    val magicByteBuffer: Array[Byte] = IOUtils.toByteArray(dataStream, magicBytes.length)
    val version = dataStream.readUnsignedByte()
    val sideLengths = dataStream.readUnsignedByte()
    val numChunksPerShardDimension = 1 << (sideLengths >>> 4) // fileSideLength [higher nibble]
    val numVoxelsPerChunkDimension = 1 << (sideLengths & 0x0f) // blockSideLength [lower nibble]
    val blockTypeId = dataStream.readUnsignedByte()
    val voxelTypeId = dataStream.readUnsignedByte()
    val numBytesPerVoxel = dataStream.readUnsignedByte() // voxel-size

    for {
      _ <- Box.fromBool(magicByteBuffer.sameElements(magicBytes)) ?~! error("Invalid magic bytes",
                                                                        magicBytes,
                                                                        magicByteBuffer)
      _ <- Box.fromBool(version == currentVersion) ?~! error("Unknown version", currentVersion, version)
      // We only support fileSideLengths < 1024, so that the total number of blocks per file fits in an Int.
      _ <- Box.fromBool(numChunksPerShardDimension < 1024) ?~! error("Specified fileSideLength not supported",
                                                                 numChunksPerShardDimension,
                                                                 "[0, 1024)")
      // We only support blockSideLengths < 1024, so that the total number of voxels per block fits in an Int.
      _ <- Box.fromBool(numChunksPerShardDimension < 1024) ?~! error("Specified blockSideLength not supported",
                                                                 numVoxelsPerChunkDimension,
                                                                 "[0, 1024)")
      blockType <- tryo(ChunkType(blockTypeId)) ?~! error("Specified blockType is not supported")
      voxelType <- tryo(VoxelType(voxelTypeId)) ?~! error("Specified voxelType is not supported")
    } yield {
      val jumpTable = if (ChunkType.isCompressed(blockType) && readJumpTable) {
        val numChunksPerShard = numChunksPerShardDimension * numChunksPerShardDimension * numChunksPerShardDimension
        (0 to numChunksPerShard).map(_ => dataStream.readLong()).toArray
      } else {
        Array(dataStream.readLong())
      }
      new WKWHeader(version,
                    numChunksPerShardDimension,
                    numVoxelsPerChunkDimension,
                    blockType,
                    voxelType,
                    numBytesPerVoxel,
                    jumpTable)
    }
  }

  def apply(file: File, readJumpTable: Boolean = false): Box[WKWHeader] =
    ResourceBox.manage(new DataInputStream(new BufferedInputStream(new FileInputStream(file))))(apply(_, readJumpTable))

  def apply(numChunksPerShardDimension: Int,
            numVoxelsPerChunkDimension: Int,
            blockType: ChunkType.Value,
            voxelType: VoxelType.Value,
            numChannels: Int): WKWHeader =
    new WKWHeader(
      currentVersion,
      numChunksPerShardDimension,
      numVoxelsPerChunkDimension,
      blockType,
      voxelType,
      VoxelType.bytesPerVoxelPerChannel(voxelType) * numChannels,
      Array(0)
    )
}
