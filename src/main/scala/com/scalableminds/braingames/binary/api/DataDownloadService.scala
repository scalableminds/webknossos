/*
 * Copyright (C) 2011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.api

import java.io.{File, OutputStream}
import java.nio.file.Paths

import com.scalableminds.braingames.binary.models.DataLayer
import com.scalableminds.braingames.binary.store.FileDataStore
import com.scalableminds.util.io.{NamedFileStream, ZipIO}
import com.typesafe.scalalogging.LazyLogging
import org.apache.commons.io.filefilter.{SuffixFileFilter, TrueFileFilter}
import org.apache.commons.io.{FileUtils, FilenameUtils}

import scala.collection.JavaConversions._

trait DataDownloadService extends LazyLogging{
  def downloadDataLayer(dataLayer: DataLayer, outputStream: OutputStream): Unit = {
    try {
      dataLayer.writeTo(outputStream)
    } catch {
      case e: Exception =>
        logger.error(s"Failed to zip datalayer ${dataLayer.name} for download. Error: " + e)
    }
  }
}
