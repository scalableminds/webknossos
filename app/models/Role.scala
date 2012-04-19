package models

import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.annotations._
import com.novus.salat.dao.SalatDAO

case class Role( name: String, permissions: List[Permission], _id: ObjectId = new ObjectId ) extends Implyable {
  def implies( permission: Permission ) =
    permissions.find( _.implies( permission ) ).isDefined
}

object Role extends BasicDAO[Role]( "roles" ) {

  val EmptyRole = Role( "EMPTY", Nil )
  val User = findOneByName( "user" )
  val Admin = findOneByName( "Admin" )

  def apply( roleName: String ): Option[Role] = {
    val r = findOneByName( roleName )
    if ( r.isEmpty ) {
      log.error( "Requested Role doesn't exist in DB: " + roleName )
      Some(EmptyRole)
    } else {
      r
    }
  }

  def findOneByName( roleName: String ): Option[Role] =
    findOne( MongoDBObject( "name" -> roleName ) )
}