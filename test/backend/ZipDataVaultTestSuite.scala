package backend

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.tools.{Empty, Failure, Full}
import com.scalableminds.webknossos.datastore.datavault.{ByteRange, FileSystemDataVault, VaultPath, ZipDataVault}
import com.scalableminds.webknossos.datastore.helpers.{UPath, ZipEntryUPath}
import org.scalatest.BeforeAndAfterAll
import org.scalatest.wordspec.AsyncWordSpec

import java.io.FileOutputStream
import java.nio.file.{Files, Path}
import java.util.zip.{CRC32, ZipEntry, ZipOutputStream}
import scala.concurrent.ExecutionContext.{global => globalExecutionContext}

class ZipDataVaultTestSuite extends AsyncWordSpec with BeforeAndAfterAll {

  private val emptyTokenContext: TokenContext = TokenContext(None)

  private val testZipPath: Path = Files.createTempFile("wk-zip-vault-test", ".zip")

  // Known content for entries
  private val dirFileContent: Array[Byte] = "hello world".getBytes("UTF-8") // 11 bytes
  private val deepFileContent: Array[Byte] = "deep content".getBytes("UTF-8") // 12 bytes
  private val rootFileContent: Array[Byte] = "root file content!!".getBytes("UTF-8") // 19 bytes

  override def beforeAll(): Unit = {
    val out = new ZipOutputStream(new FileOutputStream(testZipPath.toFile))

    def addStored(name: String, data: Array[Byte]): Unit = {
      val entry = new ZipEntry(name)
      entry.setMethod(ZipEntry.STORED)
      entry.setSize(data.length)
      entry.setCompressedSize(data.length)
      val crc = new CRC32()
      crc.update(data)
      entry.setCrc(crc.getValue)
      out.putNextEntry(entry)
      out.write(data)
      out.closeEntry()
    }

    // Explicit directory entries so listDirectory returns them as direct children.
    addStored("dir/", Array.emptyByteArray)
    addStored("dir/subdir/", Array.emptyByteArray)
    // File entries
    addStored("dir/file.txt", dirFileContent)
    addStored("dir/subdir/deep.txt", deepFileContent)
    addStored("root.txt", rootFileContent)
    // One DEFLATED entry to verify unsupported-compression error path.
    out.setMethod(ZipOutputStream.DEFLATED)
    val deflated = new ZipEntry("compressed.txt")
    out.putNextEntry(deflated)
    out.write("compressed content".getBytes("UTF-8"))
    out.closeEntry()

    out.close()
  }

  override def afterAll(): Unit =
    Files.deleteIfExists(testZipPath)

  private def makeZipVault(): (ZipDataVault, UPath) = {
    val outerUPath = UPath.fromLocalPath(testZipPath)
    val outerVaultPath = new VaultPath(outerUPath, FileSystemDataVault.create)
    (new ZipDataVault(outerVaultPath), outerUPath)
  }

  "ZipDataVault" when {
    "reading entries" should {

      "read a stored entry in full" in {
        val (vault, outerUPath) = makeZipVault()
        val path = new VaultPath(ZipEntryUPath(outerUPath, "dir/file.txt"), vault)
        path.readBytes()(using globalExecutionContext, emptyTokenContext).futureBox.map {
          case Full(bytes) => assert(bytes.sameElements(dirFileContent))
          case other       => fail(s"Expected Full, got $other")
        }
      }

      "read a stored entry with a start-end range" in {
        val (vault, outerUPath) = makeZipVault()
        val path = new VaultPath(ZipEntryUPath(outerUPath, "root.txt"), vault)
        path
          .readBytes(ByteRange.startEndExclusive(0, 4))(using globalExecutionContext, emptyTokenContext)
          .futureBox
          .map {
            case Full(bytes) =>
              assert(bytes.length == 4)
              assert(new String(bytes, "UTF-8") == "root")
            case other => fail(s"Expected Full, got $other")
          }
      }

      "read a stored entry with a suffix range" in {
        val (vault, outerUPath) = makeZipVault()
        val path = new VaultPath(ZipEntryUPath(outerUPath, "root.txt"), vault)
        path.readBytes(ByteRange.suffix(2))(using globalExecutionContext, emptyTokenContext).futureBox.map {
          case Full(bytes) =>
            assert(bytes.length == 2)
            assert(new String(bytes, "UTF-8") == "!!")
          case other => fail(s"Expected Full, got $other")
        }
      }

      "return Empty for a non-existent entry" in {
        val (vault, outerUPath) = makeZipVault()
        val path = new VaultPath(ZipEntryUPath(outerUPath, "does-not-exist.txt"), vault)
        path.readBytes()(using globalExecutionContext, emptyTokenContext).futureBox.map {
          case Empty => succeed
          case other => fail(s"Expected Empty, got $other")
        }
      }

      "return Failure for a compressed (non-STORED) entry" in {
        val (vault, outerUPath) = makeZipVault()
        val path = new VaultPath(ZipEntryUPath(outerUPath, "compressed.txt"), vault)
        path.readBytes()(using globalExecutionContext, emptyTokenContext).futureBox.map {
          case Failure(_, _, _) => succeed
          case other            => fail(s"Expected Failure, got $other")
        }
      }
    }

    "listing directories" should {

      "list direct children of the zip root" in {
        val (vault, outerUPath) = makeZipVault()
        val path = new VaultPath(ZipEntryUPath(outerUPath, ""), vault)
        path.listDirectory(maxItems = 20)(using globalExecutionContext, emptyTokenContext).futureBox.map {
          case Full(children) =>
            val innerPaths = children
              .map(_.toUPath match {
                case ZipEntryUPath(_, ip) => ip
                case _                    => fail("Expected ZipEntryUPath")
              })
              .toSet
            assert(innerPaths.contains("dir"))
            assert(innerPaths.contains("root.txt"))
            assert(innerPaths.contains("compressed.txt"))
            // deeply nested paths must not appear as direct root children
            assert(!innerPaths.contains("dir/file.txt"))
            assert(!innerPaths.contains("dir/subdir"))
          case other => fail(s"Expected Full, got $other")
        }
      }

      "list direct children of a subdirectory" in {
        val (vault, outerUPath) = makeZipVault()
        val path = new VaultPath(ZipEntryUPath(outerUPath, "dir"), vault)
        path.listDirectory(maxItems = 20)(using globalExecutionContext, emptyTokenContext).futureBox.map {
          case Full(children) =>
            val innerPaths = children
              .map(_.toUPath match {
                case ZipEntryUPath(_, ip) => ip
                case _                    => fail("Expected ZipEntryUPath")
              })
              .toSet
            assert(innerPaths.contains("dir/file.txt"))
            assert(innerPaths.contains("dir/subdir"))
            // deeply nested entry must not appear as direct child of dir
            assert(!innerPaths.contains("dir/subdir/deep.txt"))
            // root entries must not bleed in
            assert(!innerPaths.contains("root.txt"))
          case other => fail(s"Expected Full, got $other")
        }
      }
    }
  }
}
