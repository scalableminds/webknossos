/*
 * Copyright (C) Tom Bocklisch <https://github.com/tmbo>
 */
package com.scalableminds.util.cache

trait LRUConcurrentCache[K, V] {
  def maxEntries: Int

  private val cache = new java.util.LinkedHashMap[K, V]() {
    override def removeEldestEntry(eldest: java.util.Map.Entry[K, V]): Boolean = {
      if(size > maxEntries){
        onElementRemoval(eldest.getKey, eldest.getValue)
        true
      } else {
        false
      }
    }
  }

  def onElementRemoval(key: K, value: V): Unit = {}

  def put(key: K, value: V): Unit =  {
    cache.synchronized {
      val previous = cache.put(key, value)
      if(previous != null)
        onElementRemoval(key, previous)
    }
  }

  def get(key: K): Option[V] = {
    cache.synchronized {
      Option(cache.get(key))
    }
  }

  def remove(key: K): Unit = {
    cache.synchronized {
      val previous = cache.remove(key)
      if(previous != null)
        onElementRemoval(key, previous)
    }
  }

  def size(): Int = {
    cache.size()
  }

  def clear(): Unit = {
    cache.clear()
  }
}
