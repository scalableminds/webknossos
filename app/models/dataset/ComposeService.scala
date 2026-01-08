package models.dataset

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.explore.ExploreLayerUtils
import com.scalableminds.webknossos.datastore.models.VoxelSize
import com.scalableminds.webknossos.datastore.models.datasource._
import models.user.User
import play.api.i18n.MessagesProvider
import play.api.libs.json.{Json, OFormat}
import spire.std.map

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class ComposeRequest(
    newDatasetName: String,
    targetFolderId: ObjectId,
    organizationId: String,
    voxelSize: VoxelSize,
    layers: Seq[ComposeRequestLayer]
)

object ComposeRequest {
  implicit val composeRequestFormat: OFormat[ComposeRequest] = Json.format[ComposeRequest]
}
case class ComposeRequestLayer(
    datasetId: ObjectId,
    sourceName: String,
    newName: String,
    transformations: Seq[CoordinateTransformation]
)

object ComposeRequestLayer {
  implicit val composeLayerFormat: OFormat[ComposeRequestLayer] = Json.format[ComposeRequestLayer]
}

class ComposeService @Inject()(datasetDAO: DatasetDAO, dataStoreDAO: DataStoreDAO, datasetService: DatasetService)(
    implicit ec: ExecutionContext)
    extends ExploreLayerUtils
    with FoxImplicits {

  def composeDataset(composeRequest: ComposeRequest, user: User)(
      implicit ctx: DBAccessContext,
      mp: MessagesProvider): Fox[(UsableDataSource, ObjectId)] =
    for {
      _ <- Fox.assertTrue(isComposable(composeRequest)) ?~> "Datasets are not composable, they are not on the same data store"
      dataSource <- createDatasource(composeRequest, composeRequest.newDatasetName, composeRequest.organizationId)
      dataStore <- dataStoreDAO.findOneWithUploadsAllowed
      dataset <- datasetService.createAndSetUpDataset(composeRequest.newDatasetName,
                                                      dataStore,
                                                      dataSource,
                                                      Some(composeRequest.targetFolderId),
                                                      user,
                                                      isVirtual = true)

    } yield (dataSource, dataset._id)

  private def getLayerFromComposeLayer(composeLayer: ComposeRequestLayer)(
      implicit ctx: DBAccessContext,
      mp: MessagesProvider): Fox[(StaticLayer, VoxelSize)] =
    for {
      dataset <- datasetDAO.findOne(composeLayer.datasetId) ?~> "Dataset not found"
      usableDataSource <- datasetService.usableDataSourceFor(dataset)
      layer <- usableDataSource.dataLayers.find(_.name == composeLayer.sourceName).toFox
      applyCoordinateTransformations = (cOpt: Option[List[CoordinateTransformation]]) =>
        cOpt match {
          case Some(c) => Some(c ++ composeLayer.transformations.toList)
          case None    => Some(composeLayer.transformations.toList)
      }
      editedLayer = layer.mapped(name = composeLayer.newName,
                                 coordinateTransformations =
                                   applyCoordinateTransformations(layer.coordinateTransformations))
    } yield (editedLayer, usableDataSource.scale)

  private def isComposable(composeRequest: ComposeRequest)(implicit ctx: DBAccessContext): Fox[Boolean] =
    // Check that all datasets are on the same data store
    // Using virtual datasets, we should also be able to compose datasets using non-file paths from different data
    // stores, however, the data store is only stored for each dataset and not per mag.
    for {
      _ <- Fox.fromBool(composeRequest.layers.nonEmpty) ?~> "Cannot compose dataset with no layers"
      datasetIds = composeRequest.layers.map(_.datasetId).distinct
      datasets <- Fox.serialCombined(datasetIds)(datasetDAO.findOne(_))
      dataStores = datasets.map(_._dataStore)
    } yield {
      dataStores.distinct.size == 1
    }

  private def createDatasource(composeRequest: ComposeRequest, datasetDirectoryName: String, organizationId: String)(
      implicit ctx: DBAccessContext,
      mp: MessagesProvider): Fox[UsableDataSource] =
    for {
      layersAndVoxelSizes <- Fox.serialCombined(composeRequest.layers.toList)(getLayerFromComposeLayer)
      voxelSizesDiffer = layersAndVoxelSizes.map(_._2).distinct.length > 1
      (layers, voxelSize) <- if (composeRequest.layers.forall(_.transformations.isEmpty) && (true || voxelSizesDiffer)) {
        adaptLayersAndVoxelSize(layersAndVoxelSizes, None)
      } else {
        Fox.successful(layersAndVoxelSizes.map(_._1), composeRequest.voxelSize)
      }
      dataSource = UsableDataSource(
        DataSourceId(datasetDirectoryName, organizationId),
        layers,
        voxelSize,
        None
      )
    } yield dataSource

}
