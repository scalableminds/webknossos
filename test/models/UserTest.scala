package models

import org.specs2.mutable._
import play.api.test._
import play.api.test.Helpers._
import com.mongodb.casbah.Imports._
import models._

class UserTest extends Specification{
  
  val mail = "testuser@example.org"
  val name = "testuser"
  val pw   = "passwd"
    
  "User" should {
    
    "create local User" in {
      running(FakeApplication()){
        val testuser = User.create(mail,name,pw)
        
        testuser.verified must beFalse
        User.findLocalByEmail(testuser.email) must beSome
        User.auth(mail,pw) must beAnInstanceOf[Some[User]]
      }
    }
  }
}