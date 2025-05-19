import type { SceneControllerType } from "./scene_controller";
let sceneController: SceneControllerType | null | undefined = null;

export default function getSceneController(): SceneControllerType {
  if (!sceneController) {
    throw new Error("SceneController was not initialized yet");
  }

  return sceneController;
}

export function getSceneControllerOrNull(): SceneControllerType | null {
  return sceneController || null;
}

export function setSceneController(c: SceneControllerType): void {
  sceneController = c;
}

export function destroySceneController(): void {
  if (sceneController != null) {
    sceneController.destroy();
  }
  sceneController = null;
}
