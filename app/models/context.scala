package models

import com.typesafe.config.ConfigFactory
import play.api.libs.concurrent.Execution.Implicits._

package object context {
  val conf = ConfigFactory.load()

  object BinaryDB {
    import reactivemongo.api._
    import reactivemongo.api.MongoDriver
    import reactivemongo.api.gridfs._
    import reactivemongo.bson.BSONDocument
    import reactivemongo.bson.BSONObjectID
    import reactivemongo.bson._

    val dbName = conf.getString("mongodb.binary.dbname")
    
    lazy val driver = new MongoDriver

    lazy val connection = driver.connection(List("localhost:27017"))
    // a GridFS store named 'attachments'

    val db = connection(dbName)
  }
}