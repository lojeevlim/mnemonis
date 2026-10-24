import { BrowserRouter } from "react-router-dom";
import { ThemeProvider } from "lojee-ui";
import { ToastProvider } from "../components/ToastProvider";
import { AuthContextProvider } from "../features/auth/AuthContext";
import { ErrorBoundary } from "./ErrorBoundary";
import { AppRoutes } from "./router";

export function App() {
  return (
    <ThemeProvider mode="light" accent="#000000">
      <ErrorBoundary>
        <ToastProvider>
          <AuthContextProvider>
            <BrowserRouter>
              <AppRoutes />
            </BrowserRouter>
          </AuthContextProvider>
        </ToastProvider>
      </ErrorBoundary>
    </ThemeProvider>
  );
}
