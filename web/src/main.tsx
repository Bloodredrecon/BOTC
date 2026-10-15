import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { HomePage } from "./pages/HomePage";
import { PlayPage } from "./pages/PlayPage";
import { StorytellerPage } from "./pages/StorytellerPage";
import { TvPage } from "./pages/TvPage";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/tv" element={<TvPage />} />
        <Route path="/storyteller" element={<StorytellerPage />} />
        <Route path="/play" element={<PlayPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
