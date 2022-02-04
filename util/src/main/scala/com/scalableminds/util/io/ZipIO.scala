package com.scalableminds.util.io

import java.io._
import java.nio.file.{Files, Path, Paths}
import java.util.zip.{GZIPOutputStream => DefaultGZIPOutputStream, _}

import akka.stream.Materializer
import akka.stream.javadsl.StreamConverters
import akka.stream.scaladsl.Source
import akka.util.ByteString
import com.scalableminds.util.tools.TextUtils
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Empty, Failure, Full}
import net.liftweb.util.Helpers.tryo
import org.apache.commons.io.IOUtils
import play.api.libs.Files.TemporaryFile
import play.api.libs.iteratee.Enumerator

import scala.collection.JavaConverters._
import scala.concurrent.{ExecutionContext, Future}

object ZipIO extends LazyLogging {

  /**
    * Representation of an opened zip file
    *
    * @param stream output stream to write to
    */
  case class OpenZip(stream: ZipOutputStream) {

    def addFileFromSource(name: String, source: Source[ByteString, _])(implicit ec: ExecutionContext,
                                                                       materializer: Materializer): Future[Unit] = {

      stream.putNextEntry(new ZipEntry(name))

      val inputStream: InputStream = source.runWith(StreamConverters.asInputStream)

      val result = Future.successful(IOUtils.copy(inputStream, stream))

      result.map(_ => stream.closeEntry())
    }

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

    def addFileFromEnumerator(name: String, data: Enumerator[Array[Byte]])(
        implicit ec: ExecutionContext): Future[Unit] =
      addFileFromNamedEnumerator(NamedEnumeratorStream(name, data))

    def addFileFromNamedEnumerator(namedEnumerator: NamedEnumeratorStream)(
        implicit ec: ExecutionContext): Future[Unit] = {
      stream.putNextEntry(new ZipEntry(namedEnumerator.name))
      namedEnumerator.writeTo(stream).map(_ => stream.closeEntry())
    }

    /**
      * Add a file to the zip
      *
      * @param f input
      * @return future, completes when file is added
      */
    def withFile(name: String)(f: OutputStream => Future[_])(implicit ec: ExecutionContext): Future[Unit] = {
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

  def zip(sources: List[NamedStream], out: OutputStream)(implicit ec: ExecutionContext): Future[Unit] =
    zip(sources.toIterator, out)

  def zip(sources: Iterator[NamedStream], out: OutputStream)(implicit ec: ExecutionContext): Future[Unit] = {
    val zip = startZip(out)
    if (sources.nonEmpty) {
      for {
        _ <- zipIterator(sources, zip)
        _ = zip.close()
        _ = out.close()
      } yield ()
    } else {
      zip.close()
      out.close()
      Future.successful(())
    }
  }

  private def zipIterator(sources: Iterator[NamedStream], zip: OpenZip)(implicit ec: ExecutionContext): Future[Unit] =
    if (!sources.hasNext) {
      Future.successful(())
    } else {
      try {
        val s = sources.next
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
    zip.entries.asScala.filter(e => !e.isDirectory && (includeHiddenFiles || !isFileHidden(e))).forall(f(_))

  def withUnziped[A](file: File)(f: (Path, InputStream) => A): Box[List[A]] =
    tryo(new java.util.zip.ZipFile(file)).flatMap(withUnziped(_)((name, is) => Full(f(name, is))))

  def withUnziped[A](zip: ZipFile,
                     includeHiddenFiles: Boolean = false,
                     truncateCommonPrefix: Boolean = false,
                     excludeFromPrefix: Option[List[String]] = None)(f: (Path, InputStream) => Box[A]): Box[List[A]] = {

    val zipEntries = zip.entries.asScala.filter(e => !e.isDirectory && (includeHiddenFiles || !isFileHidden(e))).toList

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

  def unzipToFolder(file: File,
                    targetDir: Path,
                    includeHiddenFiles: Boolean,
                    truncateCommonPrefix: Boolean,
                    excludeFromPrefix: Option[List[String]]): Box[List[Path]] =
    tryo(new java.util.zip.ZipFile(file))
      .flatMap(unzipToFolder(_, targetDir, includeHiddenFiles, truncateCommonPrefix, excludeFromPrefix))

  def unzipToFolder(zip: ZipFile,
                    targetDir: Path,
                    includeHiddenFiles: Boolean,
                    truncateCommonPrefix: Boolean,
                    excludeFromPrefix: Option[List[String]]): Box[List[Path]] =
    withUnziped(zip, includeHiddenFiles, truncateCommonPrefix, excludeFromPrefix) { (name, in) =>
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
