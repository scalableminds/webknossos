package models.binary

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.schema.Tables._
import javax.inject.Inject
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.json.{JsObject, Json}
import play.api.mvc.{Request, Result, Results, WrappedRequest}
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import utils.{SQLClient, SQLDAO}

import scala.concurrent.{ExecutionContext, Future}


case class DataStore(
                       name: String,
                       url: String,
                       key: String,
                       isDeleted: Boolean = false,
                       isForeign: Boolean = false
                       ) {
}

class DataStoreService @Inject()(dataStoreDAO: DataStoreDAO)(implicit ec: ExecutionContext) extends FoxImplicits with Results {

  def publicWrites(dataStore: DataStore): Fox[JsObject] = {
    Fox.successful(Json.obj(
      "name" -> dataStore.name,
      "url" -> dataStore.url,
      "isForeign" -> dataStore.isForeign
    ))
  }

  def validateAccess[A](name: String)(block: (DataStore) => Future[Result])
                       (implicit request: Request[A], m: MessagesProvider): Fox[Result] = {
    request.getQueryString("key")
      .toFox
      .flatMap(key => dataStoreDAO.findOneByKey(key)(GlobalAccessContext)) // Check if key is valid
      .flatMap(dataStore => block(dataStore)) // Run underlying action
      .getOrElse(Forbidden(Messages("dataStore.notFound"))) // Default error
    }
}

class DataStoreDAO @Inject()(sqlClient: SQLClient)(implicit ec: ExecutionContext) extends SQLDAO[DataStore, DatastoresRow, Datastores](sqlClient) {
  val collection = Datastores

  def idColumn(x: Datastores): Rep[String] = x.name
  def isDeletedColumn(x: Datastores): Rep[Boolean] = x.isdeleted

  def parse(r: DatastoresRow): Fox[DataStore] =
    Fox.successful(DataStore(
      r.name,
      r.url,
      r.key,
      r.isdeleted,
      r.isforeign
    ))

  def findOneByKey(key: String)(implicit ctx: DBAccessContext): Fox[DataStore] =
    for {
      rOpt <- run(Datastores.filter(r => notdel(r) && r.key === key).result.headOption)
      r <- rOpt.toFox
      parsed <- parse(r)
    } yield {
      parsed
    }

  def findOneByName(name: String)(implicit ctx: DBAccessContext): Fox[DataStore] =
    for {
      rOpt <- run(Datastores.filter(r => notdel(r) && r.name === name).result.headOption)
      r <- rOpt.toFox
      parsed <- parse(r)
    } yield {
      parsed
    }

  def updateUrlByName(name: String, url: String)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val q = for {row <- Datastores if (notdel(row) && row.name === name)} yield row.url
    for {_ <- run(q.update(url))} yield ()
  }

  def insertOne(d: DataStore): Fox[Unit] = {
    for {
      _ <- run(sqlu"""insert into webknossos.dataStores(name, url, key, isDeleted, isForeign)
                         values(${d.name}, ${d.url}, ${d.key}, ${d.isDeleted}, ${d.isForeign})""")
    } yield ()
  }

}
