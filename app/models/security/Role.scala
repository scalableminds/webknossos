package models.security

import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.annotations._
import com.novus.salat.dao.SalatDAO
import models.basics.BasicDAO
import models.Color
import play.api.Logger
import play.api.Play

case class Role( name: String, permissions: List[Permission], color: Color, _id: ObjectId = new ObjectId ) extends Implyable {
  def implies( permission: Permission ) =
    permissions.find( _.implies( permission ) ).isDefined
}

object Role extends BasicDAO[Role]( "roles" ) {

  lazy val EmptyRole = Role( "EMPTY", Nil, Color(0,0,0,0) )
  lazy val User = findOneByName( "user" )
  lazy val Admin = findOneByName( "admin" )

  def apply( roleName: String ): Option[Role] = {
    val r = findOneByName( roleName )
    if ( r.isEmpty ) {
      Logger.error( s"Requested Role doesn't exist in DB: $roleName" )
      Some(EmptyRole)
    } else {
      r
    }
  }
  
  def ensureImportantRoles() {
    if(User.isEmpty || Admin.isEmpty){
      Logger.error("Application is going to get shutdown, because not all required roles are present.")
      Play.stop()
    }
  }
  
  def colorOf(role: String) = {
    apply(role).map( _.color.toHtml) getOrElse "#000000"
  }

  def findOneByName( roleName: String ) =
    findOne( MongoDBObject( "name" -> roleName ) )
}