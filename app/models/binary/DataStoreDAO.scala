/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.binary

import java.util.UUID

import com.scalableminds.util.reactivemongo.DBAccessContext
import models.basics.SecuredBaseDAO
import play.api.libs.functional.syntax._
import play.api.libs.json.{Json, Writes, __}

case class DataStoreStatus(
  ok: Boolean,
  url: String)

object DataStoreStatus{
  implicit val dataStoreStatusFormat = Json.format[DataStoreStatus]
}

case class DataStore(
  name: String,
  url: Option[String],
  typ: DataStoreType,
  key: String = UUID.randomUUID().toString)

case class DataStoreInfo(
  name: String,
  url: String,
  typ: DataStoreType,
  accessToken: Option[String])

object DataStoreInfo {
  implicit val dataStoreInfoFormat = Json.format[DataStoreInfo]
}

object DataStore {
  private[binary] val dataStoreFormat = Json.format[DataStore]

  def dataStorePublicWrites: Writes[DataStore] =
    ((__ \ "name").write[String] and
      (__ \ "url").write[Option[String]] and
      (__ \ "typ").write[DataStoreType]) (ds =>
      (ds.name, ds.url, ds.typ))
}

object DataStoreDAO extends SecuredBaseDAO[DataStore] {
  val collectionName = "dataStores"

  val formatter = DataStore.dataStoreFormat

  def findByKey(key: String)(implicit ctx: DBAccessContext) =
    findOne("key", key)

  def updateUrl(name: String, url: String)(implicit ctx: DBAccessContext) =
    update(Json.obj("name" -> name), Json.obj("$set" -> Json.obj("url" -> url)))
}
