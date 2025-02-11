package models.dataset.credential

import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.storage.{
  DataVaultCredential,
  DataVaultService,
  GoogleServiceAccountCredential,
  HttpBasicAuthCredential,
  S3AccessKeyCredential
}
import com.scalableminds.util.tools.Box.tryo
import play.api.libs.json.Json

import java.net.URI
import javax.inject.Inject
import scala.concurrent.ExecutionContext

class CredentialService @Inject()(credentialDAO: CredentialDAO) {

  def createCredentialOpt(uri: URI,
                          credentialIdentifier: Option[String],
                          credentialSecret: Option[String],
                          userId: ObjectId,
                          organizationId: String): Option[DataVaultCredential] =
    uri.getScheme match {
      case DataVaultService.schemeHttps | DataVaultService.schemeHttp =>
        credentialIdentifier.map(
          username =>
            HttpBasicAuthCredential(uri.toString,
                                    username,
                                    credentialSecret.getOrElse(""),
                                    userId.toString,
                                    organizationId))
      case DataVaultService.schemeS3 =>
        (credentialIdentifier, credentialSecret) match {
          case (Some(keyId), Some(secretKey)) =>
            Some(S3AccessKeyCredential(uri.toString, keyId, secretKey, userId.toString, organizationId))
          case _ => None
        }
      case DataVaultService.schemeGS =>
        for {
          secret <- credentialSecret
          secretJson <- tryo(Json.parse(secret)).toOption
        } yield GoogleServiceAccountCredential(uri.toString, secretJson, userId.toString, organizationId)
      case _ =>
        None
    }

  def insertOne(credential: DataVaultCredential)(implicit ec: ExecutionContext): Fox[ObjectId] = {
    val _id = ObjectId.generate
    for {
      _ <- credential match {
        case c: HttpBasicAuthCredential        => credentialDAO.insertOne(_id, c)
        case c: S3AccessKeyCredential          => credentialDAO.insertOne(_id, c)
        case c: GoogleServiceAccountCredential => credentialDAO.insertOne(_id, c)
        case _                                 => Fox.failure("Unknown credential type")
      }
    } yield _id
  }

}
