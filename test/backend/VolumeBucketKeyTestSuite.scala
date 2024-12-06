package backend

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.webknossos.datastore.models.{AdditionalCoordinate, BucketPosition}
import com.scalableminds.webknossos.datastore.models.datasource.AdditionalAxis
import com.scalableminds.webknossos.tracingstore.tracings.volume.BucketKeys
import org.scalatestplus.play.PlaySpec

class VolumeBucketKeyTestSuite extends PlaySpec {

  class BucketKeyBuilder extends BucketKeys {
    def build(dataLayerName: String,
              bucket: BucketPosition,
              additionalAxes: Option[Seq[AdditionalAxis]] = None): String =
      buildBucketKey(dataLayerName, bucket, additionalAxes)

    def parse(key: String, additionalAxes: Option[Seq[AdditionalAxis]]): Option[(String, BucketPosition)] =
      parseBucketKey(key, additionalAxes)
  }
  val bucketKeyBuilder = new BucketKeyBuilder

  val layerName = "mylayer"

  "Bucket Key" when {
    "built with xyz" should {
      val bucketPos = BucketPosition(32, 64, 96, Vec3Int(1, 1, 1), None)
      "match defined bucket key" in {
        val key = bucketKeyBuilder.build(layerName, bucketPos)
        assert(key == s"$layerName/1/[1,2,3]")
      }
      "expands mag when anisotropic" in {
        val key = bucketKeyBuilder.build(layerName, BucketPosition(32, 64, 96, Vec3Int(4, 4, 1), None))
        assert(key == s"$layerName/4-4-1/[0,0,3]")
      }
      "is parsed as the same bucket position" in {
        bucketKeyBuilder.parse(s"$layerName/1/[1,2,3]", None) match {
          case Some((layer, parsedPos)) =>
            assert(layer == layerName)
            assert(parsedPos == bucketPos)
          case None => fail()
        }
      }

    }
    "built with additional coordinates" should {
      val additionalAxes =
        Seq(AdditionalAxis("a", Array(0, 10), 0), AdditionalAxis("b", Array(0, 10), 1))
      val additionalCoordinates = Seq(AdditionalCoordinate("a", 4), AdditionalCoordinate("b", 5))

      val bucketPos = BucketPosition(32, 64, 96, Vec3Int(1, 1, 1), Some(additionalCoordinates))

      "match defined bucket key" in {

        val key = bucketKeyBuilder.build(
          layerName,
          bucketPos,
          Some(additionalAxes)
        )
        assert(key == s"$layerName/1/[4,5][1,2,3]")
      }
      "is parsed as the same bucket position" in {
        bucketKeyBuilder.parse(s"$layerName/1/[4,5][1,2,3]", Some(additionalAxes)) match {
          case Some((layer, parsedPos)) =>
            assert(layer == layerName)
            assert(parsedPos == bucketPos)
          case None => fail()
        }
      }

      "sort additional coordinates" in {
        val key = bucketKeyBuilder.build(
          layerName,
          BucketPosition(32, 64, 96, Vec3Int(1, 1, 1), Some(additionalCoordinates.reverse)),
          Some(additionalAxes)
        )
        assert(key == s"$layerName/1/[4,5][1,2,3]")
      }
    }
  }
}
