package controllers

import com.scalableminds.util.accesscontext.DBAccessContext
import javax.inject.Inject
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.binary.{DataStore, DataStoreDAO, DataStoreService}
import oxalis.security.WebknossosSilhouette
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.{Json, Writes}

class DataStoreController @Inject()(dataStoreDAO: DataStoreDAO,
                                    dataStoreService: DataStoreService,
                                    sil: WebknossosSilhouette,
                                    val messagesApi: MessagesApi) extends Controller with FoxImplicits {

  implicit def userAwareRequestToDBAccess(implicit request: sil.UserAwareRequest[_]) = DBAccessContext(request.identity)
  implicit def securedRequestToDBAccess(implicit request: sil.SecuredRequest[_]) = DBAccessContext(Some(request.identity))

  def list = sil.UserAwareAction.async { implicit request =>
    for {
      dataStores <- dataStoreDAO.findAll ?~> "dataStore.list.failed"
      js <- Fox.serialCombined(dataStores)(d => dataStoreService.publicWrites(d))
    } yield {
      Ok(Json.toJson(js))
    }
  }
}
