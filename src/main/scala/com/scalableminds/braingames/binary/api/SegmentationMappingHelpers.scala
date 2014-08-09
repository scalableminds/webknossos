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

  def normalizeId(mapping: Array[Int], ids: Set[Int] = Set())(id: Int): Int = {
    if (id >= mapping.size || mapping(id) == 0 || mapping(id) == id)
      if (ids.isEmpty) 0 else id
    else if (ids.contains(id))
      ids.min
    else normalizeId(mapping, ids + id)(mapping(id))
  }

  def normalize(mapping: Array[Int]) = {
    (0 until mapping.length).map(normalizeId(mapping)).toArray
  }

  def handleMappingRequest(request: MappingRequest) = {
    dataStore.load(request).map {
      case Full(data) =>
        IntArrayToByteArrayConverter.convert(
            normalize(
              ByteArrayToIntArrayConverter.convert(
                data,
                request.dataLayer.bytesPerElement)),
            request.dataLayer.bytesPerElement)
      case _ =>
        Array[Byte]()
    }
  }
}
