import React, { useEffect, useState } from "react";
import { ArrowRight, ArrowUpRight, Menu, PlayCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * Responsive hero banner (adapted from 21st.dev "responsive-hero-banner").
 * Changes from the original:
 *  - logo is a ReactNode (wordmark) instead of an image URL; partners can be text chips or logos
 *  - icons use lucide-react
 *  - the mobile menu actually renders (the original toggled state but never showed a panel)
 *  - a solid dark scrim keeps text readable on any photo (no gradients, per Horos's design rules)
 *  - colors come from theme tokens (primary = Horos teal)
 */

export interface NavLink {
  label: string;
  href: string;
  isActive?: boolean;
}

export interface Partner {
  label: string;
  href?: string;
  logoUrl?: string;
}

export interface ResponsiveHeroBannerProps {
  logo?: React.ReactNode;
  logoHref?: string;
  backgroundImageUrl?: string;
  navLinks?: NavLink[];
  ctaButtonText?: string;
  ctaButtonHref?: string;
  badgeText?: string;
  badgeLabel?: string;
  title?: string;
  titleLine2?: string;
  description?: string;
  primaryButtonText?: string;
  primaryButtonHref?: string;
  secondaryButtonText?: string;
  secondaryButtonHref?: string;
  partnersTitle?: string;
  partners?: Partner[];
  className?: string;
  children?: React.ReactNode;
}

const DEFAULT_BG =
  "https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=2400&q=80";

export function ResponsiveHeroBanner({
  logo = <span className="text-lg font-semibold text-white">Brand</span>,
  logoHref = "/",
  backgroundImageUrl = DEFAULT_BG,
  navLinks = [],
  ctaButtonText = "Get started",
  ctaButtonHref = "#",
  badgeLabel = "New",
  badgeText,
  title = "Title",
  titleLine2,
  description,
  primaryButtonText = "Get started",
  primaryButtonHref = "#",
  secondaryButtonText,
  secondaryButtonHref = "#",
  partnersTitle,
  partners = [],
  className,
  children,
}: ResponsiveHeroBannerProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMobileMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileMenuOpen]);

  return (
    <section className={cn("relative isolate min-h-screen w-full overflow-hidden bg-background", className)}>
      <img src={backgroundImageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
      {/* Solid scrim for contrast (no gradient) */}
      <div className="absolute inset-0 bg-background/70" aria-hidden="true" />
      <div className="pointer-events-none absolute inset-0 ring-1 ring-black/30" aria-hidden="true" />

      <header className="relative z-20 xl:top-4">
        <div className="mx-4 sm:mx-6">
          <div className="flex items-center justify-between pt-4">
            <a href={logoHref} className="inline-flex h-10 items-center rounded">{logo}</a>

            <nav className="hidden items-center gap-2 md:flex" aria-label="Main">
              <div className="flex items-center gap-1 rounded-full bg-white/5 px-1 py-1 ring-1 ring-white/10 backdrop-blur">
                {navLinks.map((link) => (
                  <a
                    key={link.label}
                    href={link.href}
                    aria-current={link.isActive ? "page" : undefined}
                    className={cn(
                      "px-3 py-2 font-sans text-sm font-medium transition-colors hover:text-white",
                      link.isActive ? "text-white" : "text-white/75",
                    )}
                  >
                    {link.label}
                  </a>
                ))}
                <a
                  href={ctaButtonHref}
                  className="ml-1 inline-flex items-center gap-2 rounded-full bg-primary px-3.5 py-2 font-sans text-sm font-semibold text-primary-foreground transition-colors hover:brightness-110"
                >
                  {ctaButtonText}
                  <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                </a>
              </div>
            </nav>

            <button
              onClick={() => setMobileMenuOpen((o) => !o)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/15 backdrop-blur md:hidden"
              aria-expanded={mobileMenuOpen}
              aria-controls="hero-mobile-menu"
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            >
              {mobileMenuOpen ? <X className="h-5 w-5 text-white/90" /> : <Menu className="h-5 w-5 text-white/90" />}
            </button>
          </div>

          {mobileMenuOpen && (
            <div
              id="hero-mobile-menu"
              className="animate-fade-slide-in-1 mt-3 rounded-2xl bg-card/95 p-2 ring-1 ring-white/10 backdrop-blur md:hidden"
            >
              {navLinks.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="block rounded-xl px-4 py-3 text-sm font-medium text-white/85 hover:bg-white/5 hover:text-white"
                >
                  {link.label}
                </a>
              ))}
              <a
                href={ctaButtonHref}
                onClick={() => setMobileMenuOpen(false)}
                className="mt-1 flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground"
              >
                {ctaButtonText}
                <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              </a>
            </div>
          )}
        </div>
      </header>

      <div className="relative z-10">
        <div className="mx-auto max-w-7xl px-6 pt-24 pb-16 sm:pt-28 md:pt-32 lg:pt-36">
          <div className="mx-auto max-w-3xl text-center">
            {badgeText && (
              <div className="animate-fade-slide-in-1 mb-6 inline-flex items-center gap-3 rounded-full bg-white/10 px-2.5 py-2 ring-1 ring-white/15 backdrop-blur">
                <span className="inline-flex items-center rounded-full bg-primary px-2 py-0.5 font-sans text-xs font-semibold text-primary-foreground">
                  {badgeLabel}
                </span>
                <span className="font-sans text-sm font-medium text-white/90">{badgeText}</span>
              </div>
            )}

            <h1 className="animate-fade-slide-in-2 font-instrument-serif text-4xl leading-tight font-normal tracking-tight text-white sm:text-5xl md:text-6xl lg:text-7xl">
              {title}
              {titleLine2 && (
                <>
                  <br className="hidden sm:block" /> <span className="text-primary">{titleLine2}</span>
                </>
              )}
            </h1>

            {description && (
              <p className="animate-fade-slide-in-3 mx-auto mt-6 max-w-2xl text-base text-white/80 sm:text-lg">{description}</p>
            )}

            <div className="animate-fade-slide-in-4 mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
              <a
                href={primaryButtonHref}
                className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 font-sans text-sm font-semibold text-primary-foreground shadow-[0_10px_30px_-10px_rgba(0,194,168,0.6)] transition hover:brightness-110"
              >
                {primaryButtonText}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </a>
              {secondaryButtonText && (
                <a
                  href={secondaryButtonHref}
                  className="inline-flex items-center gap-2 rounded-full bg-white/10 px-5 py-3 font-sans text-sm font-medium text-white ring-1 ring-white/15 transition-colors hover:bg-white/15"
                >
                  {secondaryButtonText}
                  <PlayCircle className="h-4 w-4" aria-hidden="true" />
                </a>
              )}
            </div>
          </div>

          {children && <div className="animate-fade-slide-in-4 mx-auto mt-16 max-w-5xl">{children}</div>}

          {partners.length > 0 && (
            <div className="mx-auto mt-16 max-w-5xl">
              {partnersTitle && <p className="animate-fade-slide-in-1 text-center text-sm text-white/65">{partnersTitle}</p>}
              <div className="animate-fade-slide-in-2 mt-6 flex flex-wrap items-center justify-center gap-3">
                {partners.map((p) => {
                  const inner = p.logoUrl ? (
                    <img src={p.logoUrl} alt={p.label} className="h-6 w-auto opacity-80" />
                  ) : (
                    <span className="font-sans text-sm font-medium tracking-wide text-white/75">{p.label}</span>
                  );
                  const cls = "inline-flex h-10 items-center justify-center rounded-full bg-white/5 px-4 ring-1 ring-white/10 transition-opacity hover:bg-white/10";
                  return p.href ? (
                    <a key={p.label} href={p.href} target="_blank" rel="noreferrer" className={cls}>{inner}</a>
                  ) : (
                    <span key={p.label} className={cls}>{inner}</span>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default ResponsiveHeroBanner;
