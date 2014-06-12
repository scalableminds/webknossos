/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.repository

import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._
import net.liftweb.common.{Empty, Full, Failure}
import com.scalableminds.util.geometry.Point3D
import com.scalableminds.braingames.binary.LoadBlock
import com.scalableminds.braingames.binary.store.FileDataStore
import com.scalableminds.braingames.binary.models.{DataSource, DataLayer}

trait SegmentationIdHelper {

  lazy val dataStore = new FileDataStore()

  def setNextSegmentationIds(dataSource: DataSource): Future[DataSource] = {
    Future.sequence(dataSource.dataLayers.map {
      dataLayer =>
        findNextSegmentationId(dataSource, dataLayer).map {
          nextId =>
            dataLayer.copy(nextSegmentationId = nextId)
        }
    }).map {
      dataLayers =>
        dataSource.copy(dataLayers = dataLayers)
    }
  }

  def findNextSegmentationId(dataSource: DataSource, dataLayer: DataLayer) = {
    if (dataLayer.category == DataLayer.SEGMENTATION.category)
      Future.sequence(dataLayer.sections.map {
        section =>
          val resolution = section.resolutions.min
          val minBlock = dataSource.pointToBlock(section.bboxBig.topLeft, resolution)
          val maxBlock = dataSource.pointToBlock(section.bboxBig.bottomRight.move(Point3D(-1, -1, -1)), resolution)
          (minBlock to maxBlock).map {
            block =>
              dataStore.load(LoadBlock(dataSource, dataLayer, section, resolution, block)).map {
                case Full(data) =>
                  var maxId: Long = 0
                  var currentId: Long = 0
                  (data.length-1 to 0 by -1).map {
                    i =>
                      currentId += data(i)
                      if (i % dataLayer.bytesPerElement == 0) {
                        maxId = maxId.max(currentId)
                        currentId = 0
                      } else {
                        currentId <<= 8
                      }
                  }
                  maxId
                case _ =>
                  0
              }
          }
      }.flatten).map(_.reduceOption(_ max _).map(_ + 1))
    else
      Future.successful(None)
  }

}