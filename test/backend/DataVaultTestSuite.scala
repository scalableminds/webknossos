package backend

import com.scalableminds.util.tools.Fox
import org.scalatestplus.play.PlaySpec

import java.net.URI
import com.scalableminds.webknossos.datastore.datavault.{
  DataVault,
  Encoding,
  GoogleCloudDataVault,
  HttpsDataVault,
  RangeSpecifier,
  VaultPath
}
import com.scalableminds.webknossos.datastore.storage.RemoteSourceDescriptor
import play.api.test.WsTestClient

import scala.collection.immutable.NumericRange
import scala.concurrent.ExecutionContext
import scala.concurrent.ExecutionContext.{global => globalExecutionContext}

class DataVaultTestSuite extends PlaySpec {

  val openFoxJustification = "Opening Fox in Unit Test Context"

  "Data vault" when {
    "using Range requests" when {
      val range: NumericRange[Long] = Range.Long(0, 1024, 1)
      val dataKey = "32_32_40/15360-15424_8384-8448_3520-3584" // when accessed via range request, the response body is 1024 bytes long, otherwise 124.8 KB

      "with HTTP Vault" should {
        "return correct response" in {
          WsTestClient.withClient { ws =>
            val uri = new URI("http://storage.googleapis.com/")
            val vaultPath = new VaultPath(uri, HttpsDataVault.create(RemoteSourceDescriptor(uri, None), ws))
            val bytes =
              (vaultPath / s"neuroglancer-fafb-data/fafb_v14/fafb_v14_orig/$dataKey")
                .readBytes(Some(range))(globalExecutionContext)
                .get(openFoxJustification)

            assert(bytes.length == range.length)
            assert(bytes.take(10).sameElements(Array(-1, -40, -1, -32, 0, 16, 74, 70, 73, 70)))
          }
        }
      }

      "with Google Cloud Storage Vault" should {
        "return correct response" in {
          val uri = new URI("gs://neuroglancer-fafb-data/fafb_v14/fafb_v14_orig")
          val vaultPath = new VaultPath(uri, GoogleCloudDataVault.create(RemoteSourceDescriptor(uri, None)))
          val bytes = (vaultPath / dataKey).readBytes(Some(range))(globalExecutionContext).get(openFoxJustification)

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
          WsTestClient.withClient { ws =>
            val uri = new URI("http://storage.googleapis.com/")
            val vaultPath = new VaultPath(uri, HttpsDataVault.create(RemoteSourceDescriptor(uri, None), ws))
            val bytes = (vaultPath / s"neuroglancer-fafb-data/fafb_v14/fafb_v14_orig/$dataKey")
              .readBytes()(globalExecutionContext)
              .get(openFoxJustification)

            assert(bytes.length == dataLength)
            assert(bytes.take(10).sameElements(Array(-1, -40, -1, -32, 0, 16, 74, 70, 73, 70)))
          }
        }
      }

      "with Google Cloud Storage Vault" should {
        "return correct response" in {
          val uri = new URI("gs://neuroglancer-fafb-data/fafb_v14/fafb_v14_orig")
          val vaultPath = new VaultPath(uri, GoogleCloudDataVault.create(RemoteSourceDescriptor(uri, None)))
          val bytes = (vaultPath / dataKey).readBytes()(globalExecutionContext).get(openFoxJustification)

          assert(bytes.length == dataLength)
          assert(bytes.take(10).sameElements(Array(-1, -40, -1, -32, 0, 16, 74, 70, 73, 70)))
        }
      }
    }

    "using vault path" when {
      class MockDataVault extends DataVault {
        override def readBytesAndEncoding(path: VaultPath, range: RangeSpecifier)(
            implicit ec: ExecutionContext): Fox[(Array[Byte], Encoding.Value)] = ???
      }

      "Uri has no trailing slash" should {
        val someUri = new URI("protocol://host/a/b")
        val somePath = new VaultPath(someUri, new MockDataVault)

        "resolve child" in {
          val childPath = somePath / "c"
          assert(childPath.toUri.toString == s"${someUri.toString}/c")
        }

        "get parent" in {
          assert((somePath / "..").toString == "protocol://host/a/")
        }

        "get directory" in {
          assert((somePath / ".").toString == s"${someUri.toString}/")
        }

        "handle sequential parameters" in {
          assert((somePath / "c" / "d" / "e").toString == "protocol://host/a/b/c/d/e")
        }

        "resolve relative to host with starting slash in parameter" in {
          assert((somePath / "/x").toString == "protocol://host/x")
        }

        "resolving path respects trailing slash" in {
          assert((somePath / "x/").toString == "protocol://host/a/b/x/")
          assert((somePath / "x").toString == "protocol://host/a/b/x")
        }
      }
      "Uri has trailing slash" should {
        val trailingSlashUri = new URI("protocol://host/a/b/")
        val trailingSlashPath = new VaultPath(trailingSlashUri, new MockDataVault)
        "resolve child" in {
          val childPath = trailingSlashPath / "c"
          assert(childPath.toUri.toString == s"${trailingSlashUri.toString}c")
        }

        "get parent" in {
          assert((trailingSlashPath / "..").toString == "protocol://host/a/")
        }

        "get directory" in {
          assert((trailingSlashPath / ".").toString == s"${trailingSlashUri.toString}")
        }
      }

    }
  }
}
