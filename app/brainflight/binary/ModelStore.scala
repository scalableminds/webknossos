package brainflight.binary

import collection.mutable.HashMap

/**
 * Scalable Minds - Brainflight
 * User: tmbo
 * Date: 10/11/11
 * Time: 7:59 AM
 */

object ModelStore {
  val models = new HashMap[String,DataModel]

  def apply(id:String):Option[DataModel] = {
    models.get(id)
  }
  def register(models: DataModel*){
    models foreach(x => register(x.id,x))
  }
  def register(id:String, model: DataModel){
    models += ((id,model))
  }
}