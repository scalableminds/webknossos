package models.binary

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.schema.Tables._
import javax.inject.Inject
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.json.{Format, JsObject, Json}
import play.api.mvc.{Request, Result, Results}
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import utils.{ObjectId, SQLClient, SQLDAO}

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
    onlyAllowedOrganization: Option[ObjectId] = None,
    jobsEnabled: Boolean = false
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
               allowsUpload: Option[Boolean]): DataStore =
    DataStore(
      name,
      url,
      publicUrl,
      key,
      isScratch.getOrElse(false),
      isDeleted = false,
      isForeign.getOrElse(false),
      isConnector.getOrElse(false),
      allowsUpload.getOrElse(true),
      None
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

  override def readAccessQ(requestingUserId: ObjectId): String =
    s"(onlyAllowedOrganization is null) OR (onlyAllowedOrganization in (select _organization from webknossos.users_ where _id = '$requestingUserId'))"

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
        r.allowsupload,
        r.onlyallowedorganization.map(ObjectId(_)),
        r.jobsenabled
      ))

  def findOneByName(name: String)(implicit ctx: DBAccessContext): Fox[DataStore] =
    for {
      accessQuery <- readAccessQuery
      r <- run(sql"select #$columns from webknossos.datastores_ where name = $name and #$accessQuery".as[DatastoresRow])
      parsed <- parseFirst(r, name)
    } yield parsed

  def findOneByUrl(url: String)(implicit ctx: DBAccessContext): Fox[DataStore] =
    for {
      accessQuery <- readAccessQuery
      r <- run(sql"select #$columns from webknossos.datastores_ where url = $url and #$accessQuery".as[DatastoresRow])
      parsed <- parseFirst(r, url)
    } yield parsed

  override def findAll(implicit ctx: DBAccessContext): Fox[List[DataStore]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(sql"select #$columns from webknossos.datastores_ where #$accessQuery order by name".as[DatastoresRow])
      parsed <- parseAll(r)
    } yield parsed

  def updateUrlByName(name: String, url: String): Fox[Unit] = {
    val q = for { row <- Datastores if notdel(row) && row.name === name } yield row.url
    for { _ <- run(q.update(url)) } yield ()
  }

  def insertOne(d: DataStore): Fox[Unit] =
    for {
      _ <- run(
        sqlu"""insert into webknossos.dataStores(name, url, publicUrl, key, isScratch, isDeleted, isForeign, isConnector, allowsUpload, jobsEnabled)
                             values(${d.name}, ${d.url}, ${d.publicUrl},  ${d.key}, ${d.isScratch}, ${d.isDeleted}, ${d.isForeign}, ${d.isConnector}, ${d.allowsUpload}, ${d.jobsEnabled})""")
    } yield ()

  def deleteOneByName(name: String): Fox[Unit] =
    for {
      _ <- run(sqlu"""update webknossos.dataStores set isDeleted = true where name = $name""")
    } yield ()

  def updateOne(d: DataStore): Fox[Unit] =
    for {
      _ <- run(
        sqlu""" update webknossos.dataStores set url = ${d.url}, publicUrl = ${d.publicUrl}, isScratch = ${d.isScratch}, isForeign = ${d.isForeign}, isConnector = ${d.isConnector}, allowsUpload = ${d.allowsUpload} where name = ${d.name}""")
    } yield ()

}
