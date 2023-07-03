package backend

import com.scalableminds.webknossos.tracingstore.tracings.MortonNDHelper
import com.scalableminds.webknossos.wrap.WKWMortonHelper
import org.scalatestplus.play.PlaySpec

class MortonCodeNDTestSuite extends PlaySpec {

  class MortonNDClass extends MortonNDHelper {
    def encode(position: Array[Int]): Long = mortonEncode(position)
    def decode(mortonIndex: Long, dimensions: Int): Array[Int] = mortonDecode(mortonIndex, dimensions)
  }
  val mortonNDUtility = new MortonNDClass()

  class Morton3DClass extends WKWMortonHelper {
    def encode(x: Int, y: Int, z: Int): Int = mortonEncode(x, y, z)
    def decode(mortonIndex: Long): (Int, Int, Int) = mortonDecode(mortonIndex)
  }

  val morton3DUtility = new Morton3DClass()

  "Morton code in n dimensions" when {
    "using 3 dimensions" should {
      "have same result as dedicated 3d morton code" which {
        "x=1, y=1, z=1" in {
          assert(mortonNDUtility.encode(Array(1, 1, 1)) == morton3DUtility.encode(1, 1, 1))
        }
        "x=1, y=2, z=3" in {
          assert(mortonNDUtility.encode(Array(1, 2, 3)) == morton3DUtility.encode(1, 2, 3))
        }
        "x=1024, y=512, z=128" in {
          assert(mortonNDUtility.encode(Array(1024, 512, 128)) == morton3DUtility.encode(1024, 512, 128))
        }
      }
    }
    "applying decoding to decoded" should {
      "result in the same" in {
        val testValues = Array(Array(1, 1, 1),
                               Array(1, 2, 3),
                               Array(1, 1, 1, 1),
                               Array(2, 2, 2, 2),
                               Array(42, 42, 42, 42),
                               Array(13, 37))
        testValues.foreach(testValue => {

          val encoded = mortonNDUtility.encode(testValue)
          val decoded = mortonNDUtility.decode(encoded, testValue.length)
          assert(decoded.sameElements(testValue))
        })
      }
    }
    "comparing to known values" should {
      "give correct encodings" in {
        val testMappings = Array(
          Array(1, 1, 1, 1) -> 15,
          Array(1, 2, 3, 4) -> 2149,
          Array(1, 12, 123, 1234) -> 8798446838469L
        )
        for (mapping <- testMappings) {
          assert(mortonNDUtility.encode(mapping._1) == mapping._2)
        }
      }
    }
  }

}
