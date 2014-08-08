/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.api

import com.scalableminds.braingames.binary.{MappingRequest}
import com.scalableminds.braingames.binary.models.{DataLayer, DataSource}
import com.scalableminds.braingames.binary.store.FileDataStore
import com.scalableminds.util.tools.DefaultConverters._
import net.liftweb.common.Full
import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.Future

trait SegmentationMappingHelpers {

  lazy val dataStore = new FileDataStore()

  def normalizeId(mapping: Array[Int])(idx: Int): Int = {
    if (mapping.size <= idx || mapping(idx) == 0 || mapping(idx) == idx)
      idx
    else
      normalizeId(mapping)(mapping(idx))
  }

  def normalize(mapping: Array[Int]) = {
    mapping.map(normalizeId(mapping))
  }

  def handleMappingRequest(request: MappingRequest) = {
    dataStore.load(request).map {
      case Full(data) =>
        IntArrayToByteArrayConverter.convert(
            normalize(ByteArrayToIntArrayConverter.convert(
                data,
                request.dataLayer.bytesPerElement)),
            request.dataLayer.bytesPerElement)
      case _ =>
        Array[Byte]()
    }
  }
}
