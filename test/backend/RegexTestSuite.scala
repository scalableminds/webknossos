package backend

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.webknossos.datastore.dataformats.wkw.WKWDataFormatHelper
import com.scalableminds.webknossos.datastore.dataformats.zarr.ZarrCoordinatesParser
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeDataZipHelper
import org.scalatestplus.play.PlaySpec

class RegexTestSuite extends PlaySpec with WKWDataFormatHelper with VolumeDataZipHelper {
  // Test a couple of regexes used in webknossos

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

  "zarr chunk path parsing" should {
    "parse paths correctly" in {
      parseZarrChunkPath("a/random/path/to/32-32-16/z6/y5/x4.wkw").contains(
        BucketPosition(4 * 32 * DataLayer.bucketLength,
          5 * 32 * DataLayer.bucketLength,
          6 * 16 * DataLayer.bucketLength,
          Vec3Int(32, 32, 16),
          None))
      )
    }
  }

}
