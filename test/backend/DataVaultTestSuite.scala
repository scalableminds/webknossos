package backend

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.tools.Fox
import org.scalatest.wordspec.AsyncWordSpec

import java.net.URI
import com.scalableminds.webknossos.datastore.datavault.{
  ByteRange,
  DataVault,
  Encoding,
  GoogleCloudDataVault,
  HttpsDataVault,
  S3DataVault,
  StartEndExclusiveByteRange,
  SuffixLengthByteRange,
  VaultPath
}
import com.scalableminds.webknossos.datastore.storage.{CredentializedUPath, GoogleServiceAccountCredential}
import com.scalableminds.util.tools.{Box, Empty, EmptyBox, Failure, Full}
import com.scalableminds.webknossos.datastore.helpers.UPath
import org.scalatest.Assertion
import play.api.libs.json.JsString
import play.api.test.WsTestClient

import java.nio.charset.StandardCharsets
import java.util.UUID
import scala.concurrent.ExecutionContext
import scala.concurrent.ExecutionContext.{global => globalExecutionContext}

class DataVaultTestSuite extends AsyncWordSpec {

  val emptyTokenContext: TokenContext = TokenContext(None)
  val dummyDataStoreHost = "example.com"

  "Data vault" when {
    "checking environment" should {
      "not have interfering env vars set" in {
        if (sys.env.contains("AWS_ACCESS_KEY_ID") || sys.env.contains("AWS_SECRET_ACCESS_KEY")) {
          fail("Environment variables AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be unset for this test suite!")
        } else succeed
      }
    }

    "using Range requests" when {
      val range: StartEndExclusiveByteRange = ByteRange.startEndExclusive(0, 100)
      val suffixRange: SuffixLengthByteRange = ByteRange.suffix(100)
      val dataKey = "32_32_40/15360-15424_8384-8448_3520-3584" // when accessed via range request, the response body is 1024 bytes long, otherwise 124.8 KB

      "using HTTP Vault" should {
        "return correct response" in {
          WsTestClient.withClient { ws =>
            val upath = UPath.fromStringUnsafe("http://storage.googleapis.com/")
            val vaultPath =
              new VaultPath(upath, HttpsDataVault.create(CredentializedUPath(upath, None), ws, dummyDataStoreHost))
            (vaultPath / s"neuroglancer-fafb-data/fafb_v14/fafb_v14_orig/$dataKey")
              .readBytes(range)(globalExecutionContext, emptyTokenContext)
              .futureBox
              .map {
                case Full(bytes) =>
                  assert(bytes.length == range.length)
                  assert(bytes.take(10).sameElements(Array(-1, -40, -1, -32, 0, 16, 74, 70, 73, 70)))
                case _ => fail()
              }
          }
        }
      }

      "using Google Cloud Storage Vault" should {
        val upath = UPath.fromStringUnsafe("gs://neuroglancer-fafb-data/fafb_v14/fafb_v14_orig")
        val vaultPath = new VaultPath(upath, GoogleCloudDataVault.create(CredentializedUPath(upath, None)))
        "return correct response (start-end range)" in {
          (vaultPath / dataKey)
            .readBytesEncodingAndRangeHeader(range)(globalExecutionContext, emptyTokenContext)
            .futureBox
            .map {
              case Full((bytes, encoding, rangeHeader)) =>
                assert(bytes.length == range.length)
                assert(encoding == Encoding.identity)
                assert(rangeHeader.contains("bytes 0-99/127808"))
                assert(bytes.take(10).sameElements(Array(-1, -40, -1, -32, 0, 16, 74, 70, 73, 70)))
              case _ => fail()
            }
        }

        "return correct response (suffix-length range)" in {
          (vaultPath / dataKey)
            .readBytesEncodingAndRangeHeader(suffixRange)(globalExecutionContext, emptyTokenContext)
            .futureBox
            .map {
              case Full((bytes, encoding, rangeHeader)) =>
                assert(bytes.length == suffixRange.length)
                assert(encoding == Encoding.identity)
                assert(rangeHeader.contains("bytes 127708-127807/127808"))
                assert(bytes.takeRight(10).sameElements(Array(-61, 45, -114, -64, -109, -64, 25, -81, -1, -39)))
              case _ => fail()
            }
        }

        "return empty box" when {
          "requesting a non-existent object" in {
            (vaultPath / s"non-existent-key${UUID.randomUUID}")
              .readBytes()(globalExecutionContext, emptyTokenContext)
              .futureBox
              .map(assertBoxEmpty)
          }
        }
        "return failure" when {
          "requesting invalid range" in {
            (vaultPath / dataKey)
              .readBytes(ByteRange.startEndExclusive(-5, -10))(globalExecutionContext, emptyTokenContext)
              .futureBox
              .map(assertBoxFailure)
          }
          "using invalid credentials" in {
            val vaultPath =
              new VaultPath(
                upath,
                GoogleCloudDataVault.create(
                  CredentializedUPath(
                    upath,
                    Some(GoogleServiceAccountCredential("name", JsString("secret"), Some("user"), Some("org")))))
              )
            (vaultPath / dataKey)
              .readBytes(ByteRange.startEndExclusive(-10, 10))(globalExecutionContext, emptyTokenContext)
              .futureBox
              .map(assertBoxFailure)
          }
        }
        "decode gzip correctly" in {
          val upathGzip =
            UPath.fromStringUnsafe("gs://neuroglancer-public-data/kasthuri2011/image_color_corrected/info")
          val vaultPathGzip =
            new VaultPath(upathGzip, GoogleCloudDataVault.create(CredentializedUPath(upathGzip, None)))
          for {
            bytesBox <- vaultPathGzip.readBytes()(globalExecutionContext, emptyTokenContext).futureBox
            headerBox <- vaultPathGzip
              .readBytesEncodingAndRangeHeader()(globalExecutionContext, emptyTokenContext)
              .futureBox
          } yield {
            (bytesBox, headerBox) match {
              case (Full(bytes), Full((_, encoding, _))) =>
                val decoded = new String(bytes, StandardCharsets.UTF_8)
                assert(encoding == Encoding.gzip)
                assert(decoded.length == 1313)
                assert(decoded(0) == '{')
              case _ => fail()
            }
          }
        }
        "fail when attempting range request on gzipped data" in {
          val upathGzip =
            UPath.fromStringUnsafe("gs://neuroglancer-public-data/kasthuri2011/image_color_corrected/info")
          val vaultPathGzip =
            new VaultPath(upathGzip, GoogleCloudDataVault.create(CredentializedUPath(upathGzip, None)))
          vaultPathGzip
            .readBytes(ByteRange.startEndExclusive(0, 100))(globalExecutionContext, emptyTokenContext)
            .futureBox
            .map(assertBoxFailure)
        }

      }
      "using S3 data vault" should {
        "return correct response" in {
          val upath = UPath.fromStringUnsafe("s3://janelia-cosem-datasets/jrc_hela-3/jrc_hela-3.n5/em/fibsem-uint16/")
          WsTestClient.withClient { ws =>
            val vaultPath =
              new VaultPath(upath, S3DataVault.create(CredentializedUPath(upath, None), ws)(globalExecutionContext))
            (vaultPath / "s0/5/5/5").readBytes(range)(globalExecutionContext, emptyTokenContext).futureBox.map {
              case Full(bytes) =>
                assert(bytes.length == range.length)
                assert(bytes.take(10).sameElements(Array(0, 0, 0, 3, 0, 0, 0, 64, 0, 0)))
              case f: Failure => fail(f.msg)
              case Empty      => fail("Empty")
            }
          }
        }
      }
    }

    "using regular readBytes requests" when {
      val dataKey = "32_32_40/15360-15424_8384-8448_3520-3584"
      val dataLength = 127808

      "using HTTP Vault" should {
        "return correct response" in {
          WsTestClient.withClient { ws =>
            val upath = UPath.fromStringUnsafe("http://storage.googleapis.com/")
            val vaultPath =
              new VaultPath(upath, HttpsDataVault.create(CredentializedUPath(upath, None), ws, dummyDataStoreHost))
            (vaultPath / s"neuroglancer-fafb-data/fafb_v14/fafb_v14_orig/$dataKey")
              .readBytes()(globalExecutionContext, emptyTokenContext)
              .futureBox
              .map {
                case Full(bytes) =>
                  assert(bytes.length == dataLength)
                  assert(bytes.take(10).sameElements(Array(-1, -40, -1, -32, 0, 16, 74, 70, 73, 70)))
                case _ => fail()
              }
          }
        }
      }

      "using Google Cloud Storage Vault" should {
        "return correct response" in {
          val upath = UPath.fromStringUnsafe("gs://neuroglancer-fafb-data/fafb_v14/fafb_v14_orig")
          val vaultPath = new VaultPath(upath, GoogleCloudDataVault.create(CredentializedUPath(upath, None)))
          (vaultPath / dataKey).readBytes()(globalExecutionContext, emptyTokenContext).futureBox.map {
            case Full(bytes) =>
              assert(bytes.length == dataLength)
              assert(bytes.take(10).sameElements(Array(-1, -40, -1, -32, 0, 16, 74, 70, 73, 70)))
            case _ => fail()
          }
        }
      }

      "using s3 data vault" should {
        "return correctly decoded brotli-compressed data" in {
          val upath = UPath.fromStringUnsafe("s3://open-neurodata/bock11/image/4_4_40")
          WsTestClient.withClient { ws =>
            val vaultPath =
              new VaultPath(upath, S3DataVault.create(CredentializedUPath(upath, None), ws)(globalExecutionContext))
            (vaultPath / "33792-34304_29696-30208_3216-3232")
              .readBytes()(globalExecutionContext, emptyTokenContext)
              .futureBox
              .map {
                case Full(bytes) =>
                  assert(bytes.take(10).sameElements(Array(-87, -95, -85, -94, -101, 124, 115, 100, 113, 111)))
                case _ => fail()
              }
          }
        }

        "return empty box" when {
          "requesting a non-existent bucket" in {
            val upath = UPath.fromStringUnsafe(s"s3://non-existent-bucket${UUID.randomUUID}/non-existent-object")
            WsTestClient.withClient { ws =>
              val s3DataVault = S3DataVault.create(CredentializedUPath(upath, None), ws)(globalExecutionContext)
              val vaultPath = new VaultPath(upath, s3DataVault)
              vaultPath.readBytes()(globalExecutionContext, emptyTokenContext).futureBox.map(assertBoxEmpty)
            }
          }
        }

        "return empty box" when {
          "requesting a non-existent object in existent bucket" in {
            val upath = UPath.fromStringUnsafe(s"s3://open-neurodata/non-existent-object${UUID.randomUUID}")
            WsTestClient.withClient { ws =>
              val s3DataVault = S3DataVault.create(CredentializedUPath(upath, None), ws)(globalExecutionContext)
              val vaultPath = new VaultPath(upath, s3DataVault)
              vaultPath.readBytes()(globalExecutionContext, emptyTokenContext).futureBox.map(assertBoxEmpty)
            }
          }
        }
      }
    }

    "using directory list requests" when {
      val upath = UPath.fromStringUnsafe("s3://janelia-cosem-datasets/jrc_hela-3/jrc_hela-3.n5/em/fibsem-uint16/")

      "using s3 data vault" should {
        "list available directories" in {
          WsTestClient.withClient { ws =>
            val vaultPath =
              new VaultPath(upath, S3DataVault.create(CredentializedUPath(upath, None), ws)(globalExecutionContext))
            vaultPath.listDirectory(maxItems = 3)(globalExecutionContext).futureBox.map {
              case Full(result) =>
                assert(result.length == 3)
                assert(result.exists(_.toRemoteUriUnsafe == new URI(
                  "s3://janelia-cosem-datasets/jrc_hela-3/jrc_hela-3.n5/em/fibsem-uint16/s0/")))
              case _ => fail()
            }
          }
        }

        "return failure" when {
          "requesting directory listing on non-existent bucket" in {
            val nonExistentUpath =
              UPath.fromStringUnsafe(f"s3://non-existent-bucket${UUID.randomUUID}/non-existent-object/")
            WsTestClient.withClient { ws =>
              val s3DataVault =
                S3DataVault.create(CredentializedUPath(nonExistentUpath, None), ws)(globalExecutionContext)
              val vaultPath = new VaultPath(nonExistentUpath, s3DataVault)
              vaultPath.listDirectory(maxItems = 5)(globalExecutionContext).futureBox.map(assertBoxFailure)
            }
          }
        }

      }
    }

    "using vault path" when {
      class MockDataVault extends DataVault {
        override def readBytesEncodingAndRangeHeader(path: VaultPath, range: ByteRange)(
            implicit ec: ExecutionContext,
            tc: TokenContext): Fox[(Array[Byte], Encoding.Value, Option[String])] = ???

        override def listDirectory(path: VaultPath,
                                   maxItems: Int)(implicit ec: ExecutionContext): Fox[List[VaultPath]] = ???

        override def getUsedStorageBytes(path: VaultPath)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Long] =
          ???
      }

      "Uri has no trailing slash" should {
        val someUpath = UPath.fromStringUnsafe("protocol://host/a/b")
        val somePath = new VaultPath(someUpath, new MockDataVault)

        "resolve child" in {
          val childPath = somePath / "c"
          assert(childPath.toRemoteUriUnsafe.toString == s"${someUpath.toString}/c")
        }

        "get parent" in {
          assert((somePath / "..").toString == "protocol://host/a")
        }

        "get directory" in {
          assert((somePath / ".").toString == someUpath.toString)
        }

        "handle sequential parameters" in {
          assert((somePath / "c" / "d" / "e").toString == "protocol://host/a/b/c/d/e")
        }

        "resolve and keep respect trailing slash" in {
          assert((somePath / "x/").toString == "protocol://host/a/b/x/")
          assert((somePath / "x").toString == "protocol://host/a/b/x")
        }
      }
      "Uri has trailing slash" should {
        val trailingSlashUpath = UPath.fromStringUnsafe("protocol://host/a/b/")
        val trailingSlashPath = new VaultPath(trailingSlashUpath, new MockDataVault)
        "resolve child" in {
          val childPath = trailingSlashPath / "c"
          assert(childPath.toRemoteUriUnsafe.toString == s"${trailingSlashUpath.toString}c")
        }

        "get parent" in {
          assert((trailingSlashPath / "..").toString == "protocol://host/a")
        }

        "get directory" in {
          assert((trailingSlashPath / ".").toString == trailingSlashUpath.toString.dropRight(1))
        }
      }

      "comparing two" should {
        "correctly identify equality" in {
          val mockDataVault = new MockDataVault
          val somePath = new VaultPath(UPath.fromStringUnsafe("protocol://host/a/b"), mockDataVault)
          val samePath = new VaultPath(UPath.fromStringUnsafe("protocol://host/a/b"), mockDataVault)
          assert(somePath == samePath)
        }
        "correctly identify inequality" in {
          val mockDataVault = new MockDataVault
          val somePath = new VaultPath(UPath.fromStringUnsafe("protocol://host/a/b"), mockDataVault)
          val someOtherPath = new VaultPath(UPath.fromStringUnsafe("protocol://host/a/c"), mockDataVault)
          assert(somePath != someOtherPath)
        }
      }

    }
  }

  private def assertBoxEmpty(box: Box[_]): Assertion = box match {
    case Full(_) => fail()
    case box: EmptyBox =>
      box match {
        case Empty            => succeed
        case Failure(_, _, _) => fail()
      }
  }

  private def assertBoxFailure(box: Box[_]): Assertion = box match {
    case Full(_) => fail()
    case box: EmptyBox =>
      box match {
        case Empty            => fail()
        case Failure(_, _, _) => succeed
      }
  }
}
