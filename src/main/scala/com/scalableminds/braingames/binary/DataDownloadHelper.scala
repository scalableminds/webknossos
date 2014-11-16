/*
 * Copyright (C) 2011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary

import scala.collection.JavaConverters._
import java.io.{File, OutputStream, FileInputStream}
import org.apache.commons.io.FileUtils
import org.apache.commons.io.filefilter.{SuffixFileFilter, TrueFileFilter}
import com.scalableminds.util.io.{ZipIO, NamedFileStream}
import com.scalableminds.braingames.binary.models.DataLayer

trait DataDownloadHelper {

  def downloadDataLayer(dataLayer: DataLayer, outputStream: OutputStream) {
    val files = FileUtils.listFiles(new File(dataLayer.baseDir), new SuffixFileFilter(".raw"), TrueFileFilter.INSTANCE).asScala
    ZipIO.zip(
      files.map{
        file =>
          new NamedFileStream(new FileInputStream(file), file.getName())
      }.toStream,
      outputStream)
  }

}