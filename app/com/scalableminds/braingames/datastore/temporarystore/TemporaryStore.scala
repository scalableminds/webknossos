package com.scalableminds.braingames.datastore.temporarystore

import java.util.concurrent.ConcurrentHashMap

import scala.concurrent.duration.Duration

/**
  * Created by f on 17.08.17.
  */
object TemporaryStore {
  val map = new ConcurrentHashMap[String, Object]()

  def set(id: String, value: Object, timeout: Duration): Unit = {
    map.put(id, value)
    Unit
  }
  def getAs[T](id: String): Option[T] = {
    val element = map.get(id)
    if (element == null) None
    else Some(element.asInstanceOf[T])
  }

}
