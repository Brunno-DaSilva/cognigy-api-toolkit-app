import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

const STORAGE_KEY = "cognigy-toolkit:theme";
const THEMES = ["light", "dark"];

const ThemeContext = createContext(null);

const readStored = () => {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return THEMES.includes(v) ? v : "light";
  } catch {
    return "light";
  }
};

const writeStored = (theme) => {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // ignore — preference won't persist this session
  }
};

const apply = (theme) => {
  document.documentElement.setAttribute("data-theme", theme);
};

export const ThemeProvider = ({ children }) => {
  const [theme, setThemeState] = useState(readStored);

  // Apply on mount + whenever it changes.
  useEffect(() => {
    apply(theme);
  }, [theme]);

  const setTheme = useCallback((next) => {
    if (!THEMES.includes(next)) return;
    setThemeState(next);
    writeStored(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next = prev === "light" ? "dark" : "light";
      writeStored(next);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ theme, setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
};
