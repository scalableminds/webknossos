package backend

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.{Full, Empty}
import com.scalableminds.webknossos.datastore.dataformats.zarr.ZarrCoordinatesParser
import com.scalableminds.webknossos.datastore.models.{AdditionalCoordinate, BucketPosition}
import com.scalableminds.webknossos.datastore.dataformats.wkw.WKWDataFormatHelper
import com.scalableminds.webknossos.datastore.models.datasource.{AdditionalAxis, DataLayer}
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeDataZipHelper
import org.scalatestplus.play.PlaySpec

import scala.concurrent.ExecutionContext

class ParsingTestSuite extends PlaySpec with WKWDataFormatHelper with VolumeDataZipHelper {
  // Test a couple of regexes and parsers

  implicit val ec: ExecutionContext = scala.concurrent.ExecutionContext.global

  "Reading mags from header paths" should {
    "yield correct mags" in {
      assert(
        getMagFromWkwOrZarrHeaderFilePath("a/random/path/to/32-32-16/header.wkw").contains(Vec3Int(32, 32, 16))
      )
      assert(
        getMagFromWkwOrZarrHeaderFilePath("a/random/path/to/16/zarr.json").contains(Vec3Int(16, 16, 16))
      )
      assert(
        getMagFromWkwOrZarrHeaderFilePath("16/zarr.json").contains(Vec3Int(16, 16, 16))
      )
      assert(
        getMagFromWkwOrZarrHeaderFilePath("a/random/path/to/16/z6/y5/zarr.json").isEmpty
      )
    }
  }

  "WKW bucket parsing" should {
    "correctly parse various wkw paths" in {
      assert(
        parseWKWFilePath("a/random/path/to/32-32-16/z6/y5/x4.wkw").contains(
          BucketPosition(4 * 32 * DataLayer.bucketLength,
                         5 * 32 * DataLayer.bucketLength,
                         6 * 16 * DataLayer.bucketLength,
                         Vec3Int(32, 32, 16),
                         None)))
      assert(
        parseWKWFilePath("/absolute/path/to/32-32-16/z6/y5/x4.wkw").contains(
          BucketPosition(4 * 32 * DataLayer.bucketLength,
                         5 * 32 * DataLayer.bucketLength,
                         6 * 16 * DataLayer.bucketLength,
                         Vec3Int(32, 32, 16),
                         None)))
      assert(
        parseWKWFilePath("32-32-16/z6/y5/x4.wkw").contains(
          BucketPosition(4 * 32 * DataLayer.bucketLength,
                         5 * 32 * DataLayer.bucketLength,
                         6 * 16 * DataLayer.bucketLength,
                         Vec3Int(32, 32, 16),
                         None)))
      assert(
        parseWKWFilePath("1/z6/y5/x4.wkw").contains(
          BucketPosition(4 * 1 * DataLayer.bucketLength,
                         5 * 1 * DataLayer.bucketLength,
                         6 * 1 * DataLayer.bucketLength,
                         Vec3Int(1, 1, 1),
                         None)))
      assert(
        parseWKWFilePath("/1/z6/y5/x0.wkw").contains(
          BucketPosition(0 * 1 * DataLayer.bucketLength,
                         5 * 1 * DataLayer.bucketLength,
                         6 * 1 * DataLayer.bucketLength,
                         Vec3Int(1, 1, 1),
                         None)))
      assert(
        parseWKWFilePath("some/pre.fix/to/1/z6/y5/x4.wkw").contains(
          BucketPosition(4 * 1 * DataLayer.bucketLength,
                         5 * 1 * DataLayer.bucketLength,
                         6 * 1 * DataLayer.bucketLength,
                         Vec3Int(1, 1, 1),
                         None)))
    }

    "reject invalid wkw paths" in {
      assert(parseWKWFilePath("/absolute/path/to/32-32-16/z6/y5/x4wkw").isEmpty)
      assert(parseWKWFilePath("/absolute/path/to/32-32-16/z6/5/x4.wkw").isEmpty)
      assert(parseWKWFilePath("/absolute/path/to/3232-16/z6/y5/x4.wkw").isEmpty)
      assert(parseWKWFilePath("15.3/z6/y5/x4.wkw").isEmpty)
    }
  }

  "parseNDimensionalDotCoordinates" should {
    "correctly parse chunk coordinates without additional axes" in {
      val parsed1 = ZarrCoordinatesParser
        .parseNDimensionalDotCoordinates(
          "0.1.2.3",
          None
        )
        .await("test")
      assert(parsed1 == Full((1, 2, 3, None)))
      val parsed2 = ZarrCoordinatesParser
        .parseNDimensionalDotCoordinates(
          "0.4.3.6",
          None
        )
        .await("test")
      assert(parsed2 == Full((4, 3, 6, None)))
    }

    "correctly parse chunk coordinates with additional axes" in {
      val parsed1 = ZarrCoordinatesParser
        .parseNDimensionalDotCoordinates(
          "0.1.2.3.4.5.6.7",
          Some(
            Seq(AdditionalAxis("a", Seq(1, 10), 1),
                AdditionalAxis("b", Seq(1, 10), 2),
                AdditionalAxis("c", Seq(1, 10), 3),
                AdditionalAxis("d", Seq(1, 10), 4)))
        )
        .await("test")
      assert(
        parsed1 == Full(5,
                        6,
                        7,
                        Some(
                          List(AdditionalCoordinate("a", 1),
                               AdditionalCoordinate("b", 2),
                               AdditionalCoordinate("c", 3),
                               AdditionalCoordinate("d", 4)))))

    }

    "reject invalid chunk coordinates" in {
      assert(ZarrCoordinatesParser.parseNDimensionalDotCoordinates("0.1.2.3.4.5.6.7", None).await("test").isEmpty)
      assert(ZarrCoordinatesParser.parseNDimensionalDotCoordinates("0.1.2", None).await("test").isEmpty)
      assert(ZarrCoordinatesParser.parseNDimensionalDotCoordinates("notAnInt0.1.2", None).await("test").isEmpty)
      assert(ZarrCoordinatesParser.parseNDimensionalDotCoordinates("notAnInt", None).await("test").isEmpty)
      assert(ZarrCoordinatesParser.parseNDimensionalDotCoordinates("", None).await("test").isEmpty)
    }

  }

}
