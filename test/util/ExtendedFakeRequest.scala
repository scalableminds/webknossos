package util

import brainflight.security.Secured
import models.User
import play.api.test.FakeRequest
import models.Role
<<<<<<< HEAD
import models.security.Permission
=======
import models.Permission
>>>>>>> dev

object ExtendedFakeRequest {
  implicit def FakeRequest2ExtendedFakeRequest[T]( f: FakeRequest[T] ) = new ExtendedFakeRequest[T]( f )
}

class ExtendedFakeRequest[T]( f: FakeRequest[T] ) {

  def testUser( roleName: String, permission: Option[Permission] = None ) =
    User.findOneByEmail( "TEST" ) match {
      case Some( user ) =>
        User.save( user.copy( roles = List( roleName ), permissions = permission.toList ))
        user
      case _ =>
        val user = 
            User( "TEST", "testuser", true, "", "test", roles = List( roleName ), permissions = permission.toList )
        User.save( user )
        user
    }

  def authenticated( role: String = "user", permission: Option[Permission] = None ) =
    f.withSession( Secured.createSession( testUser( role, permission ) ) )

}