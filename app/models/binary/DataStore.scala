/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.binary

import java.util.UUID

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables.{Datastores, _}
import models.basics.SecuredBaseDAO
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.functional.syntax._
import play.api.libs.json.{Json, Writes, __}
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

object DataStoreDAO extends SecuredBaseDAO[DataStore] {
  val collectionName = "dataStores"

  val formatter = DataStore.dataStoreFormat

  def findByKey(key: String)(implicit ctx: DBAccessContext) =
    findOne("key", key)

  def updateUrl(name: String, url: String)(implicit ctx: DBAccessContext) =
    update(Json.obj("name" -> name), Json.obj("$set" -> Json.obj("url" -> url)))
}
