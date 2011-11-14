package net.liftmodules.mongoauth
package field

import net.liftweb._
import common._
import mongodb.record.field.MongoListField
import mongodb.record.BsonRecord

import com.mongodb._

class PermissionListField[OwnerType <: BsonRecord[OwnerType]](rec: OwnerType)
  extends MongoListField[OwnerType, Permission](rec)
{
  import scala.collection.JavaConversions._

  override def asDBObject: DBObject = {
    val dbl = new BasicDBList
    value.foreach { v => dbl.add(v.toString) }
    dbl
  }

  override def setFromDBObject(dbo: DBObject): Box[List[Permission]] =
    setBox(Full(dbo.keySet.toList.map(k => {
      Permission.fromString(dbo.get(k.toString).asInstanceOf[String])
    })))
}
