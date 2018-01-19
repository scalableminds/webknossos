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

import scala.concurrent.{ExecutionContext, Future}
import scala.util.Success

trait MongoHelpers extends LazyLogging {
  /** Writes an ID in Json Extended Notation */
  val toObjectId =
    OWrites[String] {
      s => Json.obj("_id" -> Json.obj("$oid" -> s))
    }

  val beautifyObjectId =
    (__).json.update((__ \ 'id).json.copyFrom((__ \ '_id \ '$oid).json.pick)) andThen (__ \ '_id).json.prune

  val fromCreated =
    __.json.update((__ \ 'created).json.copyFrom((__ \ 'created \ '$date).json.pick))

  /** Generates a new ID and adds it to your JSON using Json extended notation for BSON */
  val generateId =
    (__ \ '_id \ '$oid).json.put(JsString(BSONObjectID.generate.stringify))

  /** Generates a new date and adds it to your JSON using Json extended notation for BSON */
  val generateCreated =
    (__ \ 'created \ '$date).json.put(JsNumber((new java.util.Date).getTime))

  /** Updates Json by adding both ID and date */
  val addMongoIdAndDate: Reads[JsObject] =
    __.json.update((generateId and generateCreated).reduce)

  /** Converts JSON into Mongo update selector by just copying whole object in $set field */
  val toMongoUpdate =
    (__ \ '$set).json.copyFrom(__.json.pick)

  val removeId =
    (__ \ '_id).json.prune


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
