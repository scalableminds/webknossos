package models.dataset.explore

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.explore.{
  ExploreLayerUtils,
  N5ArrayExplorer,
  N5MultiscalesExplorer,
  NeuroglancerUriExplorer,
  NgffExplorer,
  PrecomputedExplorer,
  RemoteLayerExplorer,
  WebknossosZarrExplorer,
  Zarr3ArrayExplorer,
  ZarrArrayExplorer
}
import com.scalableminds.webknossos.datastore.models.datasource._
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.datastore.storage.{DataVaultService, RemoteSourceDescriptor}
import com.typesafe.scalalogging.LazyLogging
import models.dataset.{DataStoreDAO, DatasetService, WKRemoteDataStoreClient}
import models.dataset.credential.CredentialService
import models.organization.OrganizationDAO
import models.user.User
import net.liftweb.common.{Empty, Failure, Full}
import net.liftweb.common.Box.tryo
import play.api.libs.json.{Json, OFormat}
import security.{WkEnv, WkSilhouetteEnvironment}
import utils.{ObjectId, WkConf}

import java.net.URI
import javax.inject.Inject
import scala.collection.mutable.ListBuffer
import scala.concurrent.ExecutionContext

case class ExploreRemoteDatasetParameters(remoteUri: String,
                                          credentialIdentifier: Option[String],
                                          credentialSecret: Option[String],
                                          preferredVoxelSize: Option[Vec3Double])

object ExploreRemoteDatasetParameters {
  implicit val jsonFormat: OFormat[ExploreRemoteDatasetParameters] = Json.format[ExploreRemoteDatasetParameters]
}

case class ExploreAndAddRemoteDatasetParameters(remoteUri: String, datasetName: String, folderPath: Option[String])

object ExploreAndAddRemoteDatasetParameters {
  implicit val jsonFormat: OFormat[ExploreAndAddRemoteDatasetParameters] =
    Json.format[ExploreAndAddRemoteDatasetParameters]
}

class WKExploreRemoteLayerService @Inject()(credentialService: CredentialService,
                                            dataVaultService: DataVaultService,
                                            organizationDAO: OrganizationDAO,
                                            dataStoreDAO: DataStoreDAO,
                                            datasetService: DatasetService,
                                            wkSilhouetteEnvironment: WkSilhouetteEnvironment,
                                            rpc: RPC,
                                            wkConf: WkConf)
    extends FoxImplicits
    with LazyLogging {

  private lazy val bearerTokenService = wkSilhouetteEnvironment.combinedAuthenticatorService.tokenAuthenticatorService

  def addRemoteDatasource(dataSource: GenericDataSource[DataLayer],
                          datasetName: String,
                          user: User,
                          folderId: Option[ObjectId])(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      organization <- organizationDAO.findOne(user._organization)
      dataStore <- dataStoreDAO.findOneWithUploadsAllowed
      _ <- datasetService.assertValidDatasetName(datasetName)
      _ <- datasetService.assertNewDatasetName(datasetName, organization._id) ?~> "dataset.name.alreadyTaken"
      client = new WKRemoteDataStoreClient(dataStore, rpc)
      userToken <- bearerTokenService.createAndInitDataStoreTokenForUser(user)
      _ <- client.addDataSource(organization.name, datasetName, dataSource, folderId, userToken)
    } yield ()

}

