/*
 * Copyright (C) 2011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary

import scala.collection.JavaConversions._
import java.io.{File, FileInputStream, OutputStream}

import org.apache.commons.io.FileUtils
import org.apache.commons.io.filefilter.{SuffixFileFilter, TrueFileFilter}
import com.scalableminds.util.io.{NamedFileStream, ZipIO}
import com.scalableminds.braingames.binary.models.DataLayer
import com.typesafe.scalalogging.LazyLogging

trait DataDownloadHelper extends LazyLogging{

  def downloadDataLayer(dataLayer: DataLayer, outputStream: OutputStream): Unit = {
    try {
      val files = FileUtils.listFiles(new File(dataLayer.baseDir), new SuffixFileFilter(".raw"), TrueFileFilter.INSTANCE)
      ZipIO.zip(
        files.toStream.map {
          file =>
            new NamedFileStream(new FileInputStream(file), file.getName())
        },
        outputStream)
    } catch {
      case e: Exception =>
        logger.error(s"Failed to zip datalayer ${dataLayer.name} for download. Error: " + e)
    }
  }

}