package models.binary.credential

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.storage.{
  FileSystemsHolder,
  HttpBasicAuthCredential,
  S3AccessKeyCredential
}
import utils.ObjectId

import java.net.URI
import javax.inject.Inject
import scala.concurrent.ExecutionContext

class CredentialService @Inject()(credentialDao: CredentialDAO) {

  def storeCredential(uri: URI, username: Option[String], password: Option[String], user: String, organization: String)(
      implicit ec: ExecutionContext): Fox[Option[ObjectId]] = {
    val scheme = uri.getScheme
    scheme match {
      case FileSystemsHolder.schemeHttps =>
        username match {
          case Some(u) =>
            val _id = ObjectId.generate
            for {
              _ <- credentialDao.insertOne(
                _id,
                HttpBasicAuthCredential(uri.toString, u, password.getOrElse(""), user, organization))
            } yield Some(_id)
          case None => Fox.successful(None)
        }
      case FileSystemsHolder.schemeS3 =>
        username match {
          case Some(keyId) =>
            password match {
              case Some(secretKey) =>
                val _id = ObjectId.generate
                for {
                  _ <- credentialDao.insertOne(
                    _id,
                    S3AccessKeyCredential(uri.toString, keyId, secretKey, user, organization))
                } yield Some(_id)
              case None => Fox.successful(None)
            }
          case None => Fox.successful(None)
        }
    }
  }

}
