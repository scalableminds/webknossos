/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package oxalis.ndstore

import com.scalableminds.webknossos.datastore.models.datasource.{Category, DataSourceId, AbstractDataLayer => NDDataLayer, DataLayerLike => DataLayer, DataSourceLike => DataSource, GenericDataSource => NDDataSource}
import com.scalableminds.util.geometry.{BoundingBox, Point3D, Scale}
import com.scalableminds.util.reactivemongo.GlobalAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.binary.{DataSet, DataStoreInfo, NDStore}
import models.team.{OrganizationDAO, TeamDAO, TeamService}
import play.api.i18n.Messages
import play.api.libs.concurrent.Execution.Implicits._
import reactivemongo.bson.BSONObjectID

object ND2WK extends FoxImplicits {

  val channelTypeMapping = Map(
    "annotation" -> Category.segmentation,
    "image" -> Category.color
  )

  def dataSetFromNDProject(ndp: NDProject, team: BSONObjectID)(implicit messages: Messages) = {
    val dataStoreInfo = DataStoreInfo(ndp.server, ndp.server, NDStore, Some(ndp.token))

    for {
      dataLayers <- dataLayersFromNDChannels(ndp.dataset, ndp.channels)
      dataSource <- dataSourceFromNDDataSet(ndp.name, ndp.dataset, dataLayers, team)
      orgName <- TeamDAO.findOneById(team)(GlobalAccessContext).map(_.organization)
      organization <- OrganizationDAO.findOneByName(orgName)(GlobalAccessContext)
    } yield {
      DataSet(
        None,
        dataStoreInfo,
        dataSource,
        orgName,
        List(organization._organizationTeam),
        isActive = true,
        isPublic = false)
    }
  }

  private def dataSourceFromNDDataSet(
    name: String,
    nd: NDDataSet,
    dataLayers: List[DataLayer],
    team: BSONObjectID)(implicit messages: Messages): Fox[DataSource] = {

    for {
      vr <- nd.voxelRes.get("0").filter(_.length >= 3) ?~> Messages("ndstore.invalid.voxelres.zero")
      organization <- TeamDAO.findOneById(team)(GlobalAccessContext).map(_.organization) ?~> Messages("Organization not found")
      scale = Scale(vr(0), vr(1), vr(2))
    } yield {
      val id = DataSourceId(name, organization)
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
          nd.resolutions.map(r => Point3D(math.pow(2, r).toInt, math.pow(2, r).toInt, math.pow(2, r).toInt)),
          channel.dataType
        )
      }
    }
    Fox.combined(singleChannelResults)
  }
}
