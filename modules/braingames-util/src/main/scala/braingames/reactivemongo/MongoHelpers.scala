package braingames.reactivemongo

import play.api.libs.json._
import play.api.libs.json.Json._
import reactivemongo.bson.BSONObjectID
import play.api.libs.functional.syntax._
import play.api.libs.json.Reads._

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 10.06.13
 * Time: 01:59
 */

trait MongoHelpers {
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
}