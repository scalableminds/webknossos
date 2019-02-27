package com.scalableminds.util.io

import java.io._
import java.nio.file.{Path, Paths}
import java.util.zip.{GZIPOutputStream => DefaultGZIPOutputStream, _}

import net.liftweb.common.{Box, Empty, Failure, Full}
import net.liftweb.util.Helpers.tryo
import org.apache.commons.io.IOUtils

import scala.concurrent.{ExecutionContext, Future}

object ZipIO {

  /**
    * Representation of an opened zip file
    *
    * @param stream output stream to write to
    */
  case class OpenZip(stream: ZipOutputStream) {

    /**
      * Add a file to the zip
      *
      * @param f input
      * @return future, completes when file is added
      */
    def withFile(name: String)(f: OutputStream => Future[_])(implicit ec: ExecutionContext) = {
      stream.putNextEntry(new ZipEntry(name))
      f(stream).map(_ => stream.closeEntry())
    }

    /**
      * Close the zip file
      */
    def close() =
      stream.close()
  }

  class GZIPOutputStream(out: OutputStream, compressionLevel: Int) extends DefaultGZIPOutputStream(out) {
    `def`.setLevel(compressionLevel)
  }

  def zip(sources: List[NamedStream], out: OutputStream)(implicit ec: ExecutionContext): Unit =
    zip(sources.toIterator, out)

  def zip(sources: Iterator[NamedStream], out: OutputStream)(implicit ec: ExecutionContext): Unit =
    if (sources.nonEmpty) {
      val zip = startZip(out)
      zipIterator(sources, zip).onComplete { _ =>
        zip.close()
      }
    } else
      out.close()

  private def zipIterator(sources: Iterator[NamedStream], zip: OpenZip)(implicit ec: ExecutionContext): Future[Unit] =
    if (!sources.hasNext) {
      Future.successful(())
    } else {
      val s = sources.next
      zip.withFile(s.normalizedName)(s.writeTo).flatMap(_ => zipIterator(sources, zip))
    }

  def startZip(out: OutputStream)(implicit ec: ExecutionContext) =
    OpenZip(new ZipOutputStream(out))

  def gzip(source: InputStream, out: OutputStream)(implicit ec: ExecutionContext) = {
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

  def gzipToTempFile(f: File)(implicit ec: ExecutionContext) = {
    val gzipped = File.createTempFile("temp", System.nanoTime().toString + "_" + f.getName)
    gzip(new FileInputStream(f), new FileOutputStream(gzipped))
    gzipped
  }

  def withUnziped[A](file: File, includeHiddenFiles: Boolean = false, truncateCommonPrefix: Boolean = false)(
      f: (Path, InputStream) => A)(implicit ec: ExecutionContext): Box[List[A]] =
    tryo(new java.util.zip.ZipFile(file))
      .flatMap(withUnziped(_, includeHiddenFiles, truncateCommonPrefix, None)((name, is) => Full(f(name, is))))

  def withUnziped[A](zip: ZipFile,
                     includeHiddenFiles: Boolean,
                     truncateCommonPrefix: Boolean,
                     excludeFromPrefix: Option[List[String]])(f: (Path, InputStream) => Box[A])(
      implicit ec: ExecutionContext): Box[List[A]] = {

    def isFileHidden(e: ZipEntry): Boolean = new File(e.getName).isHidden || e.getName.startsWith("__MACOSX")

    def stripPathFrom(path: Path, string: String): Option[Path] = {
      def stripPathHelper(i: Int): Option[Path] =
        if (i >= path.getNameCount)
          None
        else if (path.subpath(i, i + 1).toString.contains(string)) //sample paths: "test/test/color_1", "segmentation"
          if (i == 0) // path.subpath(0,0) is invalid and means that there is no commonPrefix which isn't started with a layer
            Some(Paths.get(""))
          else // this is the common prefix but stripped from the layer
            Some(path.subpath(0, i))
        else
          stripPathHelper(i + 1)

      stripPathHelper(0)
    }

    import collection.JavaConverters._
    val zipEntries = zip.entries.asScala.filter(e => !e.isDirectory && (includeHiddenFiles || !isFileHidden(e))).toList

    //color, mask, segmentation are the values for dataSet layer categories and a folder only has one category
    val commonPrefix = if (truncateCommonPrefix) {
      val commonPrefixNotFixed = PathUtils.commonPrefix(zipEntries.map(e => Paths.get(e.getName)))
      val strippedPaths = excludeFromPrefix.getOrElse(List()).flatMap(stripPathFrom(commonPrefixNotFixed, _))
      strippedPaths.headOption match {
        case Some(path) => path
        case None       => commonPrefixNotFixed
      }
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
                    excludeFromPrefix: Option[List[String]])(implicit ec: ExecutionContext): Box[List[Path]] =
    tryo(new java.util.zip.ZipFile(file))
      .flatMap(unzipToFolder(_, targetDir, includeHiddenFiles, truncateCommonPrefix, excludeFromPrefix))

  def unzipToFolder(zip: ZipFile,
                    targetDir: Path,
                    includeHiddenFiles: Boolean,
                    truncateCommonPrefix: Boolean,
                    excludeFromPrefix: Option[List[String]])(implicit ec: ExecutionContext): Box[List[Path]] =
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
