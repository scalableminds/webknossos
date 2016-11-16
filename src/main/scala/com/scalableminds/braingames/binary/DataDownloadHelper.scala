/*
 * Copyright (C) 2011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary

import scala.collection.JavaConversions._
import java.io.{File, FileInputStream, OutputStream}
import java.nio.file.Paths

import org.apache.commons.io.{FileUtils, FilenameUtils}
import org.apache.commons.io.filefilter.{SuffixFileFilter, TrueFileFilter}
import com.scalableminds.util.io.{NamedFileStream, ZipIO}
import com.scalableminds.braingames.binary.models.DataLayer
import com.scalableminds.braingames.binary.store.FileDataStore
import com.typesafe.scalalogging.LazyLogging

trait DataDownloadHelper extends LazyLogging{

  def downloadDataLayer(dataLayer: DataLayer, outputStream: OutputStream): Unit = {
    try {
      val basePath = Paths.get(dataLayer.baseDir)
      val filter = new SuffixFileFilter(DataLayer.supportedFileExt)
      val files = FileUtils.listFiles(new File(dataLayer.baseDir), filter, TrueFileFilter.INSTANCE)
      ZipIO.zip(
        files.toStream.map {
          file =>
            val is = FileDataStore.inputStreamFromDataFile(file)
            val name = FilenameUtils.removeExtension(file.getAbsolutePath) + "." + DataLayer.KnossosFileExtention
            val path = basePath.relativize(Paths.get(name))
            new NamedFileStream(is, path.toString)
        },
        outputStream)
    } catch {
      case e: Exception =>
        logger.error(s"Failed to zip datalayer ${dataLayer.name} for download. Error: " + e)
    }
  }

}