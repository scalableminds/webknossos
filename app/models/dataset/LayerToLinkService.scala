package models.dataset

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
import play.api.i18n.{Messages, MessagesProvider}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class LayerToLinkService @Inject()(datasetDAO: DatasetDAO, userService: UserService, datasetService: DatasetService)
    extends FoxImplicits {

  def validateLayerToLink(layerIdentifier: LinkedLayerIdentifier,
                          requestingUser: User)(implicit ec: ExecutionContext, m: MessagesProvider): Fox[Unit] =
    for {
      dataset <- datasetDAO.findOne(layerIdentifier.datasetId)(AuthorizedAccessContext(requestingUser)) ?~> Messages(
        "dataset.notFound",
        layerIdentifier.datasetId) ~> NOT_FOUND
      isTeamManagerOrAdmin <- userService.isTeamManagerOrAdminOfOrg(requestingUser, dataset._organization)
      _ <- Fox.fromBool(isTeamManagerOrAdmin || requestingUser.isDatasetManager || dataset.isPublic) ?~> "dataset.upload.linkRestricted"
    } yield ()

  def addLayersToLinkToDataSource(dataSource: UsableDataSource, layersToLink: Seq[LinkedLayerIdentifier])(
      implicit ctx: DBAccessContext,
      mp: MessagesProvider,
      ec: ExecutionContext): Fox[UsableDataSource] =
    for {
      linkedLayers <- Fox.serialCombined(layersToLink)(resolveLayerToLink) ?~> "dataset.layerToLink.failed"
      allLayers = linkedLayers ++ dataSource.dataLayers
      _ <- Fox.fromBool(allLayers.length == allLayers.map(_.name).distinct.length) ?~> "dataset.duplicateLayerNames"
    } yield dataSource.copy(dataLayers = allLayers)

  private def resolveLayerToLink(layerToLink: LinkedLayerIdentifier)(implicit ctx: DBAccessContext,
                                                                     ec: ExecutionContext,
                                                                     mp: MessagesProvider): Fox[StaticLayer] =
    for {
      dataset <- datasetDAO.findOne(layerToLink.datasetId) ?~> "dataset.notFound"
      usableDataSource <- datasetService.usableDataSourceFor(dataset)
      layer: StaticLayer <- usableDataSource.dataLayers
        .find(_.name == layerToLink.layerName)
        .toFox ?~> "dataset.layerToLink.layerNotFound"
      newName = layerToLink.newLayerName.getOrElse(layer.name)
      layerRenamed: StaticLayer <- layer match {
        case l: StaticColorLayer        => Fox.successful(l.copy(name = newName))
        case l: StaticSegmentationLayer => Fox.successful(l.copy(name = newName))
        case _                          => Fox.failure("Unknown layer type for link")
      }
    } yield layerRenamed

}
