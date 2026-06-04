import { Outlet } from "react-router-dom";
import { ActiveProjectProvider } from "../../context/ActiveProjectContext";
import { AnalyticsCacheProvider } from "../../context/AnalyticsCacheContext";
import MainSidebar from "./MainSidebar";
import Topbar from "./Topbar";

const MainLayout = () => (
  <ActiveProjectProvider>
    <AnalyticsCacheProvider>
      <div className="main-shell">
        <MainSidebar />
        <div className="main-column">
          <Topbar />
          <main className="main-content">
            <Outlet />
          </main>
        </div>
      </div>
    </AnalyticsCacheProvider>
  </ActiveProjectProvider>
);

export default MainLayout;
