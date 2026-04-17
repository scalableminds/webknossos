/**
 * Context for triggering the GenerateBoundingBoxesModal from within the AiJobsDrawer
 * component tree.
 *
 * Background: The AiJobsDrawer uses `destroyOnHidden`, which unmounts all its children
 * when the drawer closes. To allow the GenerateBoundingBoxesModal to remain visible after
 * the drawer is dismissed, the modal is rendered at the AiJobsDrawer level — outside the
 * <Drawer> element itself. This context provides a stable `openGenerateBBModal` callback that
 * deep children (e.g. AiTrainingDataSelector) can call to:
 *   1. Close the drawer.
 *   2. Open the modal with the relevant magnification and job type.
 *
 * Usage:
 *   - The context is provided by AiJobsDrawer via <GenerateBBModalContext.Provider>.
 *   - Consume it in any child component with `useGenerateBBModalContext()`.
 *
 * @example
 *   const { openGenerateBBModal } = useGenerateBBModalContext();
 *   openGenerateBBModal(magnification, selectedJobType);
 */

import { createContext, useContext } from "react";
import type { APIJobCommand } from "types/api_types";
import type { Vector3 } from "viewer/constants";

export type GenerateBBModalState = {
  isOpen: boolean;
  magnification: Vector3 | null;
  jobType: APIJobCommand | null;
};

type GenerateBBModalContextType = {
  /**
   * Closes the AI jobs drawer and opens the GenerateBoundingBoxesModal with the
   * given magnification and job type pre-filled.
   *
   * Pass `null` for magnification to default to the finest available mag.
   * Pass `null` for jobType to use the modal's default training type.
   */
  openGenerateBBModal: (magnification: Vector3 | null, jobType: APIJobCommand | null) => void;
};

export const GenerateBBModalContext = createContext<GenerateBBModalContextType | undefined>(
  undefined,
);

/**
 * Returns the `openGenerateBBModal` callback from the nearest GenerateBBModalContext provider.
 * Must be used inside the AiJobsDrawer component tree.
 */
export const useGenerateBBModalContext = () => {
  const ctx = useContext(GenerateBBModalContext);
  if (ctx === undefined) {
    throw new Error("useGenerateBBModalContext must be used within AiJobsDrawer");
  }
  return ctx;
};
