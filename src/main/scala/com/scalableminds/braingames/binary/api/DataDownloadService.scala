/*
 * Copyright (C) 2011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.api

import java.io.OutputStream
import com.scalableminds.braingames.binary.models.DataLayer
import com.typesafe.scalalogging.LazyLogging

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
