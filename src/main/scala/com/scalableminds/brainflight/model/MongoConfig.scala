package com.scalableminds.brainflight.model

import net.liftweb._
import mongodb._
import com.mongodb.Mongo

/**
 * Created by IntelliJ IDEA.
 * User: lesnail
 * Date: 19.10.11
 * Time: 14:29
 * To change this template use File | Settings | File Templates.
 */

object UserDb extends MongoIdentifier{
  val jndiName = "user"
}

object MongoConfig {
  def init: Unit = {
    val myMongo = new Mongo("127.0.0.1", 27017)
    MongoDB.defineDb(DefaultMongoIdentifier, myMongo, "mydb")
  }
}