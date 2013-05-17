package models

import play.Configuration
import com.typesafe.config.ConfigFactory
import play.api.libs.concurrent.Execution.Implicits._

package object context {
  val conf = ConfigFactory.load()
  lazy val db = {
    import com.mongodb.casbah.commons.Imports._
    import com.mongodb.casbah.MongoConnection

    val url = conf.getString("mongo.url")
    val port = conf.getInt("mongo.port")

    MongoConnection(url, port)
  }

  private def createConnection(dbName: String) = {
    import com.mongodb.casbah.commons.Imports._

    val connection = db(dbName)
    val needsAuth = conf.getBoolean("mongo.needsAuth")
    if (needsAuth) {
      val dbuser = conf.getString("mongo.user")
      val dbpasswd = conf.getString("mongo.password")
      connection.authenticate(dbuser, dbpasswd)
    }
    connection
  }

  object DB {
    lazy val connection = createConnection(
      conf.getString("mongo.dbname"))

  }

  object KnowledgeDB {
    lazy val connection =
      createConnection(
        conf.getString("mongo.knowledgedb.dbname"))
  }

  implicit lazy val ctx = {
    import com.novus.salat._
    import play.api.Play
    import play.api.Play.current
    val c = new Context {
      val name = "play-salat-context"

      override val typeHintStrategy = StringTypeHintStrategy(when = TypeHintFrequency.Always,
        typeHint = "_typeHint")
    }
    c.registerClassLoader(Play.classloader)
    c
  }

  object BinaryDB {
    import reactivemongo.api._
    import reactivemongo.api.MongoDriver
    import reactivemongo.api.gridfs._
    import reactivemongo.bson.BSONDocument
    import reactivemongo.bson.BSONObjectID
    import reactivemongo.bson._

    val dbName = conf.getString("mongo.binary.dbname")
    
    lazy val driver = new MongoDriver

    lazy val connection = driver.connection(List("localhost:27017"))
    // a GridFS store named 'attachments'

    val db = connection(dbName)
  }
}