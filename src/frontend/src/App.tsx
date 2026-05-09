import { BrowserRouter } from "react-router-dom"
import { AuthProvider } from "@/components/auth/AuthProvider"
import AppRoutes from "./routes"

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
