import {useAuthStore} from '@luhanxin/core';
import {useEffect} from 'react';
import {createBrowserRouter, RouterProvider} from 'react-router-dom';
import {buildRoutes} from './build-routes';
import {syncDocumentTitle} from './document-title';
import {routes} from './routes';

const browserRouter = createBrowserRouter(buildRoutes(routes));
syncDocumentTitle(browserRouter);

export function AppRouter() {
  useEffect(() => {
    void useAuthStore.getState().initAuth();
  }, []);

  return <RouterProvider router={browserRouter} />;
}
