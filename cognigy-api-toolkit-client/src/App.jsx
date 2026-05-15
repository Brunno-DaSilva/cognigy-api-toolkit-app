import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import Landing from "./pages/Landing";
import Register from "./pages/Register";
import Profile from "./pages/Profile";
import MainLayout from "./components/layout/MainLayout";
import Home from "./pages/admin/Home";
import Customers from "./pages/admin/Customers";
import CustomerDetail from "./pages/admin/CustomerDetail";
import Projects from "./pages/admin/Projects";
import Logs from "./pages/tools/Logs";
import Snapshots from "./pages/tools/Snapshots";
import Analytics from "./pages/tools/Analytics";
import "./styles/index.css";

const RequireAuth = ({ children }) => {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="auth-page">Loading…</div>;
  if (!session) return <Navigate to="/" state={{ from: location }} replace />;
  return children;
};

const RedirectIfAuthed = ({ children }) => {
  const { session, loading } = useAuth();
  if (loading) return <div className="auth-page">Loading…</div>;
  if (session) return <Navigate to="/home" replace />;
  return children;
};

const App = () => (
  <Routes>
    <Route
      path="/"
      element={
        <RedirectIfAuthed>
          <Landing />
        </RedirectIfAuthed>
      }
    />
    <Route
      path="/register"
      element={
        <RedirectIfAuthed>
          <Register />
        </RedirectIfAuthed>
      }
    />

    <Route
      element={
        <RequireAuth>
          <MainLayout />
        </RequireAuth>
      }
    >
      <Route path="/home" element={<Home />} />
      <Route path="/profile" element={<Profile />} />

      <Route path="/admin/customers" element={<Customers />} />
      <Route path="/admin/customers/:customerId" element={<CustomerDetail />} />
      <Route path="/admin/projects" element={<Projects />} />

      <Route path="/tools/logs" element={<Logs />} />
      <Route path="/tools/snapshots" element={<Snapshots />} />
      <Route path="/tools/analytics" element={<Analytics />} />

      <Route path="/dashboard/*" element={<Navigate to="/home" replace />} />
      <Route path="/project/:projectId/*" element={<Navigate to="/tools/logs" replace />} />
    </Route>

    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
);

export default App;
