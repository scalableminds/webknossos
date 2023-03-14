package backend

import org.scalatestplus.play.PlaySpec

import java.net.URI
import com.scalableminds.webknossos.datastore.datavault.{GoogleCloudDataVault, HttpsDataVault}
import com.scalableminds.webknossos.datastore.storage.RemoteSourceDescriptor

import scala.collection.immutable.NumericRange

class DataVaultTestSuite extends PlaySpec {

  "Data vault" when {
    "using Range requests" when {
      val range: NumericRange[Long] = Range.Long(0, 1024, 1)
      val dataKey = "32_32_40/15360-15424_8384-8448_3520-3584" // when accessed via range request, the response body is 1024 bytes long, otherwise 124.8 KB

      "with HTTP Vault" should {
        "return correct response" in {
          val uri = new URI("http://storage.googleapis.com/")
          val vaultPath = HttpsDataVault.create(RemoteSourceDescriptor(uri, None))
          val bytes =
            (vaultPath / s"/neuroglancer-fafb-data/fafb_v14/fafb_v14_orig/$dataKey").readBytes(Some(range)).get

          assert(bytes.length == range.length)
          assert(bytes.take(10).sameElements(Array(-1, -40, -1, -32, 0, 16, 74, 70, 73, 70)))
        }
      }

      "with Google Cloud Storage Vault" should {
        "return correct response" in {
          val uri = new URI("gs://neuroglancer-fafb-data/fafb_v14/fafb_v14_orig")
          val vaultPath = GoogleCloudDataVault.create(RemoteSourceDescriptor(uri, None))
          val bytes = (vaultPath / s"fafb_v14_orig/$dataKey").readBytes(Some(range)).get

          assert(bytes.length == range.length)
          assert(bytes.take(10).sameElements(Array(-1, -40, -1, -32, 0, 16, 74, 70, 73, 70)))
        }
      }
    }
    "using regular requests" when {
      val dataKey = "32_32_40/15360-15424_8384-8448_3520-3584"
      val dataLength = 127808

      "with HTTP Vault" should {
        "return correct response" in {
          val uri = new URI("http://storage.googleapis.com/")
          val vaultPath = HttpsDataVault.create(RemoteSourceDescriptor(uri, None))
          val bytes = (vaultPath / s"/neuroglancer-fafb-data/fafb_v14/fafb_v14_orig/$dataKey").readBytes().get

          assert(bytes.length == dataLength)
          assert(bytes.take(10).sameElements(Array(-1, -40, -1, -32, 0, 16, 74, 70, 73, 70)))
        }
      }

      "with Google Cloud Storage Vault" should {
        "return correct response" in {
          val uri = new URI("gs://neuroglancer-fafb-data/fafb_v14/fafb_v14_orig")
          val vaultPath = GoogleCloudDataVault.create(RemoteSourceDescriptor(uri, None))
          val bytes = (vaultPath / s"fafb_v14_orig/$dataKey").readBytes().get

          assert(bytes.length == dataLength)
          assert(bytes.take(10).sameElements(Array(-1, -40, -1, -32, 0, 16, 74, 70, 73, 70)))
        }
      }
    }
  }
}
