package models

import play.Configuration

package object context {
  import play.api.Play.current
  import play.api.Play
  object DB {
    lazy val connection = {
      import com.mongodb.casbah.commons.Imports._
      import com.novus.salat._
      import com.mongodb.casbah.MongoConnection
      import com.mongodb.casbah.commons.Imports._
      import com.mongodb.casbah.MongoConnection

      val conf = Play.configuration

      val url = conf.getString("mongo.url").getOrElse("127.0.0.1")
      val port = conf.getInt("mongo.port").getOrElse(27017)
      val dbName = conf.getString("mongo.dbname").getOrElse("play-oxalis")

      val connection = MongoConnection(url, port)(dbName)

      for {
        dbuser <- conf.getString("mongo.user")
        dbpasswd <- conf.getString("mongo.password")
      } connection.authenticate(dbuser, dbpasswd)
      connection
    }
  }

  implicit val ctx = {
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
    import reactivemongo.api.gridfs._
    import reactivemongo.bson.BSONDocument
    import reactivemongo.bson.BSONObjectID
    import reactivemongo.bson._
    import reactivemongo.bson.handlers.DefaultBSONHandlers._
    import play.api.libs.concurrent.execution.defaultContext
    
    val conf = Play.configuration
    val dbName = conf.getString("mongo.binary.dbname").getOrElse("binaryData")

    lazy val connection = MongoConnection(List("localhost:27017"))
    // a GridFS store named 'attachments'

    val db = connection(dbName)
  }
}