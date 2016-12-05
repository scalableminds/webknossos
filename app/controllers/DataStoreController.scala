package controllers

import javax.inject.Inject

import com.scalableminds.util.tools.FoxImplicits
import models.binary.{DataStore, DataStoreDAO}
import oxalis.security.Secured
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Writes

/**
  * Created by tmbo on 29.11.16.
  */
class DataStoreController @Inject()(val messagesApi: MessagesApi) extends Controller with Secured with FoxImplicits {
  def list = UserAwareAction.async { implicit request =>
    for {
      dataStores <- DataStoreDAO.findAll ?~> Messages("dataStore.list.failed")
    } yield {
      Ok(Writes.list(DataStore.dataStorePublicWrites).writes(dataStores))
    }
  }
}
