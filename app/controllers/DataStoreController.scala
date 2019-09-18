package controllers

import com.mohiva.play.silhouette.api.Silhouette
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import javax.inject.Inject
import models.binary.{DataStore, DataStoreDAO, DataStoreService}
import models.user.UserService
import net.liftweb.common.Empty
import oxalis.security.WkEnv
import play.api.i18n.Messages
import play.api.libs.functional.syntax._
import play.api.libs.json._

import scala.concurrent.{ExecutionContext, Future}

class DataStoreController @Inject()(dataStoreDAO: DataStoreDAO,
                                    dataStoreService: DataStoreService,
                                    userService: UserService,
                                    sil: Silhouette[WkEnv])(implicit ec: ExecutionContext)
    extends Controller
    with FoxImplicits {

  val dataStoreReads: Reads[DataStore] =
    ((__ \ 'name).read[String] and
      (__ \ 'url).read[String] and
      (__ \ 'publicUrl).read[String] and
      (__ \ 'key).read[String] and
      (__ \ 'isScratch).readNullable[Boolean] and
      (__ \ 'isForeign).readNullable[Boolean] and
      (__ \ 'isConnector).readNullable[Boolean])(DataStore.fromForm _)

  val dataStorePublicReads: Reads[DataStore] =
    ((__ \ 'name).read[String] and
      (__ \ 'url).read[String] and
      (__ \ 'publicUrl).read[String] and
      (__ \ 'isScratch).readNullable[Boolean] and
      (__ \ 'isForeign).readNullable[Boolean] and
      (__ \ 'isConnector).readNullable[Boolean])(DataStore.fromUpdateForm _)

  def list = sil.UserAwareAction.async { implicit request =>
    for {
      dataStores <- dataStoreDAO.findAll ?~> "dataStore.list.failed"
      js <- Fox.serialCombined(dataStores)(d => dataStoreService.publicWrites(d))
    } yield {
      Ok(Json.toJson(js))
    }
  }

  def create = sil.SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(dataStoreReads) { dataStore =>
      dataStoreDAO.findOneByName(dataStore.name).futureBox.flatMap {
        case Empty =>
          for {
            _ <- bool2Fox(request.identity.isAdmin) ?~> "notAllowed" ~> FORBIDDEN
            _ <- dataStoreDAO.insertOne(dataStore) ?~> "dataStore.create.failed"
            js <- dataStoreService.publicWrites(dataStore)
          } yield { Ok(js) }
        case _ => Future.successful(JsonBadRequest(Messages("dataStore.name.alreadyTaken")))
      }
    }
  }

  def delete(name: String) = sil.SecuredAction.async { implicit request =>
    for {
      _ <- bool2Fox(request.identity.isAdmin) ?~> "notAllowed" ~> FORBIDDEN
      _ <- dataStoreDAO.deleteOneByName(name) ?~> "dataStore.remove.failure"
    } yield Ok
  }

  def update(name: String) = sil.SecuredAction.async(parse.json) { implicit request =>
    withJsonBodyUsing(dataStorePublicReads) { dataStore =>
      for {
        _ <- bool2Fox(request.identity.isAdmin)
        _ <- dataStoreDAO.findOneByName(name) ?~> "dataStore.notFound" ~> NOT_FOUND
        _ <- dataStoreDAO.updateOne(dataStore) ?~> "dataStore.create.failed"
        js <- dataStoreService.publicWrites(dataStore)
      } yield { Ok(js) }

    }
  }
}
