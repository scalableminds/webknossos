package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.tools.FoxImplicits
import com.scalableminds.webknossos.datastore.storage.{HttpBasicAuthCredential, S3AccessKeyCredential}
import models.binary.credential.CredentialDAO
import oxalis.security.WkEnv
import play.api.libs.json.{Json, OFormat}
import play.api.mvc.{Action, PlayBodyParsers}
import utils.ObjectId

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class HttpBasicAuthCredentialParameters(name: String, username: String, password: String, domain: Option[String])

object HttpBasicAuthCredentialParameters {
  implicit val jsonFormat: OFormat[HttpBasicAuthCredentialParameters] = Json.format[HttpBasicAuthCredentialParameters]
}

case class S3AccessKeyCredentialParameters(name: String, keyId: String, key: String, bucket: Option[String])

object S3AccessKeyCredentialParameters {
  implicit val jsonFormat: OFormat[S3AccessKeyCredentialParameters] = Json.format[S3AccessKeyCredentialParameters]
}

class CredentialController @Inject()(credentialDAO: CredentialDAO, sil: Silhouette[WkEnv])(
    implicit ec: ExecutionContext,
    val bodyParsers: PlayBodyParsers)
    extends Controller
    with FoxImplicits {

  def createHttpBasicAuthCredential: Action[HttpBasicAuthCredentialParameters] =
    sil.SecuredAction.async(validateJson[HttpBasicAuthCredentialParameters]) { implicit request =>
      val _id = ObjectId.generate
      for {
        _ <- bool2Fox(request.identity.isAdmin) ?~> "notAllowed" ~> FORBIDDEN
        _ <- credentialDAO.insertOne(_id,
                                     HttpBasicAuthCredential(request.body.name,
                                                             request.body.username,
                                                             request.body.password,
                                                             request.body.domain)) ?~> "create.failed"
      } yield Ok
    }

  def createS3AccessKeyCredential: Action[S3AccessKeyCredentialParameters] =
    sil.SecuredAction.async(validateJson[S3AccessKeyCredentialParameters]) { implicit request =>
      val _id = ObjectId.generate
      for {
        _ <- bool2Fox(request.identity.isAdmin) ?~> "notAllowed" ~> FORBIDDEN
        _ <- credentialDAO.insertOne(_id,
                                     S3AccessKeyCredential(request.body.name,
                                                           request.body.keyId,
                                                           request.body.key,
                                                           request.body.bucket)) ?~> "create.failed"
      } yield Ok
    }

}
