package backend

import com.scalableminds.webknossos.datastore.datareaders.{Lz4Compressor, ZstdCompressor}
import org.scalatestplus.play.PlaySpec

import java.security.SecureRandom

class CompressorTestSuite extends PlaySpec {

  "Zstd compressor" when {
    "compressing and decompressing" should {

      val compressor = new ZstdCompressor(0, true)
      "return original data" in {
        val bytes = new Array[Byte](20)
        SecureRandom.getInstanceStrong.nextBytes(bytes)
        val decompressed = compressor.decompress(compressor.compress(bytes))
        assert(bytes.sameElements(decompressed))

      }
    }
  }

  "lz4 compressor" when {
    "compressing and decompressing" should {

      val compressor = new Lz4Compressor
      "return original data" in {
        val bytes = new Array[Byte](20)
        SecureRandom.getInstanceStrong.nextBytes(bytes)
        val decompressed = compressor.decompress(compressor.compress(bytes))
        assert(bytes.sameElements(decompressed))

      }
    }
  }
}
