package com.scalableminds.util.cache

import scala.jdk.CollectionConverters.SetHasAsScala

trait LRUConcurrentCache[K, V] {
  def maxEntries: Int

  private val cache = new java.util.LinkedHashMap[K, V]() {
    override def removeEldestEntry(eldest: java.util.Map.Entry[K, V]): Boolean =
      if (this.size > maxEntries) {
        onElementRemoval(eldest.getKey, eldest.getValue)
        true
      } else {
        false
      }
  }

  def onElementRemoval(key: K, value: V): Unit = {}

  def put(key: K, value: V): Unit =
    cache.synchronized {
      val previous = cache.put(key, value)
      if (previous != null)
        onElementRemoval(key, previous)
    }

  def get(key: K): Option[V] =
    cache.synchronized {
      Option(cache.get(key))
    }

  def getOrLoadAndPut(key: K)(loadFunction: K => V): V =
    get(key).getOrElse {
      val value = loadFunction(key)
      put(key, value)
      value
    }

  /** Use if load function returns Option and only Some should be cached
    */
  def getOrLoadAndPutOptional(key: K)(loadFunction: K => Option[V]): Option[V] =
    get(key).orElse {
      val valueOpt = loadFunction(key)
      valueOpt.foreach(put(key, _))
      valueOpt
    }

  def remove(key: K): Unit =
    cache.synchronized {
      val previous = cache.remove(key)
      if (previous != null)
        onElementRemoval(key, previous)
    }

  def size(): Int =
    cache.size()

  def clear(predicate: K => Boolean): Int =
    cache.synchronized {
      val matching = cache.keySet.asScala.filter(predicate)
      val size = matching.size
      matching.foreach(remove)
      size
    }

  def getOrHandleUncachedKey(key: K, handleUncachedKey: () => V): V =
    cache.synchronized {
      Option(cache.get(key)) match {
        case Some(value) => value
        case None        => handleUncachedKey()
      }
    }

  def clear(): Unit =
    cache.clear()
}
