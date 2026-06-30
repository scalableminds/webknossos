package models.dataset.explore

import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.collections.SequenceUtils
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.explore.{
  ExploreLayerUtils,
  ExploreRemoteDatasetResponse,
  ExploreRemoteLayerParameters
}
import com.scalableminds.webknossos.datastore.models.VoxelSize
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.typesafe.scalalogging.LazyLogging
import models.dataset.{DataStore, DataStoreDAO, WKRemoteDataStoreClient}
import models.dataset.credential.CredentialService
import models.organization.OrganizationDAO
import models.user.User
import com.scalableminds.util.tools.Box.tryo
import play.api.libs.json.{Json, OFormat}
import security.WkSilhouetteEnvironment
import com.scalableminds.util.objectid.ObjectId

import java.net.URI
import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class WKExploreRemoteLayerParameters(
    remoteUri: String,
    credentialIdentifier: Option[String],
    credentialSecret: Option[String],
    preferredVoxelSize: Option[VoxelSize],
    dataStoreName: Option[String]
)

object WKExploreRemoteLayerParameters {
  implicit val jsonFormat: OFormat[WKExploreRemoteLayerParameters] = Json.format[WKExploreRemoteLayerParameters]
}

case class ExploreAndAddRemoteDatasetParameters(
    remoteUri: String,
    datasetName: String,
    folderId: Option[ObjectId],
    folderPath: Option[String],
    dataStoreName: Option[String]
)

object ExploreAndAddRemoteDatasetParameters {
  implicit val jsonFormat: OFormat[ExploreAndAddRemoteDatasetParameters] =
    Json.format[ExploreAndAddRemoteDatasetParameters]
}

class WKExploreRemoteLayerService @Inject() (
    credentialService: CredentialService,
    organizationDAO: OrganizationDAO,
    dataStoreDAO: DataStoreDAO,
    wkSilhouetteEnvironment: WkSilhouetteEnvironment,
    rpc: RPC
) extends ExploreLayerUtils
    with LazyLogging {

  private lazy val bearerTokenService = wkSilhouetteEnvironment.combinedAuthenticatorService.tokenAuthenticatorService

  def exploreRemoteDatasource(parameters: List[WKExploreRemoteLayerParameters], requestingUser: User)(implicit
      ec: ExecutionContext
  ): Fox[ExploreRemoteDatasetResponse] =
    for {
      credentialIds <- Fox.serialCombined(parameters)(parameters =>
        storeCredentials(
          parameters.remoteUri,
          parameters.credentialIdentifier,
          parameters.credentialSecret,
          requestingUser
        )
      )
      parametersWithCredentialId = parameters.zip(credentialIds).map { case (originalParameters, credentialId) =>
        ExploreRemoteLayerParameters(
          originalParameters.remoteUri,
          credentialId.map(_.toString),
          originalParameters.preferredVoxelSize
        )
      }
      datastore <- selectDataStore(parameters.map(_.dataStoreName))
      client: WKRemoteDataStoreClient = new WKRemoteDataStoreClient(datastore, rpc)
      organization <- organizationDAO.findOne(requestingUser._organization)(using GlobalAccessContext)
      userToken <- bearerTokenService.createAndInitDataStoreTokenForUser(requestingUser)
      exploreResponse <- client.exploreRemoteDataset(parametersWithCredentialId, organization._id, userToken)
    } yield exploreResponse

  private def selectDataStore(dataStoreNames: List[Option[String]])(implicit ec: ExecutionContext): Fox[DataStore] =
    for {
      dataStoreNameOpt <- SequenceUtils
        .findUniqueElement(dataStoreNames)
        .toFox ?~> Msg.Dataset.Explore.dataStoreMustBeEqualForAll
      dataStore <- dataStoreNameOpt match {
        case Some(dataStoreName) => dataStoreDAO.findOneByName(dataStoreName)(using GlobalAccessContext)
        case None                => dataStoreDAO.findOneWithUploadsAllowed(using GlobalAccessContext)
      }
    } yield dataStore

  private def storeCredentials(
      layerUri: String,
      credentialIdentifier: Option[String],
      credentialSecret: Option[String],
      requestingUser: User
  )(implicit ec: ExecutionContext): Fox[Option[ObjectId]] =
    for {
      // For zip entry paths (e.g. s3://…/archive.zip|zip:inner/path), credentials apply to the whole zip file.
      uri <- tryo(new URI(removeHeaderFileNamesFromUriSuffix(layerUri.takeWhile(_ != '|')))).toFox ?~> s"Received invalid URI: $layerUri"
      credentialOpt = credentialService.createCredentialOpt(
        uri,
        credentialIdentifier,
        credentialSecret,
        Some(requestingUser._id),
        Some(requestingUser._organization)
      )
      _ <- Fox.fromBool(uri.getScheme != null) ?~> s"Received invalid URI: $layerUri"
      credentialId <- Fox.runOptional(credentialOpt)(c =>
        credentialService.insertOne(c)
      ) ?~> Msg.DataVault.credentialInsertFailed
    } yield credentialId

}
