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

object MongoConfig {
  def init: Unit = {
    MongoDB.defineDb(
      DefaultMongoIdentifier,
      MongoAddress(MongoHost("127.0.0.1"), "mydb")
    )
  }

  def isMongoRunning: Boolean = {
    try {
      MongoDB.use(DefaultMongoIdentifier) ( db => { db.getLastError } )
      true
    }
    catch {
      case e => false
    }
  }
}