import type { SceneControllerType } from "./scene_controller";

let sceneController: SceneControllerType | null | undefined = null;
// Tracks the in-flight destroy() of the previously active SceneController, so that
// initializeSceneController() can wait for it to fully finish (including its own wait
// for a pending shader compile) before a new SceneController starts reusing the shared
// WebGLRenderer. See SceneController.destroy() for why this matters.
let pendingTeardown: Promise<void> | null = null;

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
    const teardown = sceneController.destroy();
    pendingTeardown = teardown.finally(() => {
      if (pendingTeardown === teardown) {
        pendingTeardown = null;
      }
    });
  }
  sceneController = null;
}

export async function waitForPendingSceneControllerTeardown(): Promise<void> {
  if (pendingTeardown != null) {
    await pendingTeardown;
  }
}
