"use client";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const stored =
      (localStorage.getItem("theme") as "dark" | "light" | null) ?? "dark";
    setTheme(stored);
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.classList.toggle("light", next === "light");
    localStorage.setItem("theme", next);
  };

  return (
    <button
      onClick={toggle}
      aria-label="Toggle theme"
      className="font-mono text-xs uppercase tracking-wider text-tm hover:text-tp transition px-2 py-1 border border-line rounded"
    >
      {theme === "dark" ? "Light" : "Dark"}
    </button>
  );
}
