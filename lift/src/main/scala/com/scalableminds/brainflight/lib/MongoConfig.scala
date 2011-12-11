package com.scalableminds.brainflight.lib

import net.liftweb._
import common.Full
import mongodb._
import com.mongodb.{MongoException, Mongo}
import util.Props
import java.util.Properties
import java.io.{PipedInputStream, PipedOutputStream, IOException}
import java.util.logging.LogManager
import net.liftweb.util.Helpers._

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
      MongoAddress(MongoHost(Props.get("mongo.host").getOrElse("127.0.0.1")), Props.get("mongo.dbname").getOrElse("mydb"))
    )
  }

  def setLogLevel(level: String) {
    val loggingProperties = new Properties()
    loggingProperties.put(".level", level)
    val pos = new PipedOutputStream()
    val pis = new PipedInputStream(pos)

    loggingProperties.store(pos, "")
    pos.close()
    LogManager.getLogManager().readConfiguration(pis)
    pis.close()
  }

  def running_? : Boolean = {
    def testDB = tryo(MongoDB.use(DefaultMongoIdentifier)(_.getLastError)) match {
      case Full(_) => true
      case _ => false
    }
    setLogLevel("OFF")
    val ret = testDB
    setLogLevel("ALL")
    ret
  }
}