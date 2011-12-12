package models

import com.mongodb.casbah.Imports._
import com.novus.salat.global._
import com.novus.salat.dao.SalatDAO
import play.api.Play
import play.api.Play.current

/**
 * scalableminds - brainflight
 * User: tmbo
 * Date: 11.12.11
 * Time: 12:35
 */
class BasicDAO[T <: com.novus.salat.CaseClass](collectionName:String)(implicit val m: Manifest[T])
  extends SalatDAO[T, ObjectId](collection = MongoConnection()(
    Play.configuration.getString("mongo.dbname").getOrElse("salat-dao"))(
    collectionName
  ))
