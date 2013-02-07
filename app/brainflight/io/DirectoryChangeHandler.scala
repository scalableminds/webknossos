package brainflight.io

import name.pachler.nio.file.Path

trait DirectoryChangeHandler {
  def onCreate(path: Path)
  def onDelete(path: Path)
  def onStart(path: Path)
  def onTick(path: Path)
}