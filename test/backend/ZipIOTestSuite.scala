package backend

import com.scalableminds.util.box.{Box, Failure, Full}
import com.scalableminds.util.io.ZipIO
import org.scalatest.wordspec.AsyncWordSpec

import java.io.{File, FileOutputStream}
import java.nio.file.{Files, Path}
import java.util.zip.{ZipEntry, ZipOutputStream}

class ZipIOTestSuite extends AsyncWordSpec {

  private def createZip(entryNames: Seq[String]): File = {
    val zipFile = Files.createTempFile("zipio-test", ".zip").toFile
    zipFile.deleteOnExit()
    val zipOut = new ZipOutputStream(new FileOutputStream(zipFile))
    try
      entryNames.foreach { name =>
        zipOut.putNextEntry(new ZipEntry(name))
        zipOut.write(s"content of $name".getBytes)
        zipOut.closeEntry()
      }
    finally zipOut.close()
    zipFile
  }

  private def createTargetDir(): Path = Files.createTempDirectory("zipio-target")

  private def unzip(zipFile: File, targetDir: Path, truncateCommonPrefix: Boolean = false): Box[List[Path]] =
    ZipIO.unzipToDirectory(
      zipFile,
      targetDir,
      includeHiddenFiles = false,
      hiddenFilesWhitelist = List.empty,
      truncateCommonPrefix = truncateCommonPrefix,
      excludeFromPrefix = None
    )

  "ZipIO.unzipToDirectory" should {

    "extract normal, nested files into the target directory" in {
      val zipFile = createZip(Seq("a.txt", "sub/b.txt", "sub/deeper/c.txt"))
      val targetDir = createTargetDir()

      val result = unzip(zipFile, targetDir)

      assert(result.isDefined)
      assert(Files.exists(targetDir.resolve("a.txt")))
      assert(Files.exists(targetDir.resolve("sub/b.txt")))
      assert(Files.exists(targetDir.resolve("sub/deeper/c.txt")))
      assert(Files.readString(targetDir.resolve("a.txt")) == "content of a.txt")
    }

    "truncate the common prefix of all entries when requested" in {
      val zipFile = createZip(Seq("root/a.txt", "root/sub/b.txt"))
      val targetDir = createTargetDir()

      val result = unzip(zipFile, targetDir, truncateCommonPrefix = true)

      assert(result.isDefined)
      assert(Files.exists(targetDir.resolve("a.txt")))
      assert(Files.exists(targetDir.resolve("sub/b.txt")))
      assert(!Files.exists(targetDir.resolve("root")))
    }

    "reject a zip entry that uses .. segments to escape the target directory (zip slip)" in {
      val zipFile = createZip(Seq("../evil.txt"))
      val targetDir = createTargetDir()

      val result = unzip(zipFile, targetDir)

      assert(result.isInstanceOf[Failure])
      assert(!Files.exists(targetDir.getParent.resolve("evil.txt")))
    }

    "reject a zip entry that mixes .. segments to still net escape the target directory (zip slip)" in {
      val zipFile = createZip(Seq("sub/../../evil.txt"))
      val targetDir = createTargetDir()

      val result = unzip(zipFile, targetDir)

      assert(result.isInstanceOf[Failure])
      assert(!Files.exists(targetDir.getParent.resolve("evil.txt")))
    }

    "reject a zip entry with an absolute path (zip slip)" in {
      val evilFile = Files.createTempFile("zipio-should-not-be-written", ".txt")
      Files.delete(evilFile)
      val zipFile = createZip(Seq(evilFile.toAbsolutePath.toString))
      val targetDir = createTargetDir()

      val result = unzip(zipFile, targetDir)

      assert(result.isInstanceOf[Failure])
      assert(!Files.exists(evilFile))
    }

    "not fail benign entries that merely contain .. segments which stay within the target directory" in {
      val zipFile = createZip(Seq("sub/../a.txt"))
      val targetDir = createTargetDir()

      val result = unzip(zipFile, targetDir)

      assert(result.isDefined)
      assert(Files.exists(targetDir.resolve("a.txt")))
    }
  }

  "ZipIO.withUnziped" should {

    "expose only entry paths that are safe, relative, and normalized" in {
      val zipFile = createZip(Seq("a.txt", "sub/b.txt"))
      var seenPaths: List[Path] = List.empty

      val result = ZipIO.withUnziped(new java.util.zip.ZipFile(zipFile)) { (path, _) =>
        seenPaths ::= path
        Full(())
      }

      assert(result.isDefined)
      assert(seenPaths.toSet == Set(Path.of("a.txt"), Path.of("sub/b.txt")))
    }

    "fail with a Failure instead of invoking the callback for unsafe entries" in {
      val zipFile = createZip(Seq("../evil.txt"))
      var callbackInvoked = false

      val result = ZipIO.withUnziped(new java.util.zip.ZipFile(zipFile)) { (_, _) =>
        callbackInvoked = true
        Full(())
      }

      assert(result.isInstanceOf[Failure])
      assert(!callbackInvoked)
    }
  }
}
