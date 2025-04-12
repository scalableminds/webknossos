package com.scalableminds.util.io

import java.io._
import java.nio.file.{Files, Path, Paths}
import java.util.zip.{GZIPOutputStream => DefaultGZIPOutputStream, _}
import com.scalableminds.util.tools.{Fox, FoxImplicits, TextUtils}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Empty, Failure, Full}
import net.liftweb.common.Box.tryo
import org.apache.commons.io.IOUtils
import play.api.libs.Files.TemporaryFile

import scala.concurrent.ExecutionContext
import scala.jdk.CollectionConverters.EnumerationHasAsScala

object ZipIO extends LazyLogging with FoxImplicits {

  /**
    * Representation of an opened zip file
    *
    * @param stream output stream to write to
    */
  case class OpenZip(stream: ZipOutputStream) {

    def addFileFromBytes(name: String, data: Array[Byte]): Unit = {
      stream.putNextEntry(new ZipEntry(name))
      stream.write(data)
      stream.closeEntry()
    }

    def addFileFromTemporaryFile(name: String, data: TemporaryFile): Unit = {
      stream.putNextEntry(new ZipEntry(name))
      stream.write(Files.readAllBytes(data))
      stream.closeEntry()
    }

    def addFileFromFile(name: String, data: File): Unit = {
      stream.putNextEntry(new ZipEntry(name))
      stream.write(Files.readAllBytes(data.toPath))
      stream.closeEntry()
    }

    def addFileFromNamedStream(namedStream: NamedStream, suffix: String = "")(
        implicit ec: ExecutionContext): Fox[Unit] = {
      stream.putNextEntry(new ZipEntry(namedStream.name + suffix))
      namedStream.writeTo(stream).map(_ => stream.closeEntry())
    }

    /**
      * Add a file to the zip
      *
      * @param f input
      * @return future, completes when file is added
      */
    def withFile(name: String)(f: OutputStream => Fox[_]): Fox[Unit] = {
      stream.putNextEntry(new ZipEntry(name))
      f(stream).map(_ => stream.closeEntry())
    }

    /**
      * Close the zip file
      */
    def close(): Unit =
      stream.close()
  }

  class GZIPOutputStream(out: OutputStream, compressionLevel: Int) extends DefaultGZIPOutputStream(out) {
    `def`.setLevel(compressionLevel)
  }

  def zip(sources: Iterator[NamedStream], out: OutputStream, level: Int = -1)(
      implicit ec: ExecutionContext): Fox[Unit] = {
    val zip = startZip(out)
    if (level != -1) {
      zip.stream.setLevel(level)
    }
    if (sources.nonEmpty) {
      for {
        _ <- zipIterator(sources, zip)
        _ = zip.close()
        _ = out.close()
      } yield ()
    } else {
      zip.close()
      out.close()
      Fox.successful(())
    }
  }

  private def zipIterator(sources: Iterator[NamedStream], zip: OpenZip)(implicit ec: ExecutionContext): Fox[Unit] =
    if (!sources.hasNext) {
      Fox.successful(())
    } else {
      try {
        val s = sources.next()
        zip.withFile(s.normalizedName)(s.writeTo).flatMap(_ => zipIterator(sources, zip))
      } catch {
        case e: Exception =>
          logger.debug("Error packing zip: " + TextUtils.stackTraceAsString(e))
          throw new Exception(e.getMessage)
      }
    }

  def startZip(out: OutputStream): OpenZip =
    OpenZip(new ZipOutputStream(out))

  def gzip(source: InputStream, out: OutputStream): Unit = {
    val gout = new GZIPOutputStream(out, Deflater.BEST_COMPRESSION)
    try {
      val buffer = new Array[Byte](1024)
      var len = 0
      do {
        len = source.read(buffer)
        if (len > 0)
          gout.write(buffer, 0, len)
      } while (len > 0)
    } finally {
      source.close()
      gout.close()
    }
  }

  def gunzip(compressed: Array[Byte]): Array[Byte] = {
    val is = new GZIPInputStream(new ByteArrayInputStream(compressed))
    val os = new ByteArrayOutputStream()
    try {
      val buffer = new Array[Byte](1024)
      var len = 0
      do {
        len = is.read(buffer)
        if (len > 0)
          os.write(buffer, 0, len)
      } while (len > 0)
      os.toByteArray
    } finally {
      is.close()
      os.close()
    }
  }

  def zipToTempFile(files: List[File]): File = {
    val outfile = File.createTempFile("data", System.nanoTime().toString + ".zip")
    val zip: OpenZip = startZip(new FileOutputStream(outfile))
    files.foreach { file =>
      zip.addFileFromFile(file.getName, file)
    }
    zip.close()
    outfile
  }

  private def isFileHidden(e: ZipEntry): Boolean = new File(e.getName).isHidden || e.getName.startsWith("__MACOSX")

  def forallZipEntries(zip: ZipFile, includeHiddenFiles: Boolean = false)(f: ZipEntry => Boolean): Boolean =
    entries(zip, includeHiddenFiles).forall(f(_))

  def entries(zip: ZipFile, includeHiddenFiles: Boolean = false): Iterator[ZipEntry] =
    zip.entries.asScala.filter(e => !e.isDirectory && (includeHiddenFiles || !isFileHidden(e)))

  def readAt(zip: ZipFile, entry: ZipEntry): Box[Array[Byte]] = tryo {
    val is = zip.getInputStream(entry)
    IOUtils.toByteArray(is)
  }

  def withUnziped[A](file: File)(f: (Path, InputStream) => A): Box[List[A]] =
    tryo(new java.util.zip.ZipFile(file)).flatMap(withUnziped(_)((name, is) => Full(f(name, is))))

