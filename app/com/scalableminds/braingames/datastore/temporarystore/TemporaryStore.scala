package com.scalableminds.braingames.datastore.temporarystore

import java.util.concurrent.ConcurrentHashMap
import akka.pattern.after
import play.api.libs.concurrent.Akka
import play.api.Play.current

import scala.concurrent.{ExecutionContext, Future}
import scala.concurrent.duration._

/**
  * Created by f on 17.08.17.
  */
object TemporaryStore {
  val map = new ConcurrentHashMap[String, Object]()

  def set(id: String, value: Object, timeout: FiniteDuration)(implicit ctx: ExecutionContext): Unit = {
    map.put(id, value)

    after(timeout, Akka.system.scheduler)(Future.successful {
      map.remove(id)
    })
  }

  def getAs[T](id: String): Option[T] = {
    val element = map.get(id)
    if (element == null) None
    else Some(element.asInstanceOf[T])
  }
}
