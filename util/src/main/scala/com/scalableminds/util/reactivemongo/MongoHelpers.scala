/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.reactivemongo

import com.scalableminds.util.tools.Fox
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Failure
import play.api.data.validation.ValidationError
import play.api.libs.functional.syntax._
import play.api.libs.json.Json._
import play.api.libs.json.Reads._
import play.api.libs.json._
import reactivemongo.bson.BSONObjectID

import scala.concurrent.ExecutionContext.Implicits._
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Success

object MongoHelpers extends MongoHelpers

trait MongoHelpers extends LazyLogging {
    /** Generates a new ID and adds it to your JSON using Json extended notation for BSON */
  val generateId =
    (__ \ '_id \ '$oid).json.put(JsString(BSONObjectID.generate.stringify))

  /** Generates a new date and adds it to your JSON using Json extended notation for BSON */
  val generateCreated =
    (__ \ 'created \ '$date).json.put(JsNumber((new java.util.Date).getTime))

  def parseBsonToFox(s: String): Fox[BSONObjectID] =
    BSONObjectID.parse(s) match {
      case Success(id) => Fox.successful(id)
      case _ => Fox.failure(s"Failed to parse objectId: $s")
    }

  def withId[T](id: String)(f: BSONObjectID => Fox[T])(implicit ex: ExecutionContext): Fox[T] = {
    BSONObjectID.parse(id) match {
      case Success(bid) =>
        f(bid)
      case _ =>
        logger.warn(s"Failed to parse objectId: $id")
        Fox.apply(Future.successful(Failure(s"Failed to parse objectId $id")))
    }
  }
}
