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
import scala.collection.breakOut

trait SegmentationMappingHelpers {

  lazy val dataStore = new FileDataStore()

  def normalizeId(mapping: Map[Int, Int], ids: Set[Int] = Set())(Id: Int): Int = {
    mapping.get(Id) match {
      case Some(0) | Some(Id) | None =>
        if (ids.isEmpty) 0 else Id
      case Some(x) =>
        if (ids.contains(Id))
          ids.min
        else 
          normalizeId(mapping, ids + Id)(x)
    }
  }

  def normalize(mapping: Map[Int, Int]): Array[Int] = {
    mapping.map{
      case (k,v) => 
        normalizeId(mapping)(v)
    }(breakOut)
  }

  def handleMappingRequest(request: MappingRequest) = {
    dataStore.load(request).map {
      case Full(data) =>
        IntArrayToByteArrayConverter.convert(
            normalize(
              ByteArrayToIntArrayConverter.convert(
                data,
                request.dataLayer.bytesPerElement).zipWithIndex.toMap),
            request.dataLayer.bytesPerElement)
      case _ =>
        Array[Byte]()
    }
  }
}
