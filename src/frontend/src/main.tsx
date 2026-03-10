import ReactDOM from "react-dom/client";

import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@xyflow/react/dist/style.css";
import "./styles.css";

import App from "./App";
import { AuthProvider } from "./contexts/AuthContext";

// React.StrictMode is intentionally omitted: @assistant-ui/react 0.12.x
// does not survive StrictMode's double-unmount when the runtime provider
// is re-keyed (project switch), causing "Tried to unmount a fiber that is
// already unmounted" errors.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <AuthProvider>
    <App />
  </AuthProvider>,
);
