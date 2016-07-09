/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.binary

import play.api.data.validation.ValidationError
import play.api.libs.json._
import reactivemongo.bson.{BSONString, BSONHandler}

sealed trait DataStoreType {
  val name: String
}

case object WebKnossosStore extends DataStoreType{
  val name = "webknossos-store"
}

case object NDStore extends DataStoreType{
  val name = "ndstore"
}

object DataStoreType{
  def stringToType(s: String) = s match {
    case WebKnossosStore.name => WebKnossosStore
    case NDStore.name => NDStore
    case _ => throw new UnsupportedOperationException()
  }
}
