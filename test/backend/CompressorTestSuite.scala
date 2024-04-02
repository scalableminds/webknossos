package backend

import com.scalableminds.webknossos.datastore.datareaders.{
  BloscCompressor,
  Compressor,
  GzipCompressor,
  ZlibCompressor,
  ZstdCompressor
}
import com.scalableminds.webknossos.datastore.datareaders.Lz4Compressor
import org.scalatestplus.play.PlaySpec

import java.security.SecureRandom

class CompressorTestSuite extends PlaySpec {

  def testCompressor(compressor: Compressor): Unit = {
    val bytes = new Array[Byte](20)
    SecureRandom.getInstanceStrong.nextBytes(bytes)
    val decompressed = compressor.decompress(compressor.compress(bytes))
    assert(bytes.sameElements(decompressed))
  }

  "Zstd compressor" when {
    "compressing and decompressing" should {
      val compressor = new ZstdCompressor(0, true)
      "return original data" in {
        testCompressor(compressor)
      }
    }
  }

  "Zlib compressor" when {
    "compressing and decompressing" should {
      val compressor = new ZlibCompressor(Map())
      "return original data" in {
        testCompressor(compressor)
      }
    }
  }

  "Gzip compressor" when {
    "compressing and decompressing" should {
      val compressor = new GzipCompressor(Map())
      "return original data" in {
        testCompressor(compressor)
      }
    }
  }

  "Blosc compressor" when {
    "compressing and decompressing" should {
      val compressor = new BloscCompressor(Map())
      "return original data" in {
        testCompressor(compressor)
      }
    }
  }

  "lz4 compressor" when {
    "compressing and decompressing" should {
      val compressor = new Lz4Compressor
      "return original data" in {
        testCompressor(compressor)
      }
    }
  }
}
