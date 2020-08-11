package com.scalableminds.util.cache

import scala.collection.JavaConverters._

trait LRUConcurrentCache[K, V] {
  def maxEntries: Int

  private val cache = new java.util.LinkedHashMap[K, V]() {
    override def removeEldestEntry(eldest: java.util.Map.Entry[K, V]): Boolean =
      if (size > maxEntries) {
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
