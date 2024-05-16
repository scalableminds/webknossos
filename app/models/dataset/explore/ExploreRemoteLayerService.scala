package models.dataset.explore

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.explore.{
  ExploreLayerUtils,
  ExploreRemoteLayerParameters,
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

case class WKExploreRemoteDatasetParameters(remoteUri: String,
                                            credentialIdentifier: Option[String],
                                            credentialSecret: Option[String],
                                            preferredVoxelSize: Option[Vec3Double])

object WKExploreRemoteDatasetParameters {
  implicit val jsonFormat: OFormat[WKExploreRemoteDatasetParameters] = Json.format[WKExploreRemoteDatasetParameters]
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

  def exploreRemoteDatasource(
      parameters: List[WKExploreRemoteDatasetParameters],
      requestIdentity: WkEnv#I, // TODO report comes from datastore
      reportMutable: ListBuffer[String])(implicit ec: ExecutionContext): Fox[GenericDataSource[DataLayer]] =
    for {
      credentialIds <- Fox.serialCombined(parameters)(parameters =>
        storeCredentials(parameters.remoteUri, parameters.credentialIdentifier, parameters.credentialSecret))
      adaptedParameters = parameters.zip(credentialIds).map {
        case (originalParameters, credentialId) =>
          ExploreRemoteLayerParameters(originalParameters.remoteUri,
                                       credentialId.map(_.toString),
                                       originalParameters.preferredVoxelSize)
      }
      client: WKRemoteDataStoreClient <- new WKRemoteDataStoreClient()
      (dataSource, report) <- client.exploreRemoteDataset(adaptedParameters)
    } yield (dataSource, report)

  private def storeCredentials(remoteUri: String,
                               credentialIdentifier: Option[String],
                               credentialSecret: Option[String]): Fox[Option[ObjectId]] = ???

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
