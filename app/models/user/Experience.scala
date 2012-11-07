package models.user

import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.annotations._
import com.novus.salat.dao.SalatDAO
import models.basics.BasicDAO

case class Experience(name: String ,value: Int)

object Experience extends BasicDAO[Experience]("experiences"){
  
}