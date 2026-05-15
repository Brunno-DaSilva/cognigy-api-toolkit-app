import { Outlet } from "react-router-dom";
import { ActiveProjectProvider } from "../../context/ActiveProjectContext";
import MainSidebar from "./MainSidebar";

const MainLayout = () => (
  <ActiveProjectProvider>
    <div className="main-shell">
      <MainSidebar />
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  </ActiveProjectProvider>
);

export default MainLayout;
