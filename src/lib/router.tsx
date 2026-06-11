import React, { createContext, useContext, useState } from 'react';

export type Route = '/' | '/workspaces' | '/settings';

type RouterContextType = {
  route: Route;
  navigate: (r: Route) => void;
};

const RouterContext = createContext<RouterContextType>({
  route: '/',
  navigate: () => {},
});

export function RouterProvider({ children }: { children: React.ReactNode }) {
  const [route, setRoute] = useState<Route>('/');
  return (
    <RouterContext.Provider value={{ route, navigate: setRoute }}>
      {children}
    </RouterContext.Provider>
  );
}

export function useRouter() {
  return useContext(RouterContext);
}

type LinkProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: Route;
};

export function Link({ href, onClick, children, ...props }: LinkProps) {
  const { navigate } = useRouter();
  return (
    <a
      href="#"
      onClick={(e) => {
        e.preventDefault();
        navigate(href);
        (onClick as React.MouseEventHandler<HTMLAnchorElement>)?.(e);
      }}
      {...props}
    >
      {children}
    </a>
  );
}