  def withUnzipedAsync[A](file: File)(f: (Path, InputStream) => Fox[A])(implicit ec: ExecutionContext): Fox[List[A]] =
    for {
      zip <- tryo(new java.util.zip.ZipFile(file)).toFox
      resultList <- withUnzipedAsync(zip)((name, is) => f(name, is))
    } yield resultList

  def withUnzipedAsync[A](zip: ZipFile,
                          includeHiddenFiles: Boolean = false,
                          hiddenFilesWhitelist: List[String] = List(),
                          truncateCommonPrefix: Boolean = false,
                          excludeFromPrefix: Option[List[String]] = None)(f: (Path, InputStream) => Fox[A])(
      implicit ec: ExecutionContext): Fox[List[A]] = {

    val zipEntries = zip.entries.asScala.filter { e: ZipEntry =>
      !e.isDirectory && (includeHiddenFiles || !isFileHidden(e) || hiddenFilesWhitelist.contains(
        Paths.get(e.getName).getFileName.toString))
    }.toList

    val commonPrefix = if (truncateCommonPrefix) {
      val commonPrefixNotFixed = PathUtils.commonPrefix(zipEntries.map(e => Paths.get(e.getName)))
      val strippedPrefix =
        PathUtils.cutOffPathAtLastOccurrenceOf(commonPrefixNotFixed, excludeFromPrefix.getOrElse(List.empty))
      PathUtils.removeSingleFileNameFromPrefix(strippedPrefix, zipEntries.map(_.getName))
    } else {
      Paths.get("")
    }

    val resultFox = zipEntries.foldLeft[Fox[List[A]]](Fox.successful(List.empty)) { (results, entry) =>
      Fox
        .fromFuture(results.futureBox)
        .map {
          case Full(rs) =>
            val input: InputStream = zip.getInputStream(entry)
            val path = commonPrefix.relativize(Paths.get(entry.getName))
            val innerResultFox: Fox[List[A]] = Fox.futureBox2Fox(f(path, input).futureBox.map {
              case Full(result) =>
                input.close()
                Full(rs :+ result)
              case Empty =>
                input.close()
                Empty
              case failure: Failure =>
                input.close()
                failure
            })
            innerResultFox
          case e =>
            e.toFox
        }
        .toFox
        .flatten
    }

    Fox.futureBox2Fox {
      for {
        result <- resultFox.futureBox.map { resultBox =>
          zip.close() // close even if result is not success
          resultBox
        }
      } yield result
    }
  }

  def withUnziped[A](zip: ZipFile,
                     includeHiddenFiles: Boolean = false,
                     hiddenFilesWhitelist: List[String] = List(),
                     truncateCommonPrefix: Boolean = false,
                     excludeFromPrefix: Option[List[String]] = None)(f: (Path, InputStream) => Box[A]): Box[List[A]] = {

    val zipEntries = zip.entries.asScala.filter { e: ZipEntry =>
      !e.isDirectory && (includeHiddenFiles || !isFileHidden(e) || hiddenFilesWhitelist.contains(
        Paths.get(e.getName).getFileName.toString))
    }.toList

    val commonPrefix = if (truncateCommonPrefix) {
      val commonPrefixNotFixed = PathUtils.commonPrefix(zipEntries.map(e => Paths.get(e.getName)))
      val strippedPrefix =
        PathUtils.cutOffPathAtLastOccurrenceOf(commonPrefixNotFixed, excludeFromPrefix.getOrElse(List.empty))
      PathUtils.removeSingleFileNameFromPrefix(strippedPrefix, zipEntries.map(_.getName))
    } else {
      Paths.get("")
    }

    val result = zipEntries.foldLeft[Box[List[A]]](Full(Nil)) { (results, entry) =>
      results match {
        case Full(rs) =>
          var input: InputStream = null
          try {
            input = zip.getInputStream(entry)
            val path = commonPrefix.relativize(Paths.get(entry.getName))
            val r = f(path, input) match {
              case Full(result) =>
                Full(rs :+ result)
              case Empty =>
                Empty
              case f: Failure =>
                f
            }
            input.close()
            r
          } catch {
            case e: Exception =>
              Failure(e.getMessage)
          } finally {
            if (input != null) input.close()
          }
        case e =>
          e
      }
    }

    zip.close()
    result
  }

  def unzipToDirectory(file: File,
                       targetDir: Path,
                       includeHiddenFiles: Boolean,
                       hiddenFilesWhitelist: List[String],
                       truncateCommonPrefix: Boolean,
                       excludeFromPrefix: Option[List[String]]): Box[List[Path]] =
    tryo(new java.util.zip.ZipFile(file)).flatMap(
      unzipToDirectory(_, targetDir, includeHiddenFiles, hiddenFilesWhitelist, truncateCommonPrefix, excludeFromPrefix))

  def unzipToDirectory(zip: ZipFile,
                       targetDir: Path,
                       includeHiddenFiles: Boolean,
                       hiddenFilesWhitelist: List[String],
                       truncateCommonPrefix: Boolean,
                       excludeFromPrefix: Option[List[String]]): Box[List[Path]] =
    withUnziped(zip, includeHiddenFiles, hiddenFilesWhitelist, truncateCommonPrefix, excludeFromPrefix) { (name, in) =>
      val path = targetDir.resolve(name)
      if (path.getParent != null) {
        PathUtils.ensureDirectory(path.getParent)
      }
      var out: FileOutputStream = null
      try {
        out = new FileOutputStream(path.toFile)
        IOUtils.copy(in, out)
        Full(name)
      } catch {
        case e: Exception =>
          Failure(e.getMessage)
      } finally {
        if (out != null) out.close()
      }
    }
}
