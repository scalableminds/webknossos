/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.api

import com.scalableminds.braingames.binary.{MappingRequest}
import com.scalableminds.braingames.binary.models.{DataLayer, DataSource}
import com.scalableminds.braingames.binary.store.FileDataStore
import net.liftweb.common.Full
import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.Future

trait SegmentationMappingHelpers {

  lazy val dataStore = new FileDataStore()

  def handleMappingRequest(request: MappingRequest) = {
    dataStore.load(request).map {
      case Full(data) =>
        data
      case _ =>
    	  Array[Byte]()
    }
  }
}
