import ReactDOM from "react-dom/client";

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
import { missingCognitoEnv } from "./contexts/cognitoAuth";

const missingEnv = missingCognitoEnv();

if (missingEnv.length > 0) {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <div style={{ padding: 24, fontFamily: "IBM Plex Sans, sans-serif" }}>
      Missing frontend Cognito environment: <code>{missingEnv.join(", ")}</code>.
    </div>,
  );
} else {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <AuthProvider>
      <App />
    </AuthProvider>,
  );
}
