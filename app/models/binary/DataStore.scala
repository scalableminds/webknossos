/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.binary

import java.util.UUID

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables.{Datastores, _}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.functional.syntax._
import play.api.libs.json.{Json, Writes, __}
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import utils.SQLDAO


case class DataStoreSQL(
                       name: String,
                       url: String,
                       typ: DataStoreType,
                       key: String,
                       isDeleted: Boolean = false
                       )


object DataStoreSQLDAO extends SQLDAO[DataStoreSQL, DatastoresRow, Datastores] {
  val collection = Datastores

  def idColumn(x: Datastores): Rep[String] = x.name
  def isDeletedColumn(x: Datastores): Rep[Boolean] = x.isdeleted

  def parse(r: DatastoresRow): Fox[DataStoreSQL] =
    Fox.successful(DataStoreSQL(
      r.name,
      r.url,
      DataStoreType.stringToType(r.typ),
      r.key,
      r.isdeleted
    ))

  def findOneByKey(key: String)(implicit ctx: DBAccessContext): Fox[DataStoreSQL] =
    for {
      rOpt <- run(Datastores.filter(r => notdel(r) && r.key === key).result.headOption)
      r <- rOpt.toFox
      parsed <- parse(r)
    } yield {
      parsed
    }

  def findOneByName(name: String)(implicit ctx: DBAccessContext): Fox[DataStoreSQL] =
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

  def insertOne(d: DataStoreSQL): Fox[Unit] = {
    for {
      _ <- run(sqlu"""insert into webknossos.dataStores(name, url, key, typ, isDeleted)
                         values(${d.name}, ${d.url}, ${d.key}, '#${d.typ.name}', ${d.isDeleted})""")
    } yield ()
  }

}

object DataStoreSQL {
  def fromDataStore(d: DataStore) =
    Fox.successful(DataStoreSQL(d.name, d.url, d.typ, d.key, false))
}



case class DataStore(
  name: String,
  url: String,
  typ: DataStoreType,
  key: String = UUID.randomUUID().toString)

case class DataStoreInfo(
  name: String,
  url: String,
  typ: DataStoreType,
  accessToken: Option[String] = None)

object DataStoreInfo {
  implicit val dataStoreInfoFormat = Json.format[DataStoreInfo]
}

object DataStore {
  private[binary] val dataStoreFormat = Json.format[DataStore]

  def dataStorePublicWrites: Writes[DataStore] =
    ((__ \ "name").write[String] and
      (__ \ "url").write[String] and
      (__ \ "typ").write[DataStoreType]) (ds =>
      (ds.name, ds.url, ds.typ))

  def fromDataStoreSQL(s: DataStoreSQL): Fox[DataStore] = {
    Fox.successful(DataStore(
      s.name,
      s.url,
      s.typ,
      s.key
    ))
  }
}

object DataStoreDAO {

  def findOneByKey(key: String)(implicit ctx: DBAccessContext) =
    for {
      dataStoreSQL <- DataStoreSQLDAO.findOneByKey(key)
      dataStore <- DataStore.fromDataStoreSQL(dataStoreSQL)
    } yield dataStore

  def findOneByName(name: String)(implicit ctx: DBAccessContext) =
    for {
      dataStoreSQL <- DataStoreSQLDAO.findOneByName(name)
      dataStore <- DataStore.fromDataStoreSQL(dataStoreSQL)
    } yield dataStore

  def findAll(implicit ctx: DBAccessContext): Fox[List[DataStore]] =
    for {
      dataStoresSQL <- DataStoreSQLDAO.findAll
      dataStores <- Fox.combined(dataStoresSQL.map(DataStore.fromDataStoreSQL(_)))
    } yield dataStores

  def updateUrl(name: String, url: String)(implicit ctx: DBAccessContext) =
    DataStoreSQLDAO.updateUrlByName(name, url)

  def insert(dataStore: DataStore)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      dataStoreSQL <- DataStoreSQL.fromDataStore(dataStore)
      _ <- DataStoreSQLDAO.insertOne(dataStoreSQL)
    } yield ()

}
