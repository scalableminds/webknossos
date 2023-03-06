package backend

import com.google.cloud.storage.StorageOptions
import com.google.cloud.storage.contrib.nio.{CloudStorageConfiguration, CloudStorageFileSystem}
import com.scalableminds.webknossos.datastore.storage.httpsfilesystem.{HttpsFileSystem, HttpsPath}
import org.scalatestplus.play.PlaySpec

import java.net.URI
import com.scalableminds.webknossos.datastore.datareaders.FileSystemStore

class RangeRequestTestSuite extends PlaySpec {

  "Range requests" when {
    val range = 0 to 1023
    val dataKey = "32_32_40/15360-15424_8384-8448_3520-3584" // when accessed via range request, the response body is 1024 bytes long, otherwise 124.8 KB

    "with HTTP FileSystem" should {
      "return correct response" in {
        val uri = new URI("http://storage.googleapis.com/")
        val fileSystem = HttpsFileSystem.forUri(uri)
        val httpsPath = new HttpsPath(uri, fileSystem)
        val store = new FileSystemStore(httpsPath)
        val bytes = store
          .readByteRange(s"/neuroglancer-fafb-data/fafb_v14/fafb_v14_orig/$dataKey", range, useCustomRangeOption = true)
          .get

        assert(bytes.length == range.length)
        assert(bytes.take(10).sameElements(Array(-1, -40, -1, -32, 0, 16, 74, 70, 73, 70)))
      }
    }

    "with Google Cloud FileSystem" should {
      "return correct response" in {
        val uri = new URI("gs://neuroglancer-fafb-data/fafb_v14/fafb_v14_orig")
        val fileSystem = CloudStorageFileSystem.forBucket("neuroglancer-fafb-data",
                                                          CloudStorageConfiguration.DEFAULT,
                                                          StorageOptions.newBuilder().build())
        val path = fileSystem.provider().getPath(uri)
        val store = new FileSystemStore(path)
        val bytes = store.readByteRange(s"/fafb_v14/fafb_v14_orig/$dataKey", range).get

        assert(bytes.length == range.length)
        assert(bytes.take(10).sameElements(Array(-1, -40, -1, -32, 0, 16, 74, 70, 73, 70)))
      }
    }
  }
}
