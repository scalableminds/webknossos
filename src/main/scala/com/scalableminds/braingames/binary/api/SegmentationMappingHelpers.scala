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

  private def normalizeId(mapping: Map[Long, Long], ids: Set[Long] = Set())(Id: Long): Long = {
    mapping.get(Id) match {
      case Some(Id) | None =>
        Id
      case Some(id) =>
        if (ids.contains(Id))
          ids.min
        else
          normalizeId(mapping, ids + Id)(id)
    }
  }

  private def normalize(mapping: Map[Long, Long]) = {
    mapping.mapValues(normalizeId(mapping)).filter(x => x._1 != x._2)
  }

  private def byteArrayToMapping(data: Array[Byte], bytesPerElement: Int): Map[Long, Long] = {
    var currentId: Long = 0
    var mapping: Map[Long, Long] = Map[Long, Long]()
    (data.length-1 to 0 by -1).map {
      i =>
        currentId += (data(i).toLong + 256) % 256
        if (i % bytesPerElement == 0 && currentId != 0) {
          mapping += (i.toLong / bytesPerElement -> currentId)
          currentId = 0
        } else {
          currentId <<= 8
        }
    }
    mapping
  }

  private def mappingToByteArray(mapping: Map[Long, Long], bytesPerElement: Int): Array[Byte] = {
    val data = new Array[Byte]((mapping.keys.max.toInt + 1) * bytesPerElement)
    mapping.map {
      pair =>
        var targetId = pair._2
        val offset = pair._1.toInt * bytesPerElement
        (offset until offset + bytesPerElement).map {
          i =>
            data(i) = targetId.byteValue
            targetId >>= 8
        }
    }
    data
  }

  def handleMappingRequest(request: MappingRequest) = {
    dataStore.load(request).map {
      case Full(data) =>
        mappingToByteArray(
          normalize(
            byteArrayToMapping(
              data,
              request.dataLayer.bytesPerElement
            )
          ),
          request.dataLayer.bytesPerElement
        )
      case _ =>
        Array[Byte]()
    }
  }
}
