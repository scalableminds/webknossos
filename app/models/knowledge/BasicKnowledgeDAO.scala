package models.knowledge

import models.basics.BasicDAO
import com.mongodb.casbah.Imports._
import models.context.KnowledgeDB

class BasicKnowledgeDAO[T <: AnyRef](collectionName: String)(override implicit val m: Manifest[T])
  extends BasicDAO[T](collectionName, KnowledgeDB.connection)