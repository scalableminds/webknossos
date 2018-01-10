/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.io

import java.io._
import java.nio.file.{Path, Paths}
import java.util.zip.{GZIPOutputStream => DefaultGZIPOutputStream, _}

import com.scalableminds.util.tools.Fox
import net.liftweb.common.{Box, Empty, Failure, Full}
import net.liftweb.util.Helpers.tryo
import org.apache.commons.io.IOUtils
import play.api.libs.concurrent.Execution.Implicits._

import scala.concurrent.Future

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
    def withFile(name: String)(f: OutputStream => Future[_]) = {
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

  def zip(sources: List[NamedStream], out: OutputStream) = {
    if (sources.nonEmpty) {
      val zip = startZip(out)
      Fox.serialSequence(sources) { s =>
        zip.withFile(s.normalizedName)(s.writeTo)
      }.map { _ =>
        zip.close()
      }
    } else
      out.close()
  }

  def startZip(out: OutputStream) = {
    OpenZip(new ZipOutputStream(out))
  }

  def gzip(source: InputStream, out: OutputStream) = {
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

  def gzipToTempFile(f: File) = {
    val gzipped = File.createTempFile("temp", System.nanoTime().toString + "_" + f.getName)
    gzip(new FileInputStream(f), new FileOutputStream(gzipped))
    gzipped
  }

  def withUnziped[A](file: File, includeHiddenFiles: Boolean = false, truncateCommonPrefix: Boolean = false)(f: (Path, InputStream) => A): Box[List[A]] = {
    tryo(new java.util.zip.ZipFile(file)).flatMap(
      withUnziped(_, includeHiddenFiles, truncateCommonPrefix)((name, is) => Full(f(name, is))))
  }

  def withUnziped[A](zip: ZipFile, includeHiddenFiles: Boolean, truncateCommonPrefix: Boolean)(f: (Path, InputStream) => Box[A]): Box[List[A]] = {

    def isFileHidden(e: ZipEntry): Boolean = new File(e.getName).isHidden || e.getName.startsWith("__MACOSX")

    import collection.JavaConverters._
    val zipEntries = zip.entries.asScala.filter(e => !e.isDirectory && (includeHiddenFiles || !isFileHidden(e))).toList

    val commonPrefix = if (truncateCommonPrefix) {
      PathUtils.commonPrefix(zipEntries.map(e => Paths.get(e.getName)))
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

  def unzipToFolder(file: File, targetDir: Path, includeHiddenFiles: Boolean, truncateCommonPrefix: Boolean): Box[List[Path]] = {
    tryo(new java.util.zip.ZipFile(file)).flatMap(unzipToFolder(_, targetDir, includeHiddenFiles, truncateCommonPrefix))
  }

  def unzipToFolder(zip: ZipFile, targetDir: Path, includeHiddenFiles: Boolean, truncateCommonPrefix: Boolean): Box[List[Path]] = {
   withUnziped(zip, includeHiddenFiles, truncateCommonPrefix) { (name, in) =>
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
}
