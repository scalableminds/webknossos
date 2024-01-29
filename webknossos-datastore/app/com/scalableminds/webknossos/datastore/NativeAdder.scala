package com.scalableminds.webknossos.datastore

import com.github.sbt.jni.nativeLoader

@nativeLoader("webknossosNative0")
class NativeAdder(val base: Int) {
  @native def plus(term: Int): Int
}
