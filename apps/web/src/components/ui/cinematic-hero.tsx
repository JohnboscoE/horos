// Adapted from the "cinematic-landing-hero" component: GSAP scroll-pinned timeline, 3D mouse tilt,
// film grain, physical depth card, phone mockup, floating badges, progress ring, tactile CTAs.
// Horos changes: the Horos palette (teal on near-black), no gradients (depth comes from shadows only,
// per SPEC §15), a live simulation of the invoice → terms → sign → pay → record loop inside the phone,
// reduced-motion support, and CTAs wired to the app instead of app-store links.
import React, { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { cn } from "@/lib/utils";
import { PhoneFlow, useFlowStep } from "@/components/ui/flow-simulation";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

const INJECTED_STYLES = `
  .gsap-reveal { visibility: hidden; }

  .film-grain {
    position: absolute; inset: 0; width: 100%; height: 100%;
    pointer-events: none; z-index: 50; opacity: 0.05; mix-blend-mode: overlay;
    background: url('data:image/svg+xml;utf8,<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><filter id="noiseFilter"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" stitchTiles="stitch"/></filter><rect width="100%" height="100%" filter="url(%23noiseFilter)"/></svg>');
  }

  /* Grid drawn as an SVG pattern (no CSS gradients) */
  .bg-grid-theme {
    background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><path d="M60 0H0V60" fill="none" stroke="%23e6eef1" stroke-opacity="0.05"/></svg>');
    background-size: 60px 60px;
  }

  /* Headline text: raised with shadow, no gradient fill */
  .text-3d-matte {
    color: var(--color-foreground);
    text-shadow: 0 10px 30px rgba(0,0,0,0.65), 0 2px 4px rgba(0,0,0,0.5);
  }
  .text-accent-matte {
    color: var(--color-primary);
    text-shadow: 0 10px 40px rgba(0,194,168,0.25), 0 2px 4px rgba(0,0,0,0.6);
  }
  .text-card-matte {
    color: #f2f7f8;
    text-shadow: 0 12px 24px rgba(0,0,0,0.8), 0 4px 8px rgba(0,0,0,0.6);
  }

  /* Physical card: flat deep teal-black, depth from shadows */
  .premium-depth-card {
    background-color: #0a1716;
    box-shadow:
      0 40px 100px -20px rgba(0,0,0,0.9),
      0 20px 40px -20px rgba(0,0,0,0.8),
      inset 0 1px 2px rgba(255,255,255,0.12),
      inset 0 -2px 4px rgba(0,0,0,0.8);
    border: 1px solid rgba(0,194,168,0.12);
    position: relative;
  }

  .iphone-bezel {
    background-color: #0c0f11;
    box-shadow:
      inset 0 0 0 2px #3f4a50,
      inset 0 0 0 7px #000,
      0 40px 80px -15px rgba(0,0,0,0.9),
      0 15px 25px -5px rgba(0,0,0,0.7);
    transform-style: preserve-3d;
  }
  .hardware-btn {
    background-color: #2a2f33;
    box-shadow: -2px 0 5px rgba(0,0,0,0.8), inset -1px 0 1px rgba(255,255,255,0.15), inset 1px 0 2px rgba(0,0,0,0.8);
  }
  .widget-depth {
    background-color: rgba(255,255,255,0.03);
    box-shadow: 0 10px 20px rgba(0,0,0,0.3), inset 0 1px 1px rgba(255,255,255,0.05), inset 0 -1px 1px rgba(0,0,0,0.5);
    border: 1px solid rgba(255,255,255,0.04);
  }
  .floating-ui-badge {
    background-color: rgba(16,22,26,0.72);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    box-shadow:
      0 0 0 1px rgba(255,255,255,0.08),
      0 25px 50px -12px rgba(0,0,0,0.8),
      inset 0 1px 1px rgba(255,255,255,0.12),
      inset 0 -1px 1px rgba(0,0,0,0.5);
  }

  .btn-modern-light, .btn-modern-dark { transition: all 0.4s cubic-bezier(0.25, 1, 0.5, 1); }
  .btn-modern-light {
    background-color: var(--color-primary); color: #04110f;
    box-shadow: 0 0 0 1px rgba(0,194,168,0.4), 0 2px 4px rgba(0,0,0,0.2), 0 12px 24px -4px rgba(0,194,168,0.4), inset 0 1px 1px rgba(255,255,255,0.5), inset 0 -3px 6px rgba(0,0,0,0.15);
  }
  .btn-modern-light:hover { transform: translateY(-3px); box-shadow: 0 0 0 1px rgba(0,194,168,0.5), 0 6px 12px -2px rgba(0,0,0,0.3), 0 20px 32px -6px rgba(0,194,168,0.5), inset 0 1px 1px rgba(255,255,255,0.5), inset 0 -3px 6px rgba(0,0,0,0.15); }
  .btn-modern-light:active { transform: translateY(1px); box-shadow: 0 0 0 1px rgba(0,194,168,0.4), inset 0 3px 6px rgba(0,0,0,0.25); }
  .btn-modern-dark {
    background-color: #1a2226; color: #fff;
    box-shadow: 0 0 0 1px rgba(255,255,255,0.1), 0 2px 4px rgba(0,0,0,0.6), 0 12px 24px -4px rgba(0,0,0,0.9), inset 0 1px 1px rgba(255,255,255,0.12), inset 0 -3px 6px rgba(0,0,0,0.8);
  }
  .btn-modern-dark:hover { transform: translateY(-3px); background-color: #222c31; box-shadow: 0 0 0 1px rgba(0,194,168,0.4), 0 6px 12px -2px rgba(0,0,0,0.7), 0 20px 32px -6px rgba(0,0,0,1), inset 0 1px 1px rgba(255,255,255,0.15), inset 0 -3px 6px rgba(0,0,0,0.8); }
  .btn-modern-dark:active { transform: translateY(1px); background-color: #151b1e; box-shadow: 0 0 0 1px rgba(255,255,255,0.05), inset 0 3px 8px rgba(0,0,0,0.9); }

  .progress-ring {
    transform: rotate(-90deg); transform-origin: center;
    stroke-dasharray: 402; stroke-dashoffset: 402; stroke-linecap: round;
  }

  @media (prefers-reduced-motion: reduce) {
    .gsap-reveal { visibility: visible !important; opacity: 1 !important; }
  }
`;

export interface CinematicHeroProps extends React.HTMLAttributes<HTMLDivElement> {
  brandName?: string;
  tagline1?: string;
  tagline2?: string;
  cardHeading?: string;
  cardDescription?: React.ReactNode;
  metricValue?: number;
  metricLabel?: string;
  ctaHeading?: string;
  ctaDescription?: string;
  primaryCta?: { label: string; href: string };
  secondaryCta?: { label: string; href: string };
}

export function CinematicHero({
  brandName = "Horos",
  tagline1 = "Know who pays late,",
  tagline2 = "before you start the work.",
  cardHeading = "Terms from facts, not hope.",
  cardDescription = (
    <>
      <span className="font-semibold text-white">Horos</span> builds a shared, onchain record of which clients pay on time.
      An AI agent sets your terms and runs collections from it, inside the bounds you set.
    </>
  ),
  metricValue = 94,
  metricLabel = "On-time rate",
  ctaHeading = "Get paid like you mean it.",
  ctaDescription = "Invoice in USDC on Arc. Every decision the agent makes is signed, logged and replayable.",
  primaryCta = { label: "Start as a freelancer", href: "#start" },
  secondaryCta = { label: "See the decision log", href: "/log" },
  className,
  ...props
}: CinematicHeroProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mainCardRef = useRef<HTMLDivElement>(null);
  const mockupRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<number>(0);
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const step = useFlowStep(2200);

  // Mouse tilt (rAF-throttled)
  useEffect(() => {
    if (reduced) return;
    const onMove = (e: MouseEvent) => {
      if (window.scrollY > window.innerHeight * 2) return;
      cancelAnimationFrame(requestRef.current);
      requestRef.current = requestAnimationFrame(() => {
        if (!mockupRef.current) return;
        const xVal = (e.clientX / window.innerWidth - 0.5) * 2;
        const yVal = (e.clientY / window.innerHeight - 0.5) * 2;
        gsap.to(mockupRef.current, { rotationY: xVal * 12, rotationX: -yVal * 12, ease: "power3.out", duration: 1.2 });
      });
    };
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(requestRef.current);
    };
  }, [reduced]);

  // Cinematic scroll timeline
  useEffect(() => {
    if (reduced) return;
    const isMobile = window.innerWidth < 768;
    const ctx = gsap.context(() => {
      gsap.set(".text-track", { autoAlpha: 0, y: 60, scale: 0.85, filter: "blur(20px)", rotationX: -20 });
      gsap.set(".text-days", { autoAlpha: 1, clipPath: "inset(0 100% 0 0)" });
      gsap.set(".main-card", { y: window.innerHeight + 200, autoAlpha: 1 });
      gsap.set([".card-left-text", ".card-right-text", ".mockup-scroll-wrapper", ".floating-badge", ".phone-widget"], { autoAlpha: 0 });
      gsap.set(".cta-wrapper", { autoAlpha: 0, scale: 0.8, filter: "blur(30px)" });
      gsap.set(".scroll-hint", { autoAlpha: 0 });

      gsap
        .timeline({ delay: 0.3 })
        .to(".text-track", { duration: 1.8, autoAlpha: 1, y: 0, scale: 1, filter: "blur(0px)", rotationX: 0, ease: "expo.out" })
        .to(".text-days", { duration: 1.4, clipPath: "inset(0 0% 0 0)", ease: "power4.inOut" }, "-=1.0")
        .to(".scroll-hint", { autoAlpha: 1, duration: 0.8 }, "-=0.2");

      gsap
        .timeline({
          scrollTrigger: { trigger: containerRef.current, start: "top top", end: isMobile ? "+=4200" : "+=5600", pin: true, scrub: 1, anticipatePin: 1 },
        })
        .to(".scroll-hint", { autoAlpha: 0, duration: 0.3 }, 0)
        .to([".hero-text-wrapper", ".bg-grid-theme"], { scale: 1.15, filter: "blur(20px)", opacity: 0.2, ease: "power2.inOut", duration: 2 }, 0)
        .to(".main-card", { y: 0, ease: "power3.inOut", duration: 2 }, 0)
        .to(".main-card", { width: "100%", height: "100%", borderRadius: "0px", ease: "power3.inOut", duration: 1.5 })
        .fromTo(
          ".mockup-scroll-wrapper",
          { y: 300, z: -500, rotationX: 50, rotationY: -30, autoAlpha: 0, scale: 0.6 },
          { y: 0, z: 0, rotationX: 0, rotationY: 0, autoAlpha: 1, scale: 1, ease: "expo.out", duration: 2.5 },
          "-=0.8",
        )
        .fromTo(".phone-widget", { y: 40, autoAlpha: 0, scale: 0.95 }, { y: 0, autoAlpha: 1, scale: 1, stagger: 0.15, ease: "back.out(1.2)", duration: 1.5 }, "-=1.5")
        .to(".progress-ring", { strokeDashoffset: 402 - (402 * metricValue) / 100, duration: 2, ease: "power3.inOut" }, "-=1.2")
        .to(".counter-val", { innerHTML: metricValue, snap: { innerHTML: 1 }, duration: 2, ease: "expo.out" }, "-=2.0")
        .fromTo(".floating-badge", { y: 100, autoAlpha: 0, scale: 0.7, rotationZ: -10 }, { y: 0, autoAlpha: 1, scale: 1, rotationZ: 0, ease: "back.out(1.5)", duration: 1.5, stagger: 0.2 }, "-=2.0")
        .fromTo(".card-left-text", { x: -50, autoAlpha: 0 }, { x: 0, autoAlpha: 1, ease: "power4.out", duration: 1.5 }, "-=1.5")
        .fromTo(".card-right-text", { x: 50, autoAlpha: 0, scale: 0.8 }, { x: 0, autoAlpha: 1, scale: 1, ease: "expo.out", duration: 1.5 }, "<")
        .to({}, { duration: 2.5 })
        .set(".hero-text-wrapper", { autoAlpha: 0 })
        .set(".cta-wrapper", { autoAlpha: 1 })
        .to({}, { duration: 1.5 })
        .to([".mockup-scroll-wrapper", ".floating-badge", ".card-left-text", ".card-right-text"], {
          scale: 0.9, y: -40, z: -200, autoAlpha: 0, ease: "power3.in", duration: 1.2, stagger: 0.05,
        })
        .to(".main-card", { width: isMobile ? "92vw" : "85vw", height: isMobile ? "92vh" : "85vh", borderRadius: isMobile ? "32px" : "40px", ease: "expo.inOut", duration: 1.8 }, "pullback")
        .to(".cta-wrapper", { scale: 1, filter: "blur(0px)", ease: "expo.inOut", duration: 1.8 }, "pullback")
        .to(".main-card", { y: -window.innerHeight - 300, ease: "power3.in", duration: 1.5 });
    }, containerRef);
    return () => ctx.revert();
  }, [metricValue, reduced]);

  const ringOffset = reduced ? 402 - (402 * metricValue) / 100 : undefined;

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative flex w-full items-center justify-center overflow-hidden bg-background font-sans text-foreground antialiased",
        reduced ? "min-h-screen py-24" : "h-screen",
        className,
      )}
      style={{ perspective: "1500px" }}
      {...props}
    >
      <style dangerouslySetInnerHTML={{ __html: INJECTED_STYLES }} />
      <div className="film-grain" aria-hidden="true" />
      <div className="bg-grid-theme pointer-events-none absolute inset-0 z-0 opacity-60" aria-hidden="true" />

      {/* Layer 1: headline */}
      <div className={cn("hero-text-wrapper z-10 flex w-full flex-col items-center justify-center px-4 text-center will-change-transform", reduced ? "relative" : "absolute")}>
        <h1 className="text-track gsap-reveal text-3d-matte mb-2 text-5xl font-bold tracking-tight md:text-7xl lg:text-[5.5rem]">{tagline1}</h1>
        <h1 className="text-days gsap-reveal text-accent-matte text-5xl font-extrabold tracking-tighter md:text-7xl lg:text-[5.5rem]">{tagline2}</h1>
        {!reduced && (
          <div className="scroll-hint gsap-reveal mt-14 flex flex-col items-center gap-2 text-xs uppercase tracking-[0.25em] text-muted-foreground">
            Scroll to see how it works
            <span className="h-8 w-px animate-pulse bg-primary/60" />
          </div>
        )}
      </div>

      {/* Layer 2: CTA (revealed at the end of the scroll) */}
      {!reduced && (
        <div className="cta-wrapper gsap-reveal pointer-events-auto absolute z-10 flex w-full flex-col items-center justify-center px-4 text-center will-change-transform">
          <h2 className="text-3d-matte mb-6 text-4xl font-bold tracking-tight md:text-6xl lg:text-7xl">{ctaHeading}</h2>
          <p className="mx-auto mb-12 max-w-xl text-lg font-light leading-relaxed text-muted-foreground md:text-xl">{ctaDescription}</p>
          <div className="flex flex-col gap-4 sm:flex-row sm:gap-6">
            <a href={primaryCta.href} className="btn-modern-light rounded-[1.25rem] px-8 py-4 text-lg font-bold tracking-tight focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background">
              {primaryCta.label}
            </a>
            <a href={secondaryCta.href} className="btn-modern-dark rounded-[1.25rem] px-8 py-4 text-lg font-bold tracking-tight focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background">
              {secondaryCta.label}
            </a>
          </div>
        </div>
      )}

      {/* Layer 3: the physical card with the product simulation */}
      {!reduced && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center" style={{ perspective: "1500px" }}>
          <div
            ref={mainCardRef}
            className="main-card premium-depth-card gsap-reveal pointer-events-auto relative flex h-[92vh] w-[92vw] items-center justify-center overflow-hidden rounded-[32px] md:h-[85vh] md:w-[85vw] md:rounded-[40px]"
          >
            <HeroCardContent
              brandName={brandName}
              cardHeading={cardHeading}
              cardDescription={cardDescription}
              metricValue={metricValue}
              metricLabel={metricLabel}
              step={step}
              mockupRef={mockupRef}
            />
          </div>
        </div>
      )}

      {/* Reduced motion: same content, static */}
      {reduced && (
        <div className="premium-depth-card relative z-20 mt-12 w-[92vw] rounded-[32px] md:w-[85vw]">
          <HeroCardContent
            brandName={brandName}
            cardHeading={cardHeading}
            cardDescription={cardDescription}
            metricValue={metricValue}
            metricLabel={metricLabel}
            step={step}
            mockupRef={mockupRef}
            ringOffset={ringOffset}
          />
        </div>
      )}
    </div>
  );
}

