import {Toaster} from 'sonner';
import {AppRouter} from './router';
import {useThemeStore} from './store/theme';

export default function App() {
  const resolvedTheme = useThemeStore(state => state.resolvedTheme);
  return (
    <>
      <AppRouter />
      <Toaster theme={resolvedTheme} position="top-center" richColors closeButton />
    </>
  );
}
