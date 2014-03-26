/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package braingames.binary.repository

import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._
import net.liftweb.common.{Empty, Full, Failure}
import braingames.geometry.Point3D
import braingames.binary.LoadBlock
import braingames.binary.store.FileDataStore
import braingames.binary.models.{DataSource, DataLayer}

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
                  var maxId = 0
                  (0 until data.length by 2).map {
                    i =>
                      maxId = maxId.max(data(i) + (data(i + 1) << 8))
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