/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.binary

import models.basics.SecuredBaseDAO
import play.api.libs.json.Json
import java.util.UUID
import com.scalableminds.util.reactivemongo.DBAccessContext

case class DataStore(name: String, key: String = UUID.randomUUID().toString, typ: DataStoreType)

case class DataStoreInfo(name: String, url: String, typ: DataStoreType, accessToken: Option[String])

object DataStoreInfo{
  implicit val dataStoreInfoFormat = Json.format[DataStoreInfo]
}

object DataStore{
  implicit val dataStoreFormat = Json.format[DataStore]
}

object DataStoreDAO extends SecuredBaseDAO[DataStore] {
  val collectionName = "dataStores"

  val formatter = DataStore.dataStoreFormat

  def findByKey(key: String)(implicit ctx: DBAccessContext) =
    findOne("key", key)
}
