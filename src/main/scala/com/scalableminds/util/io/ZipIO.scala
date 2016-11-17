/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.io

import java.io.File
import java.io.FileInputStream
import java.io.OutputStream
import java.io.InputStream
import java.util.zip._
import java.util.zip.{GZIPOutputStream => DefaultGZIPOutputStream}
import java.io.FileOutputStream
import java.nio.file.{Files, Path}

import play.api.libs.concurrent.Execution.Implicits._
import com.scalableminds.util.tools.Fox
import net.liftweb.common.Full
import org.apache.commons.io.IOUtils

import scala.concurrent.Future

object ZipIO {

  /**
    * Representation of an opened zip file
    * @param stream output stream to write to
    */
  case class OpenZip(stream: ZipOutputStream){
    /**
      * Add a file to the zip
      * @param source input
      * @return future, completes when file is added
      */
    def addFile(source: NamedStream): Future[Unit] = {
      stream.putNextEntry(new ZipEntry(source.normalizedName))
      source.writeTo(stream).map{ _ =>
        stream.closeEntry()
      }
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
    if (sources.nonEmpty){
      val zip = startZip(out)
      Fox.serialSequence(sources)(zip.addFile).map{ _ =>
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
    val buffer = new Array[Byte](1024)
    var len = 0
    do {
      len = source.read(buffer)
      if (len > 0)
        gout.write(buffer, 0, len)
    } while (len > 0)
    source.close()
    gout.close()
  }

  def gzipToTempFile(f: File) = {
    val gzipped = File.createTempFile("temp", System.nanoTime().toString + "_" + f.getName)
    gzip(new FileInputStream(f), new FileOutputStream(gzipped))
    gzipped
  }

  def unzip(file: File, includeHiddenFiles: Boolean = false): List[InputStream] = {
    unzip(new java.util.zip.ZipFile(file), includeHiddenFiles)
  }

  def unzip(zip: ZipFile, includeHiddenFiles: Boolean): List[InputStream] = {
    import collection.JavaConverters._
    zip
      .entries
      .asScala
      .filter(e => !e.isDirectory && (includeHiddenFiles || !isHiddenFile(e.getName)))
      .map(entry => zip.getInputStream(entry))
      .toList
  }

  def withUnziped[A](file: File, includeHiddenFiles: Boolean, fileExtensionFilter: String)(f: (String, InputStream) => A): List[A] = {
    withUnziped(new java.util.zip.ZipFile(file), includeHiddenFiles, e => e.getName.endsWith(fileExtensionFilter))(f)
  }

  def withUnziped[A](file: File, includeHiddenFiles: Boolean)(f: (String, InputStream) => A): List[A] = {
    withUnziped(new java.util.zip.ZipFile(file), includeHiddenFiles, _ => true)(f)
  }
  
  def isHiddenFile(s: String) = 
    s.startsWith(".") || s.startsWith("__MACOSX")

  def withUnziped[A](zip: ZipFile, includeHiddenFiles: Boolean, customFilter: ZipEntry => Boolean)(f: (String, InputStream) => A): List[A] = {
    import collection.JavaConverters._
    val result = zip
      .entries
      .asScala
      .filter(e => !e.isDirectory && (includeHiddenFiles || !isHiddenFile(e.getName)))
      .filter(customFilter)
      .map(entry => f(entry.getName, zip.getInputStream(entry)))
      .toList

    zip.close()
    result
  }

  def withUnziped[A](zip: ZipFile, includeHiddenFiles: Boolean)(f: (List[ZipEntry]) => Fox[A]): Fox[A] = {
    import collection.JavaConverters._
    val entries = zip
      .entries
      .asScala
      .filter(e => !e.isDirectory && (includeHiddenFiles || !isHiddenFile(e.getName)))

    val result = f(entries.toList)
    result.futureBox.onComplete(_ => zip.close())
    result
  }
}