function HeroCardContent({
  brandName,
  cardHeading,
  cardDescription,
  metricValue,
  metricLabel,
  step,
  mockupRef,
  ringOffset,
}: {
  brandName: string;
  cardHeading: string;
  cardDescription: React.ReactNode;
  metricValue: number;
  metricLabel: string;
  step: number;
  mockupRef: React.RefObject<HTMLDivElement | null>;
  ringOffset?: number;
}) {
  return (
    <div className="relative z-10 mx-auto flex h-full w-full max-w-7xl flex-col items-center justify-evenly px-4 py-6 lg:grid lg:grid-cols-3 lg:gap-8 lg:px-12 lg:py-0">
      {/* Brand (top on mobile, right on desktop) */}
      <div className="card-right-text gsap-reveal order-1 flex w-full justify-center lg:order-3 lg:justify-end">
        <h2 className="text-card-matte text-6xl font-black uppercase tracking-tighter md:text-[6rem] lg:text-[7.5rem]">{brandName}</h2>
      </div>

      {/* Phone */}
      <div className="mockup-scroll-wrapper order-2 relative flex h-[380px] w-full items-center justify-center lg:h-[600px]" style={{ perspective: "1000px" }}>
        <div className="relative flex h-full w-full scale-[0.65] items-center justify-center md:scale-85 lg:scale-100">
          <div ref={mockupRef} className="iphone-bezel relative flex h-[580px] w-[280px] flex-col rounded-[3rem] will-change-transform" style={{ transformStyle: "preserve-3d" }}>
            <div className="hardware-btn absolute top-[120px] -left-[3px] h-[25px] w-[3px] rounded-l-md" aria-hidden="true" />
            <div className="hardware-btn absolute top-[160px] -left-[3px] h-[45px] w-[3px] rounded-l-md" aria-hidden="true" />
            <div className="hardware-btn absolute top-[220px] -left-[3px] h-[45px] w-[3px] rounded-l-md" aria-hidden="true" />
            <div className="hardware-btn absolute top-[170px] -right-[3px] h-[70px] w-[3px] rotate-180 rounded-l-md" aria-hidden="true" />

            <div className="absolute inset-[7px] overflow-hidden rounded-[2.6rem] bg-[#070a0c]">
              <div className="absolute top-2 left-1/2 z-20 h-[26px] w-[90px] -translate-x-1/2 rounded-full bg-black" aria-hidden="true" />

              <PhoneFlow
                step={step}
                aside={
                  // Network on-time rate for this client (the shared record)
                  <>
                    <div className="relative flex items-center justify-center">
                      <svg width="54" height="54" viewBox="0 0 140 140" aria-hidden="true">
                        <circle cx="70" cy="70" r="64" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="12" />
                        <circle className="progress-ring" cx="70" cy="70" r="64" fill="none" stroke="#00c2a8" strokeWidth="12" style={ringOffset !== undefined ? { strokeDashoffset: ringOffset } : undefined} />
                      </svg>
                      <div className="absolute text-[12px] font-bold text-white">
                        <span className="counter-val">{ringOffset !== undefined ? metricValue : 0}</span>%
                      </div>
                    </div>
                    <div className="mt-1 text-center text-[7px] uppercase leading-tight tracking-wider text-neutral-500">{metricLabel}</div>
                  </>
                }
              />
            </div>
          </div>

          {/* Floating badges */}
          <div className="floating-badge floating-ui-badge absolute top-4 left-0 flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5 lg:top-10 lg:-left-16">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-dim text-sm text-primary">✓</span>
            <div>
              <div className="text-[11px] font-semibold text-white">Policy check passed</div>
              <div className="text-[10px] text-neutral-400">Net 30 is inside your bounds</div>
            </div>
          </div>
          <div className="floating-badge floating-ui-badge absolute right-0 bottom-10 flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5 lg:bottom-24 lg:-right-16">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-dim text-sm text-primary">⛓</span>
            <div>
              <div className="text-[11px] font-semibold text-white">Decision #128 anchored</div>
              <div className="text-[10px] text-neutral-400">Hash-chained · signed</div>
            </div>
          </div>
        </div>
      </div>

      {/* Copy (bottom on mobile, left on desktop) */}
      <div className="card-left-text gsap-reveal order-3 flex flex-col justify-center text-center lg:order-1 lg:text-left">
        <h3 className="mb-3 text-2xl font-bold tracking-tight text-white md:text-3xl lg:text-4xl">{cardHeading}</h3>
        <p className="mx-auto max-w-sm text-sm font-normal leading-relaxed text-neutral-400 md:text-base lg:mx-0 lg:max-w-none">{cardDescription}</p>
      </div>
    </div>
  );
}
