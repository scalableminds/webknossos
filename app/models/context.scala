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
          Play.configuration.getString("mongodb.url").getOrElse("localhost"), 
          Play.configuration.getInt("mongodb.port").getOrElse(27017))(
              Play.configuration.getString("mongodb.dbname").getOrElse("salat-dao"))
      for {
          dbuser <- Play.configuration.getString("mongodb.user")
          dbpasswd <- Play.configuration.getString("mongodb.password")
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