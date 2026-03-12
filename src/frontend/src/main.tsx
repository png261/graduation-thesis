import ReactDOM from "react-dom/client";
import { AuthenticateWithRedirectCallback, ClerkProvider } from "@clerk/clerk-react";

import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "react-complex-tree/lib/style-modern.css";
import "@xyflow/react/dist/style.css";
import "./styles.css";

import App from "./App";
import { AuthProvider } from "./contexts/AuthContext";

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || "";

// React.StrictMode is intentionally omitted: @assistant-ui/react 0.12.x
// does not survive StrictMode's double-unmount when the runtime provider
// is re-keyed (project switch), causing "Tried to unmount a fiber that is
// already unmounted" errors.
if (!clerkPublishableKey) {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <div style={{ padding: 24, fontFamily: "IBM Plex Sans, sans-serif" }}>
      Missing <code>VITE_CLERK_PUBLISHABLE_KEY</code> in frontend environment.
    </div>,
  );
} else {
  const normalizedPath = window.location.pathname.replace(/\/+$/, "") || "/";
  const isSsoCallback = normalizedPath === "/sso-callback";
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <ClerkProvider publishableKey={clerkPublishableKey}>
      {isSsoCallback ? (
        <AuthenticateWithRedirectCallback />
      ) : (
        <AuthProvider>
          <App />
        </AuthProvider>
      )}
    </ClerkProvider>,
  );
}
