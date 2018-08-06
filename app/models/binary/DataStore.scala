package models.binary

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.{JsObject, Json}
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import utils.SQLDAO


case class DataStore(
                       name: String,
                       url: String,
                       typ: DataStoreType,
                       key: String,
                       isDeleted: Boolean = false
                       ) {

  def publicWrites: Fox[JsObject] = {
    Fox.successful(Json.obj(
      "name" -> name,
      "url" -> url,
      "typ" -> typ.name
    ))
  }
}


case class DataStoreInfo(
                          name: String,
                          url: String,
                          typ: DataStoreType,
                          accessToken: Option[String] = None)

object DataStoreInfo {
  implicit val dataStoreInfoFormat = Json.format[DataStoreInfo]
}


object DataStoreDAO extends SQLDAO[DataStore, DatastoresRow, Datastores] {
  val collection = Datastores

  def idColumn(x: Datastores): Rep[String] = x.name
  def isDeletedColumn(x: Datastores): Rep[Boolean] = x.isdeleted

  def parse(r: DatastoresRow): Fox[DataStore] =
    Fox.successful(DataStore(
      r.name,
      r.url,
      DataStoreType.stringToType(r.typ),
      r.key,
      r.isdeleted
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
      _ <- run(sqlu"""insert into webknossos.dataStores(name, url, key, typ, isDeleted)
                         values(${d.name}, ${d.url}, ${d.key}, '#${d.typ.name}', ${d.isDeleted})""")
    } yield ()
  }

}
