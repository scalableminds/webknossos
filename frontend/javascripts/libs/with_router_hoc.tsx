import type React from "react";
import { useLocation, useNavigate, useParams } from "react-router";

export type RouteComponentProps = {
  location: ReturnType<typeof useLocation>;
  navigate: ReturnType<typeof useNavigate>;
  params: ReturnType<typeof useParams>;
};

/**
 * A higher-order component (HOC) that injects React Router hooks
 * (`location`, `navigate`, and `params`) into class-based components
 * via props.
 *
 * React Router removed the withRouter HOC in v6. This is a workaround for class-based components.
 *
 * @param Component - The class or function component to wrap.
 * @returns A function component that passes router props to the wrapped component.
 */
export function withRouter<P extends RouteComponentProps>(Component: React.ComponentType<P>) {
  function ComponentWithRouterProp(props: Omit<P, keyof RouteComponentProps>) {
    const location = useLocation();
    const navigate = useNavigate();
    const params = useParams();

    return <Component {...(props as P)} navigate={navigate} location={location} params={params} />;
  }

  return ComponentWithRouterProp;
}
