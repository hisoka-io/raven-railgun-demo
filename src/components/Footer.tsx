export function Footer() {
  return (
    <footer className="border-t border-fg-faint mt-24">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 py-6 flex flex-wrap items-center justify-between gap-3 text-[0.6rem] text-fg-muted uppercase tracking-wider">
        <div className="flex items-center gap-3">
          <span className="font-serif text-[0.75rem] normal-case tracking-tight">Hisoka</span>
          <span className="text-fg-faint">·</span>
          <span>Raven · PIR for Railgun PoI</span>
        </div>
        <div className="flex items-center gap-4">
          <a href="https://hisoka.io" target="_blank" rel="noopener noreferrer" className="hover:text-fg transition-colors">Protocol</a>
          <a href="https://hisoka.io/writing" target="_blank" rel="noopener noreferrer" className="hover:text-fg transition-colors">Writing</a>
          <a href="https://hisoka.io/nox" target="_blank" rel="noopener noreferrer" className="hover:text-fg transition-colors">Nox</a>
          <a href="https://github.com/hisoka-io" target="_blank" rel="noopener noreferrer" className="hover:text-fg transition-colors">GitHub</a>
        </div>
      </div>
    </footer>
  );
}
