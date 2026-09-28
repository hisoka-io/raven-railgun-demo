import { Link } from "react-router-dom";

export function Header() {
  return (
    <header className="border-b border-fg-faint bg-bg/95 backdrop-blur sticky top-0 z-30">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 h-14 flex items-center justify-between gap-4">
        <Link
          to="/"
          className="font-serif text-xl sm:text-2xl tracking-tight hover:text-accent transition-colors shrink-0"
        >
          Raven
        </Link>
        <div className="flex items-center gap-3">
          <a
            href="https://github.com/hisoka-io"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline font-mono text-[0.7rem] font-medium uppercase tracking-[0.16em] text-fg-secondary hover:text-fg transition-colors"
          >
            GitHub
          </a>
        </div>
      </div>
    </header>
  );
}
