import { ExternalLink } from "lucide-react";

export default function Footer() {
  return (
    <footer className="fixed bottom-0 shrink-0 w-full py-6 px-8 bg-surface-container-lowest border-t border-outline-variant/10">
      <div className="flex flex-col md:flex-row justify-between items-center w-full gap-4 max-w-[1920px] mx-auto">
        <div className="font-label text-xs uppercase tracking-[0.2em] text-secondary-ds">
          © 2026 KONDOR. AUTOMATE YOUR CRYPTO.
        </div>
        <div className="flex items-center space-x-6">
          <span className="font-label text-xs tracking-[0.2em] text-secondary-ds">
            Made with ❤️ at ETHGlobal Cannes 2026
          </span>
          <a
            className="inline-flex items-center gap-1.5 font-label text-xs uppercase tracking-[0.2em] text-secondary-container hover:text-primary-container transition-colors"
            href="https://github.com/blackicon-eth/kondor"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    </footer>
  );
}
