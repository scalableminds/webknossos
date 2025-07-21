package models.dataset

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.VoxelSize
import com.scalableminds.webknossos.datastore.models.datasource._
import models.user.User
import play.api.libs.json.{Json, OFormat}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class ComposeRequest(
    newDatasetName: String,
    targetFolderId: String,
    organizationId: String,
    voxelSize: VoxelSize,
    layers: Seq[ComposeRequestLayer]
)

object ComposeRequest {
  implicit val composeRequestFormat: OFormat[ComposeRequest] = Json.format[ComposeRequest]
}
case class ComposeRequestLayer(
    datasetId: String,
    sourceName: String,
    newName: String,
    transformations: Seq[CoordinateTransformation]
)

object ComposeRequestLayer {
  implicit val composeLayerFormat: OFormat[ComposeRequestLayer] = Json.format[ComposeRequestLayer]
}

class ComposeService @Inject()(datasetDAO: DatasetDAO, dataStoreDAO: DataStoreDAO, datasetService: DatasetService)(
    implicit ec: ExecutionContext)
    extends FoxImplicits {

  def composeDataset(composeRequest: ComposeRequest, user: User)(
      implicit ctx: DBAccessContext): Fox[(DataSource, ObjectId)] =
    for {
      _ <- isComposable(composeRequest) ?~> "Datasets are not composable, they are not on the same data store"
      dataSource <- createDatasource(composeRequest, composeRequest.newDatasetName, composeRequest.organizationId)
      dataStore <- dataStoreDAO.findOneWithUploadsAllowed
      dataset <- datasetService.createVirtualDataset(composeRequest.newDatasetName,
                                                     composeRequest.organizationId,
                                                     dataStore,
                                                     dataSource,
                                                     Some(composeRequest.targetFolderId),
                                                     user)

    } yield (dataSource, dataset._id)

  private def getLayerFromComposeLayer(composeLayer: ComposeRequestLayer)(
      implicit ctx: DBAccessContext): Fox[DataLayer] =
    for {
      datasetIdValidated <- ObjectId.fromString(composeLayer.datasetId) ?~> "Invalid dataset ID"
      dataset <- datasetDAO.findOne(datasetIdValidated) ?~> "Dataset not found"
      ds <- datasetService.fullDataSourceFor(dataset)
      ds <- ds.toUsable.toFox ?~> "Dataset not usable"
      layer <- ds.dataLayers.find(_.name == composeLayer.sourceName).toFox
      applyCoordinateTransformations = (cOpt: Option[List[CoordinateTransformation]]) =>
        cOpt match {
          case Some(c) => Some(c ++ composeLayer.transformations.toList)
          case None    => Some(composeLayer.transformations.toList)
      }
      editedLayer: DataLayer <- layer match {
        case l: DataLayerWithMagLocators =>
          Fox.successful(
            l.mapped(name = composeLayer.newName,
                     coordinateTransformations = applyCoordinateTransformations(l.coordinateTransformations)))
        case _ => Fox.failure("Unsupported layer type for composition: " + layer.getClass.getSimpleName)
      }
    } yield editedLayer

  private def isComposable(composeRequest: ComposeRequest)(implicit ctx: DBAccessContext): Fox[Boolean] =
    // Check that all datasets are on the same data store
    // Using virtual datasets, we should also be able to compose datasets using non-file paths from different data
    // stores, however, the data store is only stored for each data set and not per mag.
    for {
      _ <- Fox.successful(())
      datasetIds = composeRequest.layers.map(_.datasetId).distinct
      datasetIdsValidated <- Fox.serialCombined(datasetIds.toList)(ObjectId.fromString(_)) ?~> "Invalid dataset ID"
      datasets <- Fox.serialCombined(datasetIdsValidated)(datasetDAO.findOne(_))
      dataStores = datasets.map(_._dataStore)
    } yield {
      dataStores.distinct.size == 1
    }

  private def createDatasource(composeRequest: ComposeRequest, datasetDirectoryName: String, organizationId: String)(
      implicit ctx: DBAccessContext): Fox[DataSource] =
    for {
      layers <- Fox.serialCombined(composeRequest.layers.toList)(getLayerFromComposeLayer(_))
      dataSource = GenericDataSource(
        DataSourceId(datasetDirectoryName, organizationId),
        layers,
        composeRequest.voxelSize,
        None
      )

    } yield dataSource

}
