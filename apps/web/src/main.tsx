import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./index.css";
import { Layout } from "./ui/Layout";
import { Home } from "./pages/Home";
import { Dashboard } from "./pages/Dashboard";
import { InvoiceDetail } from "./pages/InvoiceDetail";
import { Approvals } from "./pages/Approvals";
import { Settings } from "./pages/Settings";
import { Pay } from "./pages/Pay";
import { Log } from "./pages/Log";
import { ClientScore } from "./pages/ClientScore";
import { Metrics } from "./pages/Metrics";
import { Onboarding } from "./pages/Onboarding";
import { ClientSignIn } from "./pages/ClientSignIn";
import { ClientDashboard } from "./pages/ClientDashboard";
import { FreelancerProfile } from "./pages/FreelancerProfile";
import { AuthProvider } from "./auth";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
      <Routes>
        <Route index element={<Home />} />
        <Route path="onboarding" element={<Onboarding />} />
        <Route path="client" element={<ClientSignIn />} />
        <Route path="client/dashboard" element={<ClientDashboard />} />
        <Route element={<Layout />}>
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="invoices/:id" element={<InvoiceDetail />} />
          <Route path="approvals" element={<Approvals />} />
          <Route path="settings" element={<Settings />} />
          <Route path="log" element={<Log />} />
          <Route path="clients/:slug" element={<ClientScore />} />
          <Route path="metrics" element={<Metrics />} />
        </Route>
        <Route path="pay/:token" element={<Pay />} />
        <Route path="freelancers/:id" element={<FreelancerProfile />} />
      </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
