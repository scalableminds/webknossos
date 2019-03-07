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
    isScratch: Boolean = false,
    isDeleted: Boolean = false,
    isForeign: Boolean = false
)

class DataStoreService @Inject()(dataStoreDAO: DataStoreDAO)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with Results {

  def publicWrites(dataStore: DataStore): Fox[JsObject] =
    Fox.successful(
      Json.obj(
        "name" -> dataStore.name,
        "url" -> dataStore.url,
        "isForeign" -> dataStore.isForeign,
        "isScratch" -> dataStore.isScratch
      ))

  def validateAccess[A](name: String)(block: (DataStore) => Future[Result])(implicit request: Request[A],
                                                                            m: MessagesProvider): Fox[Result] =
    (for {
      dataStore <- dataStoreDAO.findOneByName(name)(GlobalAccessContext)
      key <- request.getQueryString("key").toFox
      _ <- bool2Fox(key == dataStore.key)
      result <- block(dataStore)
    } yield result).getOrElse(Forbidden(Messages("dataStore.notFound")))

}

class DataStoreDAO @Inject()(sqlClient: SQLClient)(implicit ec: ExecutionContext)
    extends SQLDAO[DataStore, DatastoresRow, Datastores](sqlClient) {
  val collection = Datastores

  def idColumn(x: Datastores): Rep[String] = x.name
  def isDeletedColumn(x: Datastores): Rep[Boolean] = x.isdeleted

  def parse(r: DatastoresRow): Fox[DataStore] =
    Fox.successful(
      DataStore(
        r.name,
        r.url,
        r.key,
        r.isscratch,
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

  override def findAll(implicit ctx: DBAccessContext): Fox[List[DataStore]] =
    for {
      r <- run(sql"select #${columns} from webknossos.datastores_ order by name".as[DatastoresRow])
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed

  def updateUrlByName(name: String, url: String)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val q = for { row <- Datastores if notdel(row) && row.name === name } yield row.url
    for { _ <- run(q.update(url)) } yield ()
  }

  def insertOne(d: DataStore): Fox[Unit] =
    for {
      _ <- run(sqlu"""insert into webknossos.dataStores(name, url, key, isScratch, isDeleted, isForeign)
                             values(${d.name}, ${d.url}, ${d.key}, ${d.isScratch}, ${d.isDeleted}, ${d.isForeign})""")
    } yield ()

}
