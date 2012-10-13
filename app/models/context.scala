package models

import com.mongodb.casbah.commons.Imports._
import com.novus.salat._
import com.mongodb.casbah.MongoConnection
import play.Configuration

package object context {
  object DB {
    lazy val connection = {
      import com.mongodb.casbah.commons.Imports._
      import com.mongodb.casbah.MongoConnection
      import play.api.Play
      import play.api.Play.current

      val conf = Play.configuration
      
      val url = conf.getString("mongo.url").getOrElse("127.0.0.1")
      val port = conf.getInt("mongo.port").getOrElse(27017)
      val dbName = conf.getString("mongo.dbname").getOrElse("salat-dao")
     
      val connection = MongoConnection( url, port )( dbName)
      
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
        
        override val typeHintStrategy = StringTypeHintStrategy(when = TypeHintFrequency.WhenNecessary,
            typeHint = "_typeHint")
    }
    c.registerClassLoader(Play.classloader)
    c
  }
}