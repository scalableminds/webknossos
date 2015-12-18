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

object ZipIO {

  case class OpenZip(stream: ZipOutputStream){
    def addFile(source: NamedFileStream) = {
      stream.putNextEntry(new ZipEntry(source.normalizedName))
      val buffer = new Array[Byte](1024)
      var len = 0
      do {
        len = source.stream.read(buffer)
        if (len > 0)
          stream.write(buffer, 0, len)
      } while (len > 0)
      source.stream.close()
      stream.closeEntry()
    }

    def close() =
      stream.close()
  }

  /** The size of the byte or char buffer used in various methods. */

  class GZIPOutputStream(out: OutputStream, compressionLevel: Int) extends DefaultGZIPOutputStream(out) {
    `def`.setLevel(compressionLevel)
  }

  def zip(sources: Stream[NamedFileStream], out: OutputStream) = {
    if (sources.nonEmpty){
      val zip = OpenZip(new ZipOutputStream(out))
      sources.foreach(zip.addFile)
      zip.close()
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

  def unzipWithFilenames(file: File, includeHiddenFiles: Boolean = false): List[(String, InputStream)] = {
    unzipWithFilenames(new java.util.zip.ZipFile(file), includeHiddenFiles)
  }
  
  def isHiddenFile(s: String) = 
    s.startsWith(".") || s.startsWith("__MACOSX")

  def unzipWithFilenames(zip: ZipFile, includeHiddenFiles: Boolean): List[(String, InputStream)] = {
    import collection.JavaConverters._
    zip
      .entries
      .asScala
      .filter(e => !e.isDirectory && (includeHiddenFiles || !isHiddenFile(e.getName)))
      .map(entry => (entry.getName, zip.getInputStream(entry)))
      .toList
  }
}