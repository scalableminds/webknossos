package controllers

import com.scalableminds.util.Msg
import play.silhouette.api.Silhouette
import com.scalableminds.util.tools.Fox

import javax.inject.Inject
import models.dataset.{DataStore, DataStoreDAO, DataStoreService}
import models.user.{MultiUserDAO, UserService}
import play.api.libs.json.*
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import security.WkEnv

import scala.concurrent.ExecutionContext

case class DataStoreParameters(
    name: String,
    url: String,
    publicUrl: String,
    key: String,
    isScratch: Option[Boolean],
    allowsUpload: Option[Boolean],
    allowsUploadToPaths: Option[Boolean]
)
object DataStoreParameters {
  implicit val jsonFormat: OFormat[DataStoreParameters] = Json.format[DataStoreParameters]
}

class DataStoreController @Inject() (
    dataStoreDAO: DataStoreDAO,
    dataStoreService: DataStoreService,
    userService: UserService,
    sil: Silhouette[WkEnv],
    multiUserDAO: MultiUserDAO
)(implicit ec: ExecutionContext, playBodyParsers: PlayBodyParsers)
    extends Controller {

  def list: Action[AnyContent] = sil.UserAwareAction.fox { implicit request =>
    for {
      dataStores <- dataStoreDAO.findAll ?~> Msg.DataStore.listFailed
      js <- Fox.serialCombined(dataStores)(d => dataStoreService.publicWrites(d))
    } yield Ok(Json.toJson(js))
  }

  def create: Action[DataStoreParameters] = sil.SecuredAction.fox(validateJson[DataStoreParameters]) {
    implicit request =>
      for {
        _ <- userService.assertIsSuperUser(request.identity) ~> FORBIDDEN
        _ <- dataStoreDAO.findOneByName(request.body.name).reverse ?~> Msg.DataStore.nameTaken(request.body.name)
        dataStore = DataStore(
          name = request.body.name,
          url = request.body.url,
          publicUrl = request.body.publicUrl,
          key = request.body.key,
          isScratch = request.body.isScratch.getOrElse(false),
          allowsUpload = request.body.allowsUpload.getOrElse(true),
          allowsUploadToPaths = request.body.allowsUploadToPaths.getOrElse(true)
        )
        _ <- dataStoreDAO.insertOne(dataStore) ?~> Msg.DataStore.createFailed
        js <- dataStoreService.publicWrites(dataStore)
      } yield Ok(Json.toJson(js))
  }

  def delete(name: String): Action[AnyContent] = sil.SecuredAction.fox { implicit request =>
    for {
      multiUser <- multiUserDAO.findOne(request.identity._multiUser)
      _ <- Fox.fromBool(multiUser.isSuperUser) ?~> Msg.notAllowed ~> FORBIDDEN
      _ <- dataStoreDAO.deleteOneByName(name) ?~> Msg.DataStore.deleteFailed
    } yield Ok
  }

}
