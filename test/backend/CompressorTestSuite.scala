package backend

import com.scalableminds.webknossos.datastore.datareaders.{
  BloscCompressor,
  CompressoCompressor,
  Compressor,
  GzipCompressor,
  ZlibCompressor,
  ZstdCompressor
}
import com.scalableminds.webknossos.datastore.datareaders.Lz4Compressor
import org.scalatest.Assertion
import org.scalatest.wordspec.AsyncWordSpec

import java.io.IOException
import java.nio.{ByteBuffer, ByteOrder}
import java.security.SecureRandom

class CompressorTestSuite extends AsyncWordSpec {

  def testCompressor(compressor: Compressor): Assertion = {
    val bytes = new Array[Byte](20)
    SecureRandom.getInstanceStrong.nextBytes(bytes)
    val decompressed = compressor.decompress(compressor.compress(bytes))
    assert(bytes.sameElements(decompressed))
  }

  private def compressoHeader(sizeX: Int, sizeY: Int, sizeZ: Int, step: Int, idSize: Long): Array[Byte] = {
    val buffer = ByteBuffer.allocate(64).order(ByteOrder.LITTLE_ENDIAN)
    buffer.put("cpso".getBytes)
    buffer.put(0.toByte) // format version
    buffer.put(1.toByte) // data width
    buffer.putShort(sizeX.toShort).putShort(sizeY.toShort).putShort(sizeZ.toShort)
    buffer.put(step.toByte).put(step.toByte).put(step.toByte)
    buffer.putLong(idSize)
    buffer.putInt(0) // value size
    buffer.putLong(0) // location size
    buffer.put(4.toByte) // connectivity
    buffer.array()
  }

  "Zstd compressor" when {
    "compressing and decompressing" should {
      val compressor = new ZstdCompressor(0, true)
      "return original data" in
        testCompressor(compressor)
    }
  }

  "Zlib compressor" when {
    "compressing and decompressing" should {
      val compressor = new ZlibCompressor(Map())
      "return original data" in
        testCompressor(compressor)
    }
  }

  "Gzip compressor" when {
    "compressing and decompressing" should {
      val compressor = new GzipCompressor(Map())
      "return original data" in
        testCompressor(compressor)
    }
  }

  "Blosc compressor" when {
    "compressing and decompressing" should {
      val compressor = new BloscCompressor(Map())
      "return original data" in
        testCompressor(compressor)
    }
  }

  "lz4 compressor" when {
    "compressing and decompressing" should {
      val compressor = new Lz4Compressor
      "return original data" in
        testCompressor(compressor)
    }
  }

  "Blosc compressor" when {
    "reading a header claiming more compressed bytes than the input has" should {
      "fail instead of reading past the buffer" in {
        val compressed = new BloscCompressor(Map()).compress(new Array[Byte](1024))
        ByteBuffer.wrap(compressed).order(ByteOrder.LITTLE_ENDIAN).putInt(12, compressed.length + 1024)
        assertThrows[IOException](new BloscCompressor(Map()).decompress(compressed))
      }
    }
  }

  "Compresso compressor" when {
    "reading a crafted header" should {
      "fail instead of dividing by zero for zero steps" in
        assertThrows[RuntimeException](
          new CompressoCompressor().decompress(compressoHeader(2, 2, 2, step = 0, idSize = 0))
        )
      "fail for section sizes exceeding the input" in
        assertThrows[RuntimeException](
          new CompressoCompressor().decompress(compressoHeader(2, 2, 2, step = 4, idSize = Long.MaxValue))
        )
    }
  }
}
