package models.dataset.explore

import collections.SequenceUtils
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.geometry.Vec3Double
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.explore.{
  ExploreLayerUtils,
  ExploreRemoteDatasetResponse,
  ExploreRemoteLayerParameters
}
import com.scalableminds.webknossos.datastore.models.datasource._
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.typesafe.scalalogging.LazyLogging
import models.dataset.{DataStore, DataStoreDAO, DatasetService, WKRemoteDataStoreClient}
import models.dataset.credential.CredentialService
import models.organization.OrganizationDAO
import models.user.User
import net.liftweb.common.Box.tryo
import play.api.libs.json.{Json, OFormat}
import security.WkSilhouetteEnvironment
import utils.ObjectId

import java.net.URI
import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class WKExploreRemoteLayerParameters(remoteUri: String,
                                          credentialIdentifier: Option[String],
                                          credentialSecret: Option[String],
                                          preferredVoxelSize: Option[Vec3Double],
                                          dataStoreName: Option[String])

object WKExploreRemoteLayerParameters {
  implicit val jsonFormat: OFormat[WKExploreRemoteLayerParameters] = Json.format[WKExploreRemoteLayerParameters]
}

case class ExploreAndAddRemoteDatasetParameters(remoteUri: String,
                                                datasetName: String,
                                                folderPath: Option[String],
                                                dataStoreName: Option[String])

object ExploreAndAddRemoteDatasetParameters {
  implicit val jsonFormat: OFormat[ExploreAndAddRemoteDatasetParameters] =
    Json.format[ExploreAndAddRemoteDatasetParameters]
}

class WKExploreRemoteLayerService @Inject()(credentialService: CredentialService,
                                            organizationDAO: OrganizationDAO,
                                            dataStoreDAO: DataStoreDAO,
                                            datasetService: DatasetService,
                                            wkSilhouetteEnvironment: WkSilhouetteEnvironment,
                                            rpc: RPC)
    extends FoxImplicits
    with ExploreLayerUtils
    with LazyLogging {

  private lazy val bearerTokenService = wkSilhouetteEnvironment.combinedAuthenticatorService.tokenAuthenticatorService

  def exploreRemoteDatasource(parameters: List[WKExploreRemoteLayerParameters], requestingUser: User)(
      implicit ec: ExecutionContext): Fox[ExploreRemoteDatasetResponse] =
    for {
      credentialIds <- Fox.serialCombined(parameters)(
        parameters =>
          storeCredentials(parameters.remoteUri,
                           parameters.credentialIdentifier,
                           parameters.credentialSecret,
                           requestingUser))
      parametersWithCredentialId = parameters.zip(credentialIds).map {
        case (originalParameters, credentialId) =>
          ExploreRemoteLayerParameters(originalParameters.remoteUri,
                                       credentialId.map(_.toString),
                                       originalParameters.preferredVoxelSize)
      }
      datastore <- selectDataStore(parameters.map(_.dataStoreName))
      client: WKRemoteDataStoreClient = new WKRemoteDataStoreClient(datastore, rpc)
      organization <- organizationDAO.findOne(requestingUser._organization)(GlobalAccessContext)
      userToken <- bearerTokenService.createAndInitDataStoreTokenForUser(requestingUser)
      exploreResponse <- client.exploreRemoteDataset(parametersWithCredentialId, organization.name, userToken)
    } yield exploreResponse

  private def selectDataStore(dataStoreNames: List[Option[String]])(implicit ec: ExecutionContext): Fox[DataStore] =
    for {
      dataStoreNameOpt <- SequenceUtils.findUniqueElement(dataStoreNames) ?~> "explore.dataStore.mustBeEqualForAll"
      dataStore <- dataStoreNameOpt match {
        case Some(dataStoreName) => dataStoreDAO.findOneByName(dataStoreName)(GlobalAccessContext)
        case None                => dataStoreDAO.findOneWithUploadsAllowed(GlobalAccessContext)
      }
    } yield dataStore

  private def storeCredentials(layerUri: String,
                               credentialIdentifier: Option[String],
                               credentialSecret: Option[String],
                               requestingUser: User)(implicit ec: ExecutionContext): Fox[Option[ObjectId]] =
    for {
      uri <- tryo(new URI(removeHeaderFileNamesFromUriSuffix(layerUri))) ?~> s"Received invalid URI: $layerUri"
      credentialOpt = credentialService.createCredentialOpt(uri,
                                                            credentialIdentifier,
                                                            credentialSecret,
                                                            requestingUser._id,
                                                            requestingUser._organization)
      _ <- bool2Fox(uri.getScheme != null) ?~> s"Received invalid URI: $layerUri"
      credentialId <- Fox.runOptional(credentialOpt)(c => credentialService.insertOne(c)) ?~> "dataVault.credential.insert.failed"
    } yield credentialId

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
