/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.api

import com.scalableminds.braingames.binary.MappingRequest
import com.scalableminds.braingames.binary.store.FileDataStore
import com.scalableminds.util.tools.Fox

trait DataLayerMappingHelpers {

  lazy val dataStore = new FileDataStore()

  def handleMappingRequest(request: MappingRequest): Fox[Array[Byte]] = {
    dataStore.load(request)
  }
}
