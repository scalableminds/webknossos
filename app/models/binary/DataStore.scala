package models.binary

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.schema.Tables._
import javax.inject.Inject
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.json.{Format, JsObject, Json}
import play.api.mvc.{Request, Result, Results, WrappedRequest}
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import utils.{SQLClient, SQLDAO}

import scala.concurrent.{ExecutionContext, Future}

case class DataStore(
    name: String,
    url: String,
    publicUrl: String,
    key: String,
    isScratch: Boolean = false,
    isDeleted: Boolean = false,
    isForeign: Boolean = false,
    isConnector: Boolean = false,
    allowsUpload: Boolean = true,
)

object DataStore {
  implicit val dataStoreFormat: Format[DataStore] = Json.format[DataStore]

  def fromForm(name: String,
               url: String,
               publicUrl: String,
               key: String,
               isScratch: Option[Boolean],
               isForeign: Option[Boolean],
               isConnector: Option[Boolean],
               allowsUpload: Option[Boolean]) =
    DataStore(
      name,
      url,
      publicUrl,
      key,
      isScratch.getOrElse(false),
      isDeleted = false,
      isForeign.getOrElse(false),
      isConnector.getOrElse(false),
      allowsUpload.getOrElse(true)
    )

  def fromUpdateForm(name: String,
                     url: String,
                     publicUrl: String,
                     isScratch: Option[Boolean],
                     isForeign: Option[Boolean],
                     isConnector: Option[Boolean],
                     allowsUpload: Option[Boolean]): DataStore =
    fromForm(name, url, publicUrl, "", isScratch, isForeign, isConnector, allowsUpload)
}

class DataStoreService @Inject()(dataStoreDAO: DataStoreDAO)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with Results {

  def publicWrites(dataStore: DataStore): Fox[JsObject] =
    Fox.successful(
      Json.obj(
        "name" -> dataStore.name,
        "url" -> dataStore.publicUrl,
        "isForeign" -> dataStore.isForeign,
        "isScratch" -> dataStore.isScratch,
        "isConnector" -> dataStore.isConnector,
        "allowsUpload" -> dataStore.allowsUpload
      ))

  def validateAccess[A](name: String)(block: DataStore => Future[Result])(implicit request: Request[A],
                                                                          m: MessagesProvider): Fox[Result] =
    (for {
      dataStore <- dataStoreDAO.findOneByName(name)(GlobalAccessContext)
      key <- request.getQueryString("key").toFox
      _ <- bool2Fox(key == dataStore.key)
      result <- block(dataStore)
    } yield result).getOrElse(Forbidden(Json.obj("granted" -> false, "msg" -> Messages("dataStore.notFound"))))

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
        r.publicurl,
        r.key,
        r.isscratch,
        r.isdeleted,
        r.isforeign,
        r.isconnector,
        r.allowsupload
      ))

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
      _ <- run(
        sqlu"""insert into webknossos.dataStores(name, url, publicUrl, key, isScratch, isDeleted, isForeign, isConnector, allowsUpload)
                             values(${d.name}, ${d.url}, ${d.publicUrl},  ${d.key}, ${d.isScratch}, ${d.isDeleted}, ${d.isForeign}, ${d.isConnector}, ${d.allowsUpload})""")
    } yield ()

  def deleteOneByName(name: String) =
    for {
      _ <- run(sqlu"""update webknossos.dataStores set isDeleted = true where name = $name""")
    } yield ()

  def updateOne(d: DataStore) =
    for {
      _ <- run(
        sqlu""" update webknossos.dataStores set url = ${d.url}, publicUrl = ${d.publicUrl}, isScratch = ${d.isScratch}, isForeign = ${d.isForeign}, isConnector = ${d.isConnector}, allowsUpload = ${d.allowsUpload} where name = ${d.name}""")
    } yield ()

}
