package models

import com.mongodb.casbah.commons.Imports._
import com.novus.salat._
import com.mongodb.casbah.MongoConnection

package object context {
  object DB {
    lazy val connection = {
      import com.mongodb.casbah.commons.Imports._
      import com.mongodb.casbah.MongoConnection
      import play.api.Play
      import play.api.Play.current

      val conn = MongoConnection(
          Play.configuration.getString("mongo.url").getOrElse("localhost"), 
          Play.configuration.getInt("mongo.port").getOrElse(27017))(
              Play.configuration.getString("mongo.dbname").getOrElse("salat-dao"))
      for {
          dbuser <- Play.configuration.getString("mongo.user")
          dbpasswd <- Play.configuration.getString("mongo.password")
        } conn.authenticate(dbuser, dbpasswd)
      conn
    }
  }

  implicit val ctx = {
    import com.novus.salat._
    import play.api.Play
    import play.api.Play.current
    val c = new Context {
      val name = "play-salat-context"
    }
    c.registerClassLoader(Play.classloader)
    c
  }
}