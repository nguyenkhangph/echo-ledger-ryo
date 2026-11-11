import { useEffect, useRef, useState, type ReactNode } from "react";
import { NetworkBackground } from "./NetworkBackground";

type NavKey = "radar" | "scorecard" | "card" | "ryo" | "judge";

const NAV_ITEMS: ReadonlyArray<{ key: NavKey; href: string; label: string }> = [
  { key: "radar", href: "/", label: "Radar" },
  { key: "ryo", href: "/ryo", label: "RYO check" },
  { key: "scorecard", href: "/scorecard", label: "Scorecard" },
  { key: "judge", href: "/judge", label: "For judges" },
];

/** Logo mark plus the text wordmark (the red dot echoes the mark's accent). */
export function Brand({ small = false }: { small?: boolean }) {
  return (
    <a className={`brand${small ? " brand--small" : ""}`} href="/" aria-label="Echo Ledger home">
      <img className="brand-mark" src="/brand/logo-mark.png" alt="" />
      <span className="wordmark">
        Echo<span>Ledger</span>
        <i aria-hidden="true" />
      </span>
    </a>
  );
}

/** Sticky header: transparent at the top of the page, blurred black once scrolled. */
export function SiteHeader({ active }: { active: NavKey }) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`site-header${scrolled || menuOpen ? " is-scrolled" : ""}`}>
      <div className="site-header__inner">
        <Brand />
        <nav className="nav" aria-label="Main navigation">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.key}
              href={item.href}
              className="nav-link"
              data-active={active === item.key || undefined}
              aria-current={active === item.key ? "page" : undefined}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="site-header__end">
          <span className="network-pill">
            <span className="live-dot" aria-hidden="true" />
            Sepolia · Practice
          </span>
          <button
            type="button"
            className="menu-button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              {menuOpen ? <path d="M5 5l10 10M15 5L5 15" /> : <path d="M3 6h14M3 10h14M3 14h14" />}
            </svg>
          </button>
        </div>
      </div>
      {menuOpen && (
        <nav id="mobile-menu" className="mobile-menu pop-in" aria-label="Mobile navigation">
          {NAV_ITEMS.map((item) => (
            <a key={item.key} href={item.href} aria-current={active === item.key ? "page" : undefined}>
              {item.label}
              {active === item.key && <span aria-hidden="true" />}
            </a>
          ))}
        </nav>
      )}
    </header>
  );
}

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <Brand small />
        <nav aria-label="Footer" className="footer-links">
          <a href="/">Radar</a>
          <a href="/scorecard">Scorecard</a>
          <a href="https://sepolia.etherscan.io/address/0x88fd1895d9b4BD28Cf641281b9AA1eF787b8DAd0" target="_blank" rel="noreferrer">
            Contract
          </a>
        </nav>
      </div>
      <div className="site-footer__legal">
        <p>
          Echo Ledger · Narrative-convergence agent with on-chain reasoning cards on Ethereum Sepolia. Practice positions only, no real capital.
          Not financial advice.
        </p>
      </div>
    </footer>
  );
}

/** Decorative eclipse: a black disc with a pulsing red corona and two slow orbits. */
export function EclipseOrb({ className = "" }: { className?: string }) {
  return (
    <div className={`eclipse-orb ${className}`} aria-hidden="true">
      <div className="eclipse-orb__orbit" />
      <div className="eclipse-orb__orbit eclipse-orb__orbit--inner" />
      <div className="eclipse-orb__disc" />
      <div className="eclipse-orb__spark" />
    </div>
  );
}

/** Fades its children up the first time they scroll into view. */
export function Reveal({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={`reveal${visible ? " is-visible" : ""} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

/** Small mono eyebrow above a large display heading. */
export function SectionHeading({ eyebrow, title, id }: { eyebrow: string; title: ReactNode; id?: string }) {
  return (
    <div className="section-heading">
      <p className="eyebrow">{eyebrow}</p>
      <h2 id={id} className="display-font">{title}</h2>
    </div>
  );
}

/** Shared page frame: animated background, header, content, footer. */
export function SiteLayout({ active, children }: { active: NavKey; children: ReactNode }) {
  return (
    <>
      <NetworkBackground />
      <SiteHeader active={active} />
      <div className="site-body">
        <div className="site-content">{children}</div>
        <Footer />
      </div>
    </>
  );
}
