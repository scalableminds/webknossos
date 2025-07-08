import type React from "react";
import { forwardRef, useState } from "react";
import { type Blocker, type BlockerFunction, useBlocker } from "react-router-dom";

export type WithBlockerProps = {
  setBlocking: ({ shouldBlock }: { shouldBlock: boolean | BlockerFunction }) => void;
  blocker: Blocker;
};

/**
 * Higher-Order Component that provides useBlocker functionality to class components
 *
 * @param WrappedComponent - The class component to enhance
 * @returns Enhanced component with blocker functionality
 */
export function withBlocker<TProps extends WithBlockerProps>(
  WrappedComponent: React.ComponentType<TProps>,
): React.ForwardRefExoticComponent<React.PropsWithoutRef<TProps> & React.RefAttributes<any>> {
  const WithBlockerComponent = forwardRef<any, TProps>((props, ref) => {
    // State to control blocking behavior
    const [shouldBlockState, setShouldBlockState] = useState<{
      shouldBlock: boolean | BlockerFunction;
    }>({
      shouldBlock: false,
    });

    // Use the useBlocker hook
    const blocker = useBlocker(shouldBlockState.shouldBlock);

    // Create props object with the blocker and control function
    const enhancedProps = {
      ...props,
      blocker,
      setBlocking: setShouldBlockState,
    } as TProps & WithBlockerProps;

    return <WrappedComponent {...enhancedProps} ref={ref} />;
  });

  return WithBlockerComponent;
}
