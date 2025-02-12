package controllers

import play.silhouette.api.Silhouette
import com.scalableminds.util.tools.{Fox, FoxImplicits}

import javax.inject.Inject
import models.dataset.{DataStore, DataStoreDAO, DataStoreService}
import models.user.MultiUserDAO
import com.scalableminds.util.tools.Empty
import play.api.i18n.Messages
import play.api.libs.functional.syntax._
import play.api.libs.json._
import play.api.mvc.{AbstractController, Action, AnyContent, ControllerComponents}
import security.WkEnv

import scala.concurrent.{ExecutionContext, Future}

class DataStoreController @Inject() (
    dataStoreDAO: DataStoreDAO,
    dataStoreService: DataStoreService,
    sil: Silhouette[WkEnv],
    multiUserDAO: MultiUserDAO,
    cc: ControllerComponents
)(implicit ec: ExecutionContext)
    extends AbstractController(cc)
    with WkControllerUtils
    with FoxImplicits {

  private val dataStoreReads: Reads[DataStore] =
    ((__ \ "name").read[String] and
      (__ \ "url").read[String] and
      (__ \ "publicUrl").read[String] and
      (__ \ "key").read[String] and
      (__ \ "isScratch").readNullable[Boolean] and
      (__ \ "allowsUpload").readNullable[Boolean])(DataStore.fromForm)

  private val dataStorePublicReads: Reads[DataStore] =
    ((__ \ "name").read[String] and
      (__ \ "url").read[String] and
      (__ \ "publicUrl").read[String] and
      (__ \ "isScratch").readNullable[Boolean] and
      (__ \ "allowsUpload").readNullable[Boolean])(DataStore.fromUpdateForm)

  def list: Action[AnyContent] = sil.UserAwareAction.async { implicit request =>
    for {
      dataStores <- dataStoreDAO.findAll ?~> "dataStore.list.failed"
      js <- Fox.serialCombined(dataStores)(d => dataStoreService.publicWrites(d))
    } yield Ok(Json.toJson(js))
  }

  def create: Action[JsValue] = sil.SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(dataStoreReads) { dataStore =>
      dataStoreDAO.findOneByName(dataStore.name).futureBox.flatMap {
        case Empty =>
          for {
            _ <- bool2Fox(request.identity.isAdmin) ?~> "notAllowed" ~> FORBIDDEN
            _ <- dataStoreDAO.insertOne(dataStore) ?~> "dataStore.create.failed"
            js <- dataStoreService.publicWrites(dataStore)
          } yield Ok(Json.toJson(js))
        case _ => Future.successful(JsonBadRequest(Messages("dataStore.name.alreadyTaken")))
      }
    }
  }

  def delete(name: String): Action[AnyContent] = sil.SecuredAction.async { implicit request =>
    for {
      multiUser <- multiUserDAO.findOne(request.identity._multiUser)
      _ <- bool2Fox(multiUser.isSuperUser) ?~> "notAllowed" ~> FORBIDDEN
      _ <- dataStoreDAO.deleteOneByName(name) ?~> "dataStore.remove.failure"
    } yield Ok
  }

  def update(name: String): Action[JsValue] = sil.SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(dataStorePublicReads) { dataStore =>
      for {
        _ <- bool2Fox(request.identity.isAdmin)
        _ <- dataStoreDAO.findOneByName(name) ?~> "dataStore.notFound" ~> NOT_FOUND
        _ <- bool2Fox(dataStore.name == name)
        _ <- dataStoreDAO.updateOne(dataStore) ?~> "dataStore.create.failed"
        js <- dataStoreService.publicWrites(dataStore)
      } yield Ok(Json.toJson(js))
    }
  }
}
