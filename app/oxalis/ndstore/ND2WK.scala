/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package oxalis.ndstore

import com.scalableminds.braingames.binary.models.datasource.{Category, DataSourceId, DataLayerLike => DataLayer, AbstractDataLayer => NDDataLayer, DataSourceLike => DataSource, GenericDataSource => NDDataSource}
import com.scalableminds.util.geometry.{BoundingBox, Point3D, Scale}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.binary.{DataSet, DataStoreInfo, NDStore}
import play.api.i18n.Messages
import play.api.libs.concurrent.Execution.Implicits._

object ND2WK extends FoxImplicits {

  val channelTypeMapping = Map(
    "annotation" -> Category.segmentation,
    "image" -> Category.color
  )

  def dataSetFromNDProject(ndp: NDProject, team: String)(implicit messages: Messages) = {
    val dataStoreInfo = DataStoreInfo(ndp.server, ndp.server, NDStore, Some(ndp.token))

    for {
      dataLayers <- dataLayersFromNDChannels(ndp.dataset, ndp.channels)
      dataSource <- dataSourceFromNDDataSet(ndp.name, ndp.dataset, dataLayers)
    } yield {
      DataSet(
        dataStoreInfo,
        dataSource,
        List(team),
        isActive = true,
        isPublic = false)
    }
  }

  private def dataSourceFromNDDataSet(
    name: String,
    nd: NDDataSet,
    dataLayers: List[DataLayer])(implicit messages: Messages): Fox[DataSource] = {

    for {
      vr <- nd.voxelRes.get("0").filter(_.length >= 3) ?~> Messages("ndstore.invalid.voxelres.zero")
      scale = Scale(vr(0), vr(1), vr(2))
    } yield {
      val id = DataSourceId(name, "Connectomics department")
      NDDataSource(id, dataLayers, scale)
    }
  }

  private def boundingBoxFromNDChannelSize(nd: NDDataSet)(implicit messages: Messages): Fox[BoundingBox] = {
    for {
      imageSize <- nd.imageSize.get("0").filter(_.length >= 3) ?~> Messages("ndstore.invalid.imagesize.zero")
      topLeft <- nd.offset.get("0").flatMap(offsets => Point3D.fromArray(offsets)) ?~> Messages("ndstore.invalid.offset.zero")
    } yield {
      BoundingBox.createFrom(width = imageSize(0), height = imageSize(1), deph = imageSize(2), topLeft)
    }
  }

  private def dataLayersFromNDChannels(
    nd: NDDataSet,
    channels: List[NDChannel])(implicit messages: Messages): Fox[List[DataLayer]] = {

    val singleChannelResults: List[Fox[DataLayer]] = channels.map { channel =>
      for {
        bbox <- boundingBoxFromNDChannelSize(nd)
        _ <- nd.resolutions.nonEmpty ?~> Messages("ndstore.invalid.resolutions")
      } yield {
        NDDataLayer(
          channel.name,
          channel.channelType,
          bbox,
          nd.resolutions.map(r => math.pow(2, r).toInt).toSet,
          channel.dataType
        )
      }
    }
    Fox.combined(singleChannelResults)
  }
}
