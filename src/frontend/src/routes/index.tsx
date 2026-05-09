import { Routes, Route } from "react-router-dom"
import ChatPage from "./ChatPage"

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<ChatPage />} />
    </Routes>
  )
}