class ExploreRemoteLayerService @Inject()(credentialService: CredentialService,
                                          dataVaultService: DataVaultService,
                                          dataStoreConfig: DataStoreConfig)
    extends ExploreLayerUtils
    with FoxImplicits
    with LazyLogging {

  // TODO: move to datastore

  def exploreRemoteDatasource(
      parameters: List[ExploreRemoteDatasetParameters],
      requestIdentity: WkEnv#I,
      reportMutable: ListBuffer[String])(implicit ec: ExecutionContext): Fox[GenericDataSource[DataLayer]] =
    for {
      exploredLayersNested <- Fox.serialCombined(parameters)(
        parameters =>
          exploreRemoteLayersForUri(parameters.remoteUri,
                                    parameters.credentialIdentifier,
                                    parameters.credentialSecret,
                                    reportMutable,
                                    requestIdentity))
      layersWithVoxelSizes = exploredLayersNested.flatten
      preferredVoxelSize = parameters.flatMap(_.preferredVoxelSize).headOption
      _ <- bool2Fox(layersWithVoxelSizes.nonEmpty) ?~> "Detected zero layers"
      (layers, voxelSize) <- adaptLayersAndVoxelSize(layersWithVoxelSizes, preferredVoxelSize)
      dataSource = GenericDataSource[DataLayer](
        DataSourceId("", ""), // Frontend will prompt user for a good name
        layers,
        voxelSize
      )
    } yield dataSource

  private def exploreRemoteLayersForUri(
      layerUri: String,
      credentialIdentifier: Option[String],
      credentialSecret: Option[String],
      reportMutable: ListBuffer[String],
      requestingUser: User)(implicit ec: ExecutionContext): Fox[List[(DataLayerWithMagLocators, Vec3Double)]] =
    for {
      uri <- tryo(new URI(removeHeaderFileNamesFromUriSuffix(layerUri))) ?~> s"Received invalid URI: $layerUri"
      _ <- bool2Fox(uri.getScheme != null) ?~> s"Received invalid URI: $layerUri"
      _ <- assertLocalPathInWhitelist(uri)
      credentialOpt = credentialService.createCredentialOpt(uri,
                                                            credentialIdentifier,
                                                            credentialSecret,
                                                            requestingUser._id,
                                                            requestingUser._organization)
      remoteSource = RemoteSourceDescriptor(uri, credentialOpt)
      credentialId <- Fox.runOptional(credentialOpt)(c => credentialService.insertOne(c)) ?~> "dataVault.credential.insert.failed"
      remotePath <- dataVaultService.getVaultPath(remoteSource) ?~> "dataVault.setup.failed"
      layersWithVoxelSizes <- exploreRemoteLayersForRemotePath(
        remotePath,
        credentialId.map(_.toString),
        reportMutable,
        List(
          new ZarrArrayExplorer(Vec3Int.ones),
          new NgffExplorer,
          new WebknossosZarrExplorer,
          new N5ArrayExplorer,
          new N5MultiscalesExplorer,
          new PrecomputedExplorer,
          new Zarr3ArrayExplorer,
          new NeuroglancerUriExplorer(dataVaultService)
        )
      )
    } yield layersWithVoxelSizes

  private def assertLocalPathInWhitelist(uri: URI)(implicit ec: ExecutionContext): Fox[Unit] =
    if (uri.getScheme == DataVaultService.schemeFile) {
      bool2Fox(dataStoreConfig.Datastore.localFolderWhitelist.exists(whitelistEntry =>
        uri.getPath.startsWith(whitelistEntry))) ?~> s"Absolute path ${uri.getPath} in local file system is not in path whitelist. Consider adding it to datastore.localFolderWhitelist"
    } else Fox.successful(())

  private def exploreRemoteLayersForRemotePath(remotePath: VaultPath,
                                               credentialId: Option[String],
                                               reportMutable: ListBuffer[String],
                                               explorers: List[RemoteLayerExplorer])(
      implicit ec: ExecutionContext): Fox[List[(DataLayerWithMagLocators, Vec3Double)]] =
    explorers match {
      case Nil => Fox.empty
      case currentExplorer :: remainingExplorers =>
        reportMutable += s"\nTrying to explore $remotePath as ${currentExplorer.name}..."
        currentExplorer.explore(remotePath, credentialId).futureBox.flatMap {
          case Full(layersWithVoxelSizes) =>
            reportMutable += s"Found ${layersWithVoxelSizes.length} ${currentExplorer.name} layers at $remotePath."
            Fox.successful(layersWithVoxelSizes)
          case f: Failure =>
            reportMutable += s"Error when reading $remotePath as ${currentExplorer.name}: ${Fox.failureChainAsString(f)}"
            exploreRemoteLayersForRemotePath(remotePath, credentialId, reportMutable, remainingExplorers)
          case Empty =>
            reportMutable += s"Error when reading $remotePath as ${currentExplorer.name}: Empty"
            exploreRemoteLayersForRemotePath(remotePath, credentialId, reportMutable, remainingExplorers)
        }
    }

}
