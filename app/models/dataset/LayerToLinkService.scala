package models.dataset

import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.{AuthorizedAccessContext, DBAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.datasource.{
  StaticColorLayer,
  StaticLayer,
  StaticSegmentationLayer,
  UsableDataSource
}
import com.scalableminds.webknossos.datastore.services.uploading.LinkedLayerIdentifier
import models.user.{User, UserService}
import play.api.http.Status.NOT_FOUND

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class LayerToLinkService @Inject()(datasetDAO: DatasetDAO, userService: UserService, datasetService: DatasetService)
    extends FoxImplicits {

  def validateLayerToLink(layerIdentifier: LinkedLayerIdentifier, requestingUser: User)(
      implicit ec: ExecutionContext): Fox[Unit] =
    for {
      dataset <- datasetDAO.findOne(layerIdentifier.datasetId)(AuthorizedAccessContext(requestingUser)) ?~> Msg.Dataset
        .notFound(layerIdentifier.datasetId) ~> NOT_FOUND
      isTeamManagerOrAdmin <- userService.isTeamManagerOrAdminOfOrg(requestingUser, dataset._organization)
      _ <- Fox.fromBool(isTeamManagerOrAdmin || requestingUser.isDatasetManager || dataset.isPublic) ?~> Msg.Dataset.Upload.linkRestricted
    } yield ()

  def addLayersToLinkToDataSource(dataSource: UsableDataSource, layersToLink: Seq[LinkedLayerIdentifier])(
      implicit ctx: DBAccessContext,
      ec: ExecutionContext): Fox[UsableDataSource] =
    for {
      linkedLayers <- Fox.serialCombined(layersToLink)(resolveLayerToLink) ?~> Msg.Dataset.LayerToLink.failed
      allLayers = linkedLayers ++ dataSource.dataLayers
      _ <- Fox.fromBool(allLayers.length == allLayers.map(_.name).distinct.length) ?~> Msg.Dataset.duplicateLayerNames
    } yield dataSource.copy(dataLayers = allLayers)

  private def resolveLayerToLink(layerToLink: LinkedLayerIdentifier)(implicit ctx: DBAccessContext,
                                                                     ec: ExecutionContext): Fox[StaticLayer] =
    for {
      dataset <- datasetDAO.findOne(layerToLink.datasetId) ?~> Msg.Dataset.notFound(layerToLink.datasetId)
      usableDataSource <- datasetService.usableDataSourceFor(dataset)
      layer: StaticLayer <- usableDataSource.dataLayers
        .find(_.name == layerToLink.layerName)
        .toFox ?~> Msg.Dataset.LayerToLink.layerNotFound
      newName = layerToLink.newLayerName.getOrElse(layer.name)
      layerRenamed: StaticLayer <- layer match {
        case l: StaticColorLayer        => Fox.successful(l.copy(name = newName))
        case l: StaticSegmentationLayer => Fox.successful(l.copy(name = newName))
        case _                          => Fox.failure("Unknown layer type for link")
      }
    } yield layerRenamed

}
