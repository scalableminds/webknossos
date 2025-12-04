package controllers

import play.silhouette.api.Silhouette
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.storage.{
  GoogleServiceAccountCredential,
  HttpBasicAuthCredential,
  S3AccessKeyCredential
}
import models.dataset.credential.CredentialDAO
import play.api.libs.json.{JsValue, Json, OFormat}
import play.api.mvc.{Action, PlayBodyParsers}
import security.WkEnv
import com.scalableminds.util.objectid.ObjectId

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class HttpBasicAuthCredentialParameters(name: String, username: String, password: String)

object HttpBasicAuthCredentialParameters {
  implicit val jsonFormat: OFormat[HttpBasicAuthCredentialParameters] = Json.format[HttpBasicAuthCredentialParameters]
}

case class S3AccessKeyCredentialParameters(name: String, accessKeyId: String, secretAccessKey: String)

object S3AccessKeyCredentialParameters {
  implicit val jsonFormat: OFormat[S3AccessKeyCredentialParameters] = Json.format[S3AccessKeyCredentialParameters]
}

case class GoogleServiceAccountCredentialParameters(name: String, secretJson: JsValue)

object GoogleServiceAccountCredentialParameters {
  implicit val jsonFormat: OFormat[GoogleServiceAccountCredentialParameters] =
    Json.format[GoogleServiceAccountCredentialParameters]
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
        _ <- Fox.fromBool(request.identity.isAdmin) ?~> "notAllowed" ~> FORBIDDEN
        _ <- credentialDAO.insertOne(
          _id,
          HttpBasicAuthCredential(request.body.name,
                                  request.body.username,
                                  request.body.password,
                                  Some(request.identity._id.toString),
                                  Some(request.identity._organization))
        ) ?~> "create.failed"
      } yield Ok(Json.toJson(_id))
    }

  def createS3AccessKeyCredential: Action[S3AccessKeyCredentialParameters] =
    sil.SecuredAction.async(validateJson[S3AccessKeyCredentialParameters]) { implicit request =>
      val _id = ObjectId.generate
      for {
        _ <- Fox.fromBool(request.identity.isAdmin) ?~> "notAllowed" ~> FORBIDDEN
        _ <- credentialDAO.insertOne(
          _id,
          S3AccessKeyCredential(request.body.name,
                                request.body.accessKeyId,
                                request.body.secretAccessKey,
                                Some(request.identity._id.toString),
                                Some(request.identity._organization))
        ) ?~> "create.failed"
      } yield Ok(Json.toJson(_id))
    }

  def createGoogleServiceAccountCredential: Action[GoogleServiceAccountCredentialParameters] =
    sil.SecuredAction.async(validateJson[GoogleServiceAccountCredentialParameters]) { implicit request =>
      val _id = ObjectId.generate
      for {
        _ <- Fox.fromBool(request.identity.isAdmin) ?~> "notAllowed" ~> FORBIDDEN
        _ <- credentialDAO.insertOne(
          _id,
          GoogleServiceAccountCredential(request.body.name,
                                         request.body.secretJson,
                                         Some(request.identity._id.toString),
                                         Some(request.identity._organization))
        ) ?~> "create.failed"
      } yield Ok(Json.toJson(_id))
    }

}
