import { Routes, Route } from 'react-router-dom'
import Home from './routes/Home'
import Login from './routes/Login'
import Scan from './routes/Scan'
import Archive from './routes/Archive'
import DocumentDetail from './routes/DocumentDetail'
import Search from './routes/Search'
import Settings from './routes/Settings'
import Admin from './routes/Admin'
import BottomNav from './components/BottomNav'
import ProtectedRoute from './components/ProtectedRoute'
import OfflineSyncManager from './components/OfflineSyncManager'
import { useLocation } from 'react-router-dom'

function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const hideNav = location.pathname === '/login' || location.pathname === '/scan'
  return (
    <>
      <OfflineSyncManager />
      {children}
      {!hideNav && <BottomNav />}
    </>
  )
}

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Home />
            </ProtectedRoute>
          }
        />
        <Route
          path="/scan"
          element={
            <ProtectedRoute>
              <Scan />
            </ProtectedRoute>
          }
        />
        <Route
          path="/archive"
          element={
            <ProtectedRoute>
              <Archive />
            </ProtectedRoute>
          }
        />
        <Route
          path="/documents/:id"
          element={
            <ProtectedRoute>
              <DocumentDetail />
            </ProtectedRoute>
          }
        />
        <Route
          path="/search"
          element={
            <ProtectedRoute>
              <Search />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <Settings />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <ProtectedRoute>
              <Admin />
            </ProtectedRoute>
          }
        />
      </Routes>
    </Layout>
  )
}